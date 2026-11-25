import { AsyncLocalStorage } from 'node:async_hooks'
import { getCodexStatus, generateCodexImages, generateCodexText } from './codexRuntime.js'
import { createActionAnimatorArtifactsFromImageStrip } from './actionAnimator.js'
import { animatorCanvas, describeActionAnimatorGrid } from '../shared/actionAnimatorLayout.js'
import { processTexture, normalizeTextureProviderImage } from './textureLab.js'
import { createImageLibrary, createImageLibraryRouter } from './imageLibrary.js'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'

import {
  createConcurrencyLimiter,
  createCorsMiddleware,
  createRateLimiter,
  createSecurityHeadersMiddleware,
  createTokenAuthMiddleware,
} from './requestGuards.js'
import {
  validateActionAnimatorRequest,
  toValidationResponse,
  validateCharacterSheetRequest,
  validateForgeRequest,
  validateVariantForgeIdeaRequest,
  validateVfxExportRequest,
  validateVfxRecipeRequest,
} from './requestValidation.js'
import {
  buildVfxExportBundle,
  buildVfxForgePrompt as buildVfxForgePromptForRequest,
  buildVfxRecipeManifest,
  resolveVfxForgeSystemInstruction as resolveVfxForgeSystemInstructionForRequest,
} from './vfxForge.js'
import {
  formatVariantForgeLabel,
  isVariantForgeFamily,
  isVariantForgePresetForFamily,
  pickVariantForgeIdeaSuggestions,
  variantForgeDefaultPresetByFamily,
} from '../shared/variantForgeCatalog.js'
import { forgeApiModes } from '../shared/modeCatalog.js'

import { getVfxTextureLabel, resolveVfxEffectLabel } from '../shared/vfxForgeCatalog.js'
import { variantForgeIdeaSuggestionCount } from '../shared/variantForgeIdeas.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

export function buildEnvSearchPaths(options = {}) {
  const cwd =
    typeof options.cwd === 'string' && options.cwd.trim()
      ? options.cwd
      : process.cwd()
  const execPath =
    typeof options.execPath === 'string' && options.execPath.trim()
      ? options.execPath
      : process.execPath
  const resourcesPath =
    typeof options.resourcesPath === 'string' && options.resourcesPath.trim()
      ? options.resourcesPath
      : process.resourcesPath
  const effectiveRootDir =
    typeof options.rootDir === 'string' && options.rootDir.trim()
      ? options.rootDir
      : rootDir
  const execDir = execPath ? path.dirname(execPath) : null
  const candidateDirectories = [
    effectiveRootDir,
    options.portableExecutableDirectory,
    cwd,
    resourcesPath,
    execDir,
    execDir ? path.dirname(execDir) : null,
    execDir ? path.dirname(path.dirname(execDir)) : null,
  ].filter((value, index, values) =>
    typeof value === 'string' &&
    value.trim().length > 0 &&
    values.indexOf(value) === index,
  )

  return candidateDirectories.map((directory) => path.join(directory, '.env'))
}

dotenv.config({ path: path.join(rootDir, '.env'), override: false, quiet: true })

const port = Number(process.env.PORT ?? 3001)
const allowedCorsOrigin = undefined // Codex subscription access is local-only, never exposed by CORS.
const generationApiToken = process.env.FORGE_API_TOKEN?.trim()
const enablePromptOrchestration = process.env.ENABLE_PROMPT_ORCHESTRATION === 'true'
const forgeJsonLimit = process.env.FORGE_JSON_LIMIT ?? '12mb'
const characterSheetJsonLimit = process.env.CHARACTER_SHEET_JSON_LIMIT ?? '14mb'
const actionAnimatorJsonLimit = process.env.ACTION_ANIMATOR_JSON_LIMIT ?? '14mb'
const modelRegistry = { codex: 'codex-native' }
const modelProviderRegistry = { codex: 'codex' }
const routeModelDefaults = {
  '/api/action-animator': 'codex', '/api/character-sheet': 'codex',
  '/api/forge': 'codex', '/api/variant-forge-ideas': 'codex',
}
const actionAnimatorImageModels = ['codex']
const routeModelAllowlist = Object.fromEntries(Object.keys(routeModelDefaults).map(route => [route, ['codex']]))
const supportedForgeModes = forgeApiModes

const forgeBatchMaxParallelRequests = 4

const forgeGenerationTimeoutMs = clampTimeoutMs(
  Number(process.env.FOUNDRY_CODEX_TIMEOUT_MS ?? 600000),
  600000,
)
const textureLabMaxParallelRequests = Math.max(
  1,
  Math.min(Math.round(Number(process.env.TEXTURE_LAB_MAX_PARALLEL_REQUESTS ?? 2)), 2),
)
const textureLabGenerationTimeoutMs = clampTimeoutMs(
  Number(process.env.FOUNDRY_CODEX_TIMEOUT_MS ?? 600000),
  600000,
)
const textureLabBatchStartStaggerMs = clampNonNegativeInteger(
  Number(process.env.TEXTURE_LAB_BATCH_START_STAGGER_MS ?? 1500),
  1500,
)
const textureLabRetryJitterMs = clampNonNegativeInteger(
  Number(process.env.TEXTURE_LAB_RETRY_JITTER_MS ?? 800),
  800,
)

const forgeBatchRetryDelayMs = 1200
const maxPromptOrchestrationWordCount = 24
const maxPromptEnhancerWordCount = 9

const defaultActionAnimatorFrameSizePx = 512
const coreSystemRules = [
  'Always render assets on a neutral gray #808080 background.',
  'Never include text, logos, or watermarks in the image.',
  'Ensure all assets are centered and fit entirely within the frame.',
]

function redactErrorDetails(value) {
  if (typeof value === 'string') {
    let result = value
    for (const secret of [generationApiToken, process.env.OPENAI_API_KEY, process.env.CODEX_API_KEY].filter(Boolean)) result = result.split(secret).join('[redacted]')
    return result.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
  }
  if (Array.isArray(value)) return value.map(redactErrorDetails)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactErrorDetails(entry)]))
  return value
}
const generationContext = new AsyncLocalStorage()
const app = express()
const imageLibrary = createImageLibrary()

async function archiveGeneratedImages(response, mode, images, prompt) {
  try {
    await imageLibrary.save({ mode, images, prompt })
    if (!response.headersSent) response.set('X-Foundry-Library', 'saved')
  } catch (error) {
    console.error('Could not archive all generated images.', error.code || error.message)
    if (!response.headersSent) response.set('X-Foundry-Library', 'failed')
  }
}
app.use((_request, response, next) => {
  const json = response.json.bind(response)
  response.json = body => json(body?.error ? { ...body, error: redactErrorDetails(body.error) } : body)
  next()
})
const parseForgeBody = express.json({ limit: forgeJsonLimit })
const parseCharacterSheetBody = express.json({ limit: characterSheetJsonLimit })
const parseActionAnimatorBody = express.json({ limit: actionAnimatorJsonLimit })
const optionalGenerationAuth = createTokenAuthMiddleware({
  allowLoopback: false,
  envToken: generationApiToken,
  headerName: 'x-api-token',
  message: 'This generation route requires a valid API token.',
})
const forgeRateLimit = createRateLimiter({
  keyPrefix: 'forge',
  maxRequests: Number(process.env.FORGE_RATE_LIMIT_PER_MINUTE ?? 12),
})
const characterSheetRateLimit = createRateLimiter({
  keyPrefix: 'character-sheet',
  maxRequests: Number(process.env.CHARACTER_SHEET_RATE_LIMIT_PER_MINUTE ?? 8),
})
const actionAnimatorRateLimit = createRateLimiter({
  keyPrefix: 'action-animator',
  maxRequests: Number(process.env.ACTION_ANIMATOR_RATE_LIMIT_PER_MINUTE ?? 6),
})
const forgeConcurrencyLimit = createConcurrencyLimiter({
  limit: Number(process.env.FORGE_MAX_IN_FLIGHT ?? 3),
  routeLabel: 'Forge',
})
const characterSheetConcurrencyLimit = createConcurrencyLimiter({
  limit: Number(process.env.CHARACTER_SHEET_MAX_IN_FLIGHT ?? 2),
  routeLabel: 'Character Sheet',
})
const actionAnimatorConcurrencyLimit = createConcurrencyLimiter({
  limit: Number(process.env.ACTION_ANIMATOR_MAX_IN_FLIGHT ?? 1),
  routeLabel: 'Action Animator',
})

app.use(createSecurityHeadersMiddleware())
app.use(createCorsMiddleware({ allowedOrigin: allowedCorsOrigin }))

app.get('/api/health', async (_request, response) => {
  try {
    const runtime = await getCodexStatus()
    response.json({ ok: true, generationConfigured: runtime.ready, provider: 'codex', runtime })
  } catch {
    response.json({ ok: true, generationConfigured: false, provider: 'codex', runtime: { available: false, authenticated: false, ready: false, message: 'Codex is not available. Open Codex and sign in with ChatGPT, then check again.' } })
  }
})

app.use('/api', (request, response, next) => {
  if (request.method !== 'POST') return next()
  if (request.get('X-Foundry-Request') !== '1') {
    return response.status(403).json({ error: { code: 'request_forbidden', title: 'Request Forbidden', message: 'Use the local Foundry page to submit this request.' } })
  }
  const controller = new AbortController()
  response.on('close', () => { if (!response.writableEnded) controller.abort() })
  generationContext.run({ signal: controller.signal }, next)
})

app.use('/api/library', createImageLibraryRouter(imageLibrary))

app.post(
  '/api/action-animator',
  optionalGenerationAuth,
  actionAnimatorRateLimit,
  actionAnimatorConcurrencyLimit,
  parseActionAnimatorBody,
  async (request, response) => {
    let validatedRequest

    try {
      validatedRequest = validateActionAnimatorRequest(request.body ?? {})
    } catch (error) {
      response.status(400).json(toValidationResponse(error))
      return
    }

    const modelSelection = resolveActionAnimatorModelSelection({
      modelId: validatedRequest.modelId,
      pipeline: validatedRequest.pipeline,
    })

    if (!modelSelection.ok) {
      response.status(400).json({
        error: {
          code: 'model_unsupported',
          details: modelSelection.details,
          message: modelSelection.message,
          title: 'Model Not Supported For This Tab',
        },
      })
      return
    }

    const ai = createTextAi()

    try {
      const animatorResult = await generateAnimatorArtifacts({
        actionType: validatedRequest.actionType,
        ai,
        fps: validatedRequest.fps,
        firstFrame: validatedRequest.firstFrame,
        frameCount: validatedRequest.frameCount,
        frameSize: validatedRequest.normalizedSize,
        image: validatedRequest.image,
        keyColor: validatedRequest.keyColor,
        lastFrame: validatedRequest.lastFrame,
        modelSelection,
        pipeline: validatedRequest.pipeline,
        prompt: validatedRequest.prompt,
        quality: validatedRequest.quality,
      })

      const { spriteSheet, frames } = animatorResult.artifacts
      await archiveGeneratedImages(response, 'action-animator', [
        { ...spriteSheet, title: 'Sprite sheet' },
        ...frames.map((frame, index) => ({ ...frame, title: `Frame ${index + 1} of ${frames.length}` })),
      ], animatorResult.prompt)

      response.json({
        artifacts: animatorResult.artifacts,
        model: modelSelection.modelId,
        prompt: animatorResult.prompt,
        providerModel: modelSelection.providerModel,
      })
    } catch (error) {
      const normalizedError = normalizeGenerationError(
        error,
        modelSelection.modelId,
        modelSelection.provider,
      )

      response.status(normalizedError.status).json(normalizedError.body)
    }
  },
)

app.post(
  '/api/variant-forge-ideas',
  optionalGenerationAuth,
  forgeRateLimit,
  forgeConcurrencyLimit,
  parseForgeBody,
  async (request, response) => {

    let validatedRequest

    try {
      validatedRequest = validateVariantForgeIdeaRequest(request.body ?? {})
    } catch (error) {
      response.status(400).json(toValidationResponse(error))
      return
    }

    const modelSelection = resolveModelForRoute('/api/variant-forge-ideas')

    if (!modelSelection.ok) {
      response.status(500).json({
        error: {
          code: 'model_unavailable',
          details: modelSelection.details,
          message: modelSelection.message,
          title: 'Idea Refresh Is Unavailable',
        },
      })
      return
    }

    const ai = createTextAi()

    try {
      const generation = await ai.models.generateContent({
        model: modelSelection.providerModel,
        contents: [
          {
            text: buildVariantForgeIdeaPrompt(validatedRequest),
          },
        ],
        config: {
          candidateCount: 1,
          responseModalities: ['TEXT'],
          systemInstruction:
            'You generate short clickable Variant Forge idea chips for game asset iteration. ' +
            `Return exactly ${variantForgeIdeaSuggestionCount} distinct idea phrases, one per line, with no numbering, no bullets, no markdown, and no commentary. ` +
            'Each idea should be concise, production-usable, and specific to the provided Variant Forge context. ' +
            'Avoid repeating preset names verbatim unless that wording materially improves the idea.',
        },
      })

      response.json(
        normalizeVariantForgeIdeaResponse(
          typeof generation.text === 'string' ? generation.text : '',
          validatedRequest.variantFamily,
        ),
      )
    } catch {
      response.json(buildVariantForgeIdeaFallbackResponse(validatedRequest.variantFamily))
    }
  },
)

app.post(
  '/api/forge',
  optionalGenerationAuth,
  forgeRateLimit,
  forgeConcurrencyLimit,
  parseForgeBody,
  async (request, response) => {
  let validatedRequest

  try {
    validatedRequest = validateForgeRequest(request.body ?? {})
  } catch (error) {
    response.status(400).json(toValidationResponse(error))
    return
  }

  const {
    customDirection,
    effectLabel,
    exportTarget,
    mode,
    modelId,
    prompt,
    quality,
    preservePalette,
    preserveSilhouette,
    generationCount,
    intensity,
    looping,
    frameCount,
    references = [],
    styleId,
    styleText,
    systemInstruction,
    seamRepair,
    seamlessMode,
    textureKind,
    textureSize,
    textureExpansion,
    variantFamily,
    variantIntensity,
    variantOptions,
    variantPreset,
    workflow,
  } = validatedRequest

  if (!supportedForgeModes.includes(mode)) {
    response.status(400).json({ error: 'Unsupported forge mode.' })
    return
  }

  const requestedWorkflow =
    workflow === 'expand-texture'
      ? 'expand-texture'
      : workflow === 'repair-seams'
        ? 'repair-seams'
        : 'generate'
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedTextureSize = normalizeTextureLabOutputSize(textureSize)

  if (
    requestedWorkflow === 'generate' &&
    !normalizedPrompt &&
    mode !== 'variant-forge' &&
    mode !== 'portrait-studio' &&
    mode !== 'vfx-forge'
  ) {
    response.status(400).json({ error: 'A non-empty prompt is required.' })
    return
  }

  if (
    (requestedWorkflow === 'expand-texture' || requestedWorkflow === 'repair-seams') &&
    mode !== 'texture-lab'
  ) {
    response.status(400).json({
      error: 'Texture edit workflows are only supported inside Texture Lab.',
    })
    return
  }

  const candidateCount =
    requestedWorkflow === 'expand-texture' || requestedWorkflow === 'repair-seams'
      ? 1
      : Math.min(Math.max(Number(generationCount) || 1, 1), 4)
  const modelSelection = resolveModelForRoute('/api/forge', modelId)

  if (!modelSelection.ok) {
    response.status(400).json({
      error: {
        code: 'model_unsupported',
        details: modelSelection.details,
        message: modelSelection.message,
        title: 'Model Not Supported For This Tab',
      },
    })
    return
  }

  const validReferences = Array.isArray(references)
    ? references.filter(
        (reference) =>
          typeof reference?.mimeType === 'string' &&
          typeof reference?.data === 'string' &&
          reference.data.length > 0,
      )
    : []

  const ai = createTextAi()

  try {
    const providedStyleText =
      typeof styleText === 'string' && styleText.trim()
        ? styleText.trim()
        : typeof styleId === 'string' && styleId.trim()
        ? styleId.trim()
          : ''
    const finalPrompt =
      requestedWorkflow === 'expand-texture'
        ? buildTextureExpansionPrompt({
            prompt: normalizedPrompt,
            styleText: providedStyleText,
            textureExpansion,
          })
        : requestedWorkflow === 'repair-seams'
          ? buildSeamRepairPrompt({
              prompt: normalizedPrompt,
              styleText: providedStyleText,
            })
        : mode === 'variant-forge'
          ? buildVariantForgePrompt({
              customDirection,
              preservePalette,
              preserveSilhouette,
              styleText: providedStyleText,
              variantFamily,
              variantIntensity,
              variantOptions,
              variantPreset,
            })
        : mode === 'portrait-studio'
          ? buildPortraitStudioPrompt({
              prompt: normalizedPrompt,
              styleText: providedStyleText,
            })
        : mode === 'vfx-forge'
          ? buildVfxForgePromptForRequest({
              effectLabel,
              exportTarget,
              frameCount,
              hasStyleReference: validReferences.some(
                (reference) => reference.slot === 'style',
              ),
              intensity,
              looping,
              prompt: normalizedPrompt,
              styleText: providedStyleText,
              textureKind,
            })
        : await buildForgePromptWithBestPractices({
            ai,
            mode,
            prompt: normalizedPrompt,
            seamlessMode: Boolean(seamlessMode),
            styleText: providedStyleText,
            hasStyleReference: validReferences.some(
              (reference) => reference.slot === 'style',
            ),
            hasSubjectReference: validReferences.some(
              (reference) => reference.slot === 'subject',
            ),
            textureSize: normalizedTextureSize,
          })
    const resolvedSystemInstruction =
      requestedWorkflow === 'expand-texture'
        ? resolveTextureExpansionSystemInstruction(systemInstruction)
        : requestedWorkflow === 'repair-seams'
          ? resolveSeamRepairSystemInstruction(systemInstruction)
        : mode === 'variant-forge'
          ? resolveVariantForgeSystemInstruction(systemInstruction, {
              preservePalette,
              preserveSilhouette,
              variantFamily,
              variantIntensity,
              variantOptions,
              variantPreset,
            })
        : mode === 'portrait-studio'
          ? resolvePortraitStudioSystemInstruction(systemInstruction)
        : mode === 'vfx-forge'
          ? resolveVfxForgeSystemInstructionForRequest(systemInstruction, {
              frameCount,
              looping,
              textureKind,
            })
          : mode === 'texture-lab'
          ? resolveTextureGenerationSystemInstruction(systemInstruction, {
              seamlessMode: Boolean(seamlessMode),
              textureSize: normalizedTextureSize,
            })
        : resolveSystemInstruction(systemInstruction)
    if (requestedWorkflow === 'expand-texture') {
      try {
        // Codex native imagegen takes visual guides, not the Images API mask contract.
        const maskSupported = false
        const image = await processTexture(textureExpansion, {
          maskSupported,
          notes: [normalizedPrompt, providedStyleText].filter(Boolean).join(' '),
          generate: async ({ canvas, mask, size, prompt: texturePrompt }) => {
            const generation = await generateImagesWithModel({
              candidateCount: 1, modelSelection, prompt: texturePrompt, quality,
              references: [{ data: canvas.toString('base64'), mimeType: 'image/png' }],
              mask, routeKey: '/api/forge', size: `${size}x${size}`,
              googleConfig: { imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
              systemInstruction: systemInstruction || 'Follow the material edit instructions. Preserve context and feature scale.',
              timeoutMs: textureLabGenerationTimeoutMs,
            })
            if (!generation.images.length) throw new Error('The provider returned no texture image.')
            return generation.images[0]
          },
        })
        if (image.texture.status !== 'intermediate') {
          await archiveGeneratedImages(response, mode, [image], normalizedPrompt)
        }
        response.json({ images: [image], model: textureExpansion.technique === 'faithful' ? 'local-quilting' : modelSelection.modelId, prompt: normalizedPrompt })
      } catch (error) {
        response.status(422).json({ error: { code: 'texture_processing_failed', message: error.message, title: 'Texture operation failed' } })
      }
      return
    }

    if (requestedWorkflow === 'repair-seams') {
      const validRepair = normalizeSeamRepair(seamRepair)

      if (!validRepair) {
        response.status(400).json({
          error:
            'Seam repair requires the offset texture image and the original texture image.',
        })
        return
      }

      const generation = await generateImagesWithModel({
        candidateCount: 1,
        modelSelection,
        prompt: finalPrompt,
        quality,
        references: [validRepair.offsetImage, validRepair.originalImage],
        routeKey: '/api/forge',
        size: '1024x1024',
        systemInstruction: resolvedSystemInstruction,
        timeoutMs: textureLabGenerationTimeoutMs,
      })
      const images = await Promise.all(generation.images.map(image => normalizeTextureProviderImage(image, normalizedTextureSize, { matchEdges: true })))

      if (images.length === 0) {
        response
          .status(422)
          .json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
        return
      }

      await archiveGeneratedImages(response, mode, images, normalizedPrompt)
      response.json({
        images,
        model: modelSelection.modelId,
        prompt: finalPrompt,
        providerModel: modelSelection.providerModel,
        styleId: providedStyleText || null,
      })
      return
    }

    const generation = await generateImagesWithModel({
      candidateCount, modelSelection, prompt: finalPrompt, quality,
      references: validReferences, routeKey: '/api/forge',
      size: mode === 'texture-lab' ? `${normalizedTextureSize}x${normalizedTextureSize}` : mode === 'portrait-studio' ? '1536x1024' : '1024x1024',
      systemInstruction: resolvedSystemInstruction,
      timeoutMs: mode === 'texture-lab' ? textureLabGenerationTimeoutMs : forgeGenerationTimeoutMs,
    })
    const images = []
    const geometryErrors = []
    for (const image of generation.images) {
      try {
        images.push(mode === 'texture-lab' ? await normalizeTextureProviderImage(image, normalizedTextureSize, { matchEdges: seamlessMode }) : image)
      } catch (error) {
        geometryErrors.push(error.message)
      }
    }
    if (images.length === 0) {
      if (geometryErrors.length) response.status(422).json({ error: { code: 'texture_geometry_invalid', title: 'Texture Shape Needs Attention', message: geometryErrors[0] } })
      else response.status(422).json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
      return
    }
    const libraryImages = mode === 'vfx-forge'
      ? images.map(image => ({ ...image, title: `${resolveVfxEffectLabel(effectLabel)} · ${getVfxTextureLabel(textureKind)}` }))
      : images
    await archiveGeneratedImages(response, mode, libraryImages, normalizedPrompt)
    response.json({
      images, requestedCount: candidateCount, completedCount: images.length,
      partial: images.length < candidateCount,
      warning: images.length < candidateCount ? 'Only ' + images.length + ' of ' + candidateCount + ' requested images were returned. Successful outputs are preserved; no automatic retry was made.' + (geometryErrors.length ? ' ' + geometryErrors.join(' ') : '') : undefined,
      model: modelSelection.modelId, providerModel: modelSelection.providerModel,
      prompt: finalPrompt, styleId: providedStyleText || null,
    })
  } catch (error) {
    const normalizedError = normalizeGenerationError(
      error,
      modelSelection.modelId,
      modelSelection.provider,
    )

    response.status(normalizedError.status).json(normalizedError.body)
  }
  },
)

app.post(
  '/api/vfx-recipe',
  optionalGenerationAuth,
  forgeRateLimit,
  forgeConcurrencyLimit,
  parseForgeBody,
  async (request, response) => {
    let validatedRequest

    try {
      validatedRequest = validateVfxRecipeRequest(request.body ?? {})
    } catch (error) {
      response.status(400).json(toValidationResponse(error))
      return
    }

    response.json({
      recipe: buildVfxRecipeManifest(validatedRequest),
    })
  },
)

app.post(
  '/api/vfx-export',
  optionalGenerationAuth,
  forgeRateLimit,
  forgeConcurrencyLimit,
  parseForgeBody,
  async (request, response) => {
    let validatedRequest

    try {
      validatedRequest = validateVfxExportRequest(request.body ?? {})
    } catch (error) {
      response.status(400).json(toValidationResponse(error))
      return
    }

    let bundle
    try { bundle = await buildVfxExportBundle(validatedRequest) } catch (error) { response.status(400).json({ error: { code: 'invalid_vfx_texture', title: 'Invalid VFX texture', message: error.message } }); return }
    const normalizedEffectLabel = resolveVfxEffectLabel(validatedRequest.effectLabel)
    const fileName = [
      'kizer-forge',
      'vfx',
      normalizedEffectLabel,
      'bundle.zip',
    ]
      .join('-')
      .toLowerCase()
      .replace(/[^a-zA-Z0-9.-]+/g, '-')

    response.setHeader('Content-Type', 'application/zip')
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    response.send(bundle)
  },
)

app.post(
  '/api/character-sheet',
  optionalGenerationAuth,
  characterSheetRateLimit,
  characterSheetConcurrencyLimit,
  parseCharacterSheetBody,
  async (request, response) => {
  let validatedRequest

  try {
    validatedRequest = validateCharacterSheetRequest(request.body ?? {})
  } catch (error) {
    response.status(400).json(toValidationResponse(error))
    return
  }

  const {
    aspectRatio = '16:9',
    consistencyReference,
    generationMode,
    modelId,
    parentId,
    prompt,
    quality,
    references = [],
    styleId,
    systemInstruction,
  } = validatedRequest

  if (generationMode !== 'reference' && generationMode !== 'manifest') {
    response.status(400).json({ error: 'Unsupported character sheet generation mode.' })
    return
  }

  if (typeof prompt !== 'string' || !prompt.trim()) {
    response.status(400).json({ error: 'A non-empty character sheet prompt is required.' })
    return
  }

  const modelSelection = resolveModelForRoute('/api/character-sheet', modelId)

  if (!modelSelection.ok) {
    response.status(400).json({
      error: {
        code: 'model_unsupported',
        details: modelSelection.details,
        message: modelSelection.message,
        title: 'Model Not Supported For This Tab',
      },
    })
    return
  }

  const validReferences = Array.isArray(references)
    ? references.filter(
        (reference) =>
          typeof reference?.mimeType === 'string' &&
          typeof reference?.data === 'string' &&
          reference.data.length > 0 &&
          typeof reference?.role === 'string',
      )
    : []

  if (generationMode === 'reference' && validReferences.length !== 3) {
    response.status(400).json({
      error:
        'Reference mode requires Face, Outfit, and Art Style uploads before the sheet can be generated.',
    })
    return
  }

  const ai = createTextAi()

  try {
    const trimmedPrompt = prompt.trim()
    const styleLabel =
      typeof styleId === 'string' && styleId.trim() ? styleId.trim() : 'studio-default'
    const promptForGeneration = await maybeEnhancePrompt({
      ai,
      prompt: trimmedPrompt,
      styleLabel,
    })

    const generation = await generateImagesWithModel({
      candidateCount: 1,
      googleConfig: {
        aspectRatio,
      },
      modelSelection,
      prompt: consistencyReference
        ? `${promptForGeneration}\n\nMaintain character identity, outfit structure, and palette continuity with the staged prior sheet reference.`
        : promptForGeneration,
      quality,
      references: [
        ...(consistencyReference ? [consistencyReference] : []),
        ...validReferences,
      ],
      routeKey: '/api/character-sheet',
      size: (aspectRatio === '2:3' ? '1024x1536' : '1536x1024'),
      systemInstruction: resolveSystemInstruction(
        typeof systemInstruction === 'string' && systemInstruction.trim()
          ? systemInstruction.trim()
          : 'Provide the 5 dominant hex codes for this character at the end of the response.',
      ),
      timeoutMs: forgeGenerationTimeoutMs,
    })

    const images = generation.images

    if (images.length === 0) {
      response
        .status(422)
        .json(
          buildNoImageResponseError(
            '/api/character-sheet',
            modelSelection,
            generation.text,
          ),
        )
      return
    }

    await archiveGeneratedImages(response, 'character-sheet', images, trimmedPrompt)
    response.json({
      images,
      model: modelSelection.modelId,
      providerModel: modelSelection.providerModel,
      parentId: typeof parentId === 'string' ? parentId : null,
      prompt: trimmedPrompt,
      styleId: styleLabel,
    })
  } catch (error) {
    const normalizedError = normalizeGenerationError(
      error,
      modelSelection.modelId,
      modelSelection.provider,
    )

    response.status(normalizedError.status).json(normalizedError.body)
  }
  },
)

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir))

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((error, _request, response, next) => {
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    response.status(413).json({
      error: {
        code: 'payload_too_large',
        message: 'The request body exceeds the configured size limit.',
        title: 'Payload Too Large',
      },
    })
    return
  }

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      error: {
        code: 'invalid_json',
        message: 'The request body is not valid JSON.',
        title: 'Invalid JSON',
      },
    })
    return
  }

  next(error)
})

export { app }

export function startServer() {
  console.log(
    JSON.stringify({
      allowCorsOrigin: allowedCorsOrigin || 'same-origin only',
      generationAuth: generationApiToken ? 'token-required' : 'disabled',
      promptOrchestration: enablePromptOrchestration,
      trustBoundary: 'Managed Codex ChatGPT sign-in; loopback-only; no API-key fallback',
      type: 'server-security-config',
    }),
  )
  const host = process.env.HOST ?? '127.0.0.1'
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Codex generation is loopback-only. HOST must be 127.0.0.1, localhost, or ::1.')
  return app.listen(port, host, () => {
    console.log(`Kizer Forge API listening on http://localhost:${port}`)
  })
}

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.FOUNDRY_ELECTRON_MAIN !== 'true'
) {
  startServer()
}

async function buildForgePromptWithBestPractices({
  ai,
  mode,
  prompt,
  seamlessMode,
  styleText,
  hasStyleReference,
  hasSubjectReference,
  textureSize,
}) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText =
    typeof styleText === 'string' ? styleText.trim() : ''
  const normalizedTextureSize = normalizeTextureLabOutputSize(textureSize)

  if (!normalizedPrompt) {
    return ''
  }

  if (
    !enablePromptOrchestration ||
    countWords(normalizedPrompt) > maxPromptOrchestrationWordCount
  ) {
    return buildForgePromptFallback({
      mode,
      prompt: normalizedPrompt,
      seamlessMode,
      styleText: normalizedStyleText,
      hasStyleReference,
      hasSubjectReference,
      textureSize: normalizedTextureSize,
    })
  }

  if (mode === 'texture-lab' && seamlessMode) {
    return buildSemanticTilingPrompt({
      prompt: normalizedPrompt,
      styleText: normalizedStyleText,
      textureSize: normalizedTextureSize,
    })
  }

  if (!ai || !ai.models || typeof ai.models.generateContent !== 'function') {
    return buildForgePromptFallback({
      mode,
      prompt: normalizedPrompt,
      seamlessMode,
      styleText: normalizedStyleText,
      hasStyleReference,
      hasSubjectReference,
      textureSize: normalizedTextureSize,
    })
  }

  const orchestratorModel = modelRegistry.codex

  if (!orchestratorModel) {
    return buildForgePromptFallback({
      mode,
      prompt: normalizedPrompt,
      seamlessMode,
      styleText: normalizedStyleText,
      hasStyleReference,
      hasSubjectReference,
      textureSize: normalizedTextureSize,
    })
  }

  const modeTask =
    mode === 'texture-lab'
      ? seamlessMode
        ? 'Build a seamless, tile-safe texture prompt for production use.'
        : 'Build a square production texture prompt for material generation.'
      : mode === 'visualizer'
        ? 'Build a cinematic concept-visualization prompt for high-end presentation.'
        : 'Build a production-ready game asset prompt with strong silhouette clarity.'
  const modeContext =
    mode === 'texture-lab'
      ? 'Top-down material authoring workflow for repeatable texture generation.'
      : mode === 'visualizer'
        ? 'Visual development workflow for mood, composition, and scene storytelling.'
        : 'Armory workflow for props, gear, and usable in-game items.'
  const referenceContext = [
    hasStyleReference
      ? 'A style image reference is attached; preserve its rendering language.'
      : null,
    hasSubjectReference
      ? 'A subject image reference is attached; preserve structure and identity.'
      : null,
    mode === 'texture-lab'
      ? `Delivery target: ${normalizedTextureSize} x ${normalizedTextureSize} square texture.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')

  try {
    const promptGeneration = await ai.models.generateContent({
      model: orchestratorModel,
      contents: [
        {
          text: [
            `User Prompt: ${normalizedPrompt}`,
            `User Style Input: ${normalizedStyleText || 'No style input provided.'}`,
            `Task Context: ${modeTask}`,
            `Workflow Context: ${modeContext}`,
            referenceContext ? `Reference Context: ${referenceContext}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      config: {
        candidateCount: 1,
        responseModalities: ['TEXT'],
        systemInstruction:
          'You are a senior prompt engineer for image generation in game pipelines. ' +
          'Use PTCF structure (Persona, Task, Context, Format) and best practices. ' +
          'Return exactly one concise production prompt paragraph with no markdown and no bullets.',
      },
    })

    const generatedPrompt =
      typeof promptGeneration.text === 'string' ? promptGeneration.text.trim() : ''

    if (generatedPrompt) {
      return generatedPrompt
    }
  } catch {
    // Fall back to deterministic prompt if orchestration fails.
  }

  return buildForgePromptFallback({
    mode,
    prompt: normalizedPrompt,
    seamlessMode,
    styleText: normalizedStyleText,
    hasStyleReference,
    hasSubjectReference,
    textureSize: normalizedTextureSize,
  })
}

function buildForgePromptFallback({
  mode,
  prompt,
  seamlessMode,
  styleText,
  hasStyleReference,
  hasSubjectReference,
  textureSize,
}) {
  const normalizedTextureSize = normalizeTextureLabOutputSize(textureSize)

  if (mode === 'texture-lab' && seamlessMode) {
    return buildSemanticTilingPrompt({
      prompt,
      styleText,
      textureSize: normalizedTextureSize,
    })
  }

  const modeBestPractices =
    mode === 'texture-lab'
      ? `${seamlessMode ? 'seamless tile-safe structure' : 'square top-down material read'}, flat lighting, controlled surface scale, ${normalizedTextureSize} x ${normalizedTextureSize} square delivery`
      : mode === 'visualizer'
        ? 'cinematic composition, clear focal hierarchy, premium lighting control'
        : 'clean silhouette readability, material clarity, game-ready presentation'
  const referenceGuidance = [
    hasStyleReference ? 'Honor the attached style reference.' : null,
    hasSubjectReference ? 'Honor the attached subject reference.' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return [
    'Persona: Senior concept artist for game production.',
    `Task: Generate one ${mode} image candidate from the request.`,
    `Context: ${modeBestPractices}. ${referenceGuidance}`.trim(),
    'Format: One concise technical prompt.',
    `Style Direction: ${styleText || 'Use a neutral studio-quality style.'}`,
    `User Request: ${prompt}`,
  ].join('\n')
}

function buildSemanticTilingPrompt({ prompt, styleText, textureSize }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText =
    typeof styleText === 'string' && styleText.trim()
      ? styleText.trim()
      : 'neutral production texture'
  const normalizedTextureSize = normalizeTextureLabOutputSize(textureSize)

  return (
    `Create a seamless repeating pattern of ${normalizedPrompt}. ` +
    'Ensure smooth transitions at the edges for flawless tiling. ' +
    `Style: ${normalizedStyleText}, final delivery ${normalizedTextureSize} x ${normalizedTextureSize}, high resolution, perfectly tileable horizontal and vertical edges, balanced composition. ` +
    'Seamless repeating texture, tileable edges.'
  )
}

function buildTextureExpansionPrompt({ prompt, styleText }) {
  return ['Expand the source material with varied new surrounding detail.', prompt, styleText].filter(Boolean).join(' ')
}

function buildSeamRepairPrompt({ prompt, styleText }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText =
    typeof styleText === 'string' && styleText.trim()
      ? styleText.trim()
      : 'neutral production texture'

  return [
    'Seamlessly blend the seams in the center of this image to create a perfect continuous texture.',
    'Keep the style, scale, material breakup, and colors identical to the reference.',
    'Preserve the original top-down material behavior and generate no new composition shift.',
    normalizedPrompt ? `Original material request: ${normalizedPrompt}.` : null,
    `Style guidance: ${normalizedStyleText}.`,
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildVariantForgePrompt({
  customDirection,
  preservePalette,
  preserveSilhouette,
  styleText,
  variantFamily,
  variantIntensity,
  variantOptions,
  variantPreset,
}) {
  const normalizedFamily = normalizeVariantForgeFamily(variantFamily)
  const normalizedPreset = normalizeVariantForgePreset(normalizedFamily, variantPreset)
  const normalizedOptions = normalizeVariantForgeOptions(normalizedFamily, variantOptions)
  const normalizedIntensity = clampPercentage(variantIntensity, 60)
  const normalizedStyleText =
    typeof styleText === 'string' && styleText.trim() ? styleText.trim() : ''
  const normalizedCustomDirection =
    typeof customDirection === 'string' && customDirection.trim()
      ? customDirection.trim()
      : ''

  if (normalizedFamily === 'rarity') {
    const normalizedRarity = normalizeLootRarity(normalizedPreset)
    const rarityEffects = {
      common: 'Keep the asset grounded and production clean.',
      rare: 'Add minor engravings, subtle shine, and restrained rarity cues.',
      epic: 'Introduce glow accents, premium materials, and a bolder rarity read.',
      legendary:
        'Add elemental aura language, floating shards, and dramatic premium VFX accents.',
    }

    return [
      normalizedOptions.length > 0
        ? 'Upgrade the attached base asset into a higher-rarity game item render.'
        : 'Upgrade the attached base asset using broad rarity-family upgrade language without locking to a specific rarity tier.',
      preserveSilhouette
        ? 'Preserve the original silhouette, proportions, and core weapon or item type exactly.'
        : 'Keep the core weapon or item type identical to the source asset and allow only slight silhouette drift.',
      normalizedOptions.length > 0 ? `Rarity target: ${normalizedRarity}.` : null,
      normalizedOptions.length > 0 ? rarityEffects[normalizedRarity] : null,
      normalizedOptions.length > 1
        ? `Active rarity options: ${normalizedOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')}.`
        : null,
      ...normalizedOptions
        .filter((option) => option.customSetting)
        .map(
          (option) =>
            `${formatVariantForgeLabel(option.preset)} custom setting: ${option.customSetting}.`,
        ),
      `Apply the upgrade at ${normalizedIntensity} out of 100 strength as a single controlled transformation.`,
      preservePalette ? 'Keep the original palette close while applying the rarity pass.' : null,
      normalizedCustomDirection ? `Additional direction: ${normalizedCustomDirection}.` : null,
      normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  const familyGuidance = {
    alignment: 'Shift the asset through belief, blessing, or corruption cues without changing what the item is.',
    boss: 'Elevate the asset into a high-threat encounter variant with stronger premium storytelling.',
    damage: 'Control wear, repair state, and structural condition while keeping the item class and identity intact.',
    elemental: 'Infuse the asset with elemental material behavior and energy cues tied to the selected preset.',
    tech: 'Rebuild the finish language around fabrication, machinery, or arcane engineering without changing the prop type.',
  }
  const presetGuidance = {
    'arcane-tech': 'Blend occult engineering, runic circuitry, and powered components into the finish.',
    'boss-tier': 'Use dramatic encounter-grade materials, command presence, and premium detailing.',
    broken: 'Show major wear, structural failure, and hard-use breakage.',
    burning: 'Introduce heat bloom, ember residue, soot, and active burn treatment.',
    corrupted: 'Add blighted materials, invasive dark influence, and ominous energy traces.',
    damaged: 'Show moderate wear, chipped edges, and visible stress to the structure.',
    elite: 'Push the base design toward a sharper elite encounter read with controlled premium treatment.',
    frozen: 'Apply frost growth, icy material shift, and cold crystalline accumulation.',
    holy: 'Add sanctified polish, clean radiant cues, and ceremonial premium treatment.',
    industrial: 'Use fabricated plating, bolts, utility reinforcement, and rugged machine finishing.',
    'low-tech': 'Use simpler fabrication, improvised materials, and stripped-down construction details.',
    'no-damage': 'Keep the asset structurally intact, clean, and free of visible damage or wear.',
    stormcharged: 'Apply charged edges, electric bloom, and storm-reactive energy language.',
    worn: 'Add light weathering, softened finish, and believable production wear.',
  }

  return [
    'Transform the attached base asset into a controlled single-image variant.',
    preserveSilhouette
      ? 'Preserve the original silhouette, proportions, and item class.'
      : 'Keep the original item class and subject identity intact while allowing only minor silhouette drift.',
    'Never convert the asset into a different weapon, tool, or prop type.',
    `Variant family: ${formatVariantForgeLabel(normalizedFamily)}.`,
    normalizedOptions.length > 0
      ? `Variant preset: ${formatVariantForgeLabel(normalizedPreset)}.`
      : 'Variant preset toggles: none enabled.',
    normalizedOptions.length > 1
      ? `Active option blend: ${normalizedOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')}.`
      : null,
    familyGuidance[normalizedFamily],
    normalizedOptions.length > 0 ? presetGuidance[normalizedPreset] : null,
    ...normalizedOptions.map((option) =>
      option.customSetting
        ? `${formatVariantForgeLabel(option.preset)} custom setting: ${option.customSetting}.`
        : null,
    ),
    preservePalette
      ? 'Keep the source palette family close while changing finish and story cues.'
      : 'Palette shifts are allowed if they support the selected variant.',
    `Variant intensity: ${normalizedIntensity} out of 100. Treat intensity as transformation strength only.`,
    normalizedCustomDirection ? `Additional direction: ${normalizedCustomDirection}.` : null,
    normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildVariantForgeIdeaPrompt({
  customDirection,
  preservePalette,
  preserveSilhouette,
  styleText,
  variantFamily,
  variantIntensity,
  variantOptions,
  variantPreset,
}) {
  const normalizedFamily = normalizeVariantForgeFamily(variantFamily)
  const normalizedPreset = normalizeVariantForgePreset(normalizedFamily, variantPreset)
  const normalizedOptions = normalizeVariantForgeOptions(normalizedFamily, variantOptions)
  const normalizedIntensity = clampPercentage(variantIntensity, 60)
  const normalizedStyleText =
    typeof styleText === 'string' && styleText.trim() ? styleText.trim() : ''
  const normalizedCustomDirection =
    typeof customDirection === 'string' && customDirection.trim()
      ? customDirection.trim()
      : ''

  return [
    `Variant family: ${formatVariantForgeLabel(normalizedFamily)}.`,
    `Lead preset: ${formatVariantForgeLabel(normalizedPreset)}.`,
    normalizedOptions.length > 0
      ? `Enabled presets: ${normalizedOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')}.`
      : 'Enabled presets: none.',
    ...normalizedOptions
      .filter((option) => option.customSetting)
      .map(
        (option) =>
          `${formatVariantForgeLabel(option.preset)} custom setting: ${option.customSetting}.`,
      ),
    normalizedCustomDirection
      ? `Family direction: ${normalizedCustomDirection}.`
      : 'Family direction: none provided.',
    preserveSilhouette
      ? 'Preserve silhouette: yes.'
      : 'Preserve silhouette: allow minor drift.',
    preservePalette
      ? 'Preserve palette: yes.'
      : 'Preserve palette: shifts are allowed.',
    `Intensity: ${normalizedIntensity} out of 100.`,
    normalizedStyleText
      ? `Style guidance: ${normalizedStyleText}.`
      : 'Style guidance: none provided.',
  ].join('\n')
}

export function normalizeVariantForgeIdeaResponse(generationText, variantFamily) {
  const normalizedFamily = normalizeVariantForgeFamily(variantFamily)
  const fallbackResponse = buildVariantForgeIdeaFallbackResponse(normalizedFamily)
  const candidateIdeas = extractVariantForgeIdeaCandidates(generationText)
  const uniqueIdeas = []
  const seenIdeas = new Set()

  candidateIdeas.forEach((idea) => {
    if (uniqueIdeas.length >= variantForgeIdeaSuggestionCount) {
      return
    }

    const normalizedIdea = sanitizeVariantForgeIdeaCandidate(idea)
    const normalizedKey = normalizedIdea.toLowerCase()

    if (!normalizedIdea || seenIdeas.has(normalizedKey)) {
      return
    }

    seenIdeas.add(normalizedKey)
    uniqueIdeas.push(normalizedIdea)
  })

  if (uniqueIdeas.length < variantForgeIdeaSuggestionCount) {
    return fallbackResponse
  }

  return {
    ideas: uniqueIdeas,
    source: 'ai',
  }
}

function buildPortraitStudioPrompt({ prompt, styleText }) {
  const emotions = ['Neutral', 'Angry', 'Sad', 'Joy', 'Surprised']
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  return [
    'Create a 3 column by 2 row portrait sheet with five close-up hero portraits.',
    `Expressions required: ${emotions.join(', ')}.`,
    'Keep the facial structure, hair, skin tone, and eye color identical in every portrait.',
    'Only the eyebrows, eyelids, and mouth should change to express emotion.',
    'The sixth panel may remain a clean blank card or subtle title card.',
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
    styleText ? `Style guidance: ${styleText}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export function resolveForgeBatchWorkerCount(
  mode,
  workflow = 'generate',
  candidateCount = 1,
) {
  if (mode === 'texture-lab' && workflow === 'generate') {
    return Math.min(candidateCount, textureLabMaxParallelRequests)
  }

  return Math.min(candidateCount, forgeBatchMaxParallelRequests)
}

export function resolveForgeWorkerStartDelayMs(
  mode,
  workflow = 'generate',
  workerIndex = 0,
) {
  if (mode === 'texture-lab' && workflow === 'generate' && workerIndex > 0) {
    return workerIndex * textureLabBatchStartStaggerMs
  }

  return 0
}

export function resolveForgeRetryDelay({
  mode,
  randomValue = Math.random(),
  retryAfterSeconds,
  workflow = 'generate',
}) {
  const baseDelayMs =
    typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : forgeBatchRetryDelayMs
  const shouldApplyTextureLabJitter = mode === 'texture-lab' && workflow === 'generate'
  const normalizedRandomValue =
    Number.isFinite(randomValue) && randomValue >= 0
      ? Math.min(randomValue, 0.999999999)
      : 0
  const jitterMs = shouldApplyTextureLabJitter
    ? Math.floor(normalizedRandomValue * (textureLabRetryJitterMs + 1))
    : 0

  return {
    baseDelayMs,
    effectiveDelayMs: baseDelayMs + jitterMs,
    jitterMs,
  }
}

function resolveSystemInstruction(customInstruction) {
  if (typeof customInstruction !== 'string' || !customInstruction.trim()) {
    return coreSystemRules.join('\n')
  }

  return `${coreSystemRules.join('\n')}\n${customInstruction.trim()}`
}

function resolveTextureExpansionSystemInstruction(customInstruction) {
  const textureExpansionRules = [
    'This request is a texture outpainting task.',
    'The input reference is the expansion canvas: a smaller source texture centered inside surrounding context.',
    'The full output must be covered by texture detail from edge to edge.',
    'Do not leave any flat background color, blank border, transparent area, or studio backdrop visible.',
    'Do not introduce perspective, camera tilt, or directional shadows.',
    'Preserve the centered source texture as the visual anchor for the full material.',
    'Do not return the original source image as a full-frame copy.',
    'Treat any blurred or noisy outer canvas content as disposable context, not final texture detail.',
    'Synthesize new border detail instead of duplicating, mirroring, or stamping the center image.',
    'Keep texel density stable from center to edge.',
    'The final full canvas must be tile-safe: top must match bottom and left must match right.',
  ]

  return [coreSystemRules.slice(1).join('\n'), textureExpansionRules.join('\n'), customInstruction]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

export function resolveVariantForgeSystemInstruction(
  customInstruction,
  {
    preservePalette,
    preserveSilhouette,
    variantFamily,
    variantIntensity,
    variantOptions,
    variantPreset,
  },
) {
  const normalizedFamily = normalizeVariantForgeFamily(variantFamily)
  const normalizedPreset = normalizeVariantForgePreset(normalizedFamily, variantPreset)
  const normalizedOptions = normalizeVariantForgeOptions(normalizedFamily, variantOptions)
  const normalizedIntensity = clampPercentage(variantIntensity, 60)

  if (normalizedFamily === 'rarity') {
    const normalizedRarity = normalizeLootRarity(normalizedPreset)
    const strengthGuidance = {
      common: 'Keep changes minimal and close to the original base asset.',
      rare: 'Apply a low-strength rarity upgrade pass.',
      epic: 'Apply a medium-strength rarity upgrade pass.',
      legendary: 'Apply a high-strength rarity upgrade pass.',
    }

    return [
      coreSystemRules.join('\n'),
      preserveSilhouette
        ? 'Maintain the silhouette and core geometry of the input image.'
        : 'Keep the original item type identical and allow only minimal silhouette drift.',
      'Keep the weapon or item type identical to the source asset.',
      normalizedOptions.length > 0
        ? `Apply ${normalizedRarity} visual upgrades only.`
        : 'Apply broad rarity-family upgrade cues only and do not lock to a named rarity tier unless the custom instruction asks for it.',
      normalizedOptions.length > 0 ? strengthGuidance[normalizedRarity] : null,
      normalizedOptions.length > 1
        ? `Blend these active rarity options: ${normalizedOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')}.`
        : null,
      ...normalizedOptions
        .filter((option) => option.customSetting)
        .map(
          (option) =>
            `${formatVariantForgeLabel(option.preset)} custom setting: ${option.customSetting}.`,
        ),
      `Treat ${normalizedIntensity} out of 100 only as the strength of the rarity pass.`,
      preservePalette ? 'Keep the palette close to the source item.' : null,
      customInstruction,
    ]
      .filter((value) => typeof value === 'string' && value.trim())
      .join('\n')
  }

  return [
    coreSystemRules.join('\n'),
    preserveSilhouette
      ? 'Maintain the silhouette and core geometry of the input image.'
      : 'Keep the original item class intact and allow only limited silhouette drift.',
    'Preserve the subject identity and never change the asset into a different weapon or prop type.',
    normalizedOptions.length > 0
      ? `Use ${normalizedFamily} family cues and ${normalizedPreset} preset cues to alter finish, material, wear, and story detail only.`
      : `Use ${normalizedFamily} family cues to alter finish, material, wear, and story detail only, without applying any named preset cues.`,
    normalizedOptions.length > 1
      ? `Blend these active options: ${normalizedOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')}.`
      : null,
    ...normalizedOptions
      .filter((option) => option.customSetting)
      .map(
        (option) =>
          `${formatVariantForgeLabel(option.preset)} custom setting: ${option.customSetting}.`,
      ),
    preservePalette
      ? 'Keep the source palette family close to the original image.'
      : 'Palette shifts are allowed when they support the selected variant.',
    `Treat ${normalizedIntensity} out of 100 as a strength modifier, not a separate workflow.`,
    customInstruction,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

function resolvePortraitStudioSystemInstruction(customInstruction) {
  const portraitRules = [
    'This request creates a portrait expression pack.',
    'Keep the facial structure, hair shape, eye color, and identity 100% identical to the reference image.',
    'Only modify the eyebrows, eyelids, and mouth to convey each requested emotion.',
    'Arrange the final output as a clean 3 column by 2 row layout.',
  ]

  return [coreSystemRules.join('\n'), portraitRules.join('\n'), customInstruction]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

function resolveSeamRepairSystemInstruction(customInstruction) {
  const seamRepairRules = [
    'This request is a texture seam repair task.',
    'The offset seam crossing the center must be blended until the texture tiles cleanly.',
    'Keep the material identical to the original texture reference.',
    'Do not introduce perspective, lighting changes, flat background areas, or compositional motifs.',
    'The final full canvas must remain perfectly tile-safe on both axes.',
  ]

  return [coreSystemRules.slice(1).join('\n'), seamRepairRules.join('\n'), customInstruction]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

function resolveTextureGenerationSystemInstruction(
  customInstruction,
  { seamlessMode, textureSize },
) {
  const normalizedTextureSize = normalizeTextureLabOutputSize(textureSize)
  const textureRules = [
    'This request is a full-frame material texture generation task.',
    'Fill the image edge to edge with texture detail. Do not create a backdrop or empty border.',
    'Keep the view top-down and lighting flat and production-safe.',
    `Deliver a square texture intended for ${normalizedTextureSize} x ${normalizedTextureSize} output.`,
    seamlessMode
      ? 'The result must tile seamlessly on both the horizontal and vertical edges.'
      : null,
  ]

  return [coreSystemRules.slice(1).join('\n'), textureRules.join('\n'), customInstruction]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

function normalizeTextureLabOutputSize(value) {
  return Number(value) <= 512 ? 512 : 1024
}

function buildVariantForgeIdeaFallbackResponse(variantFamily) {
  return {
    ideas: pickVariantForgeIdeaSuggestions(
      variantFamily,
      variantForgeIdeaSuggestionCount,
    ),
    source: 'fallback',
  }
}

function extractVariantForgeIdeaCandidates(generationText) {
  const normalizedText =
    typeof generationText === 'string' ? generationText.trim() : ''

  if (!normalizedText) {
    return []
  }

  try {
    const parsedValue = JSON.parse(normalizedText)

    if (Array.isArray(parsedValue)) {
      return parsedValue.filter((entry) => typeof entry === 'string')
    }

    if (Array.isArray(parsedValue?.ideas)) {
      return parsedValue.ideas.filter((entry) => typeof entry === 'string')
    }
  } catch {
    // Fall through to line-based parsing when the model does not return JSON.
  }

  return normalizedText
    .replace(/\r/g, '')
    .replace(/(?:^|\n)\s*\d+[.)]\s+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function sanitizeVariantForgeIdeaCandidate(value) {
  return String(value)
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,!?]+$/g, '')
    .trim()
}

async function maybeEnhancePrompt({ ai, prompt, styleLabel }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  if (
    !enablePromptOrchestration ||
    !normalizedPrompt ||
    countWords(normalizedPrompt) > maxPromptEnhancerWordCount
  ) {
    return normalizedPrompt
  }

  const enhancerModel = modelRegistry.codex

  if (!enhancerModel) {
    return normalizedPrompt
  }

  if (!ai || !ai.models || typeof ai.models.generateContent !== 'function') {
    return normalizedPrompt
  }

  try {
    const enhancement = await ai.models.generateContent({
      model: enhancerModel,
      contents: [{ text: normalizedPrompt }],
      config: {
        candidateCount: 1,
        responseModalities: ['TEXT'],
        systemInstruction:
          `You are an art director. Expand this simple idea into a technical prompt for ${styleLabel}, ` +
          'adding specific lighting and material details. Return exactly one concise paragraph.',
      },
    })

    const enhancedPrompt =
      typeof enhancement.text === 'string' ? enhancement.text.trim() : ''
    return enhancedPrompt || normalizedPrompt
  } catch {
    return normalizedPrompt
  }
}

function countWords(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function normalizeSeamRepair(seamRepair) {
  const offsetImage = seamRepair?.offsetImage
  const originalImage = seamRepair?.originalImage

  if (
    typeof offsetImage?.mimeType !== 'string' ||
    typeof offsetImage?.data !== 'string' ||
    !offsetImage.data.length ||
    typeof originalImage?.mimeType !== 'string' ||
    typeof originalImage?.data !== 'string' ||
    !originalImage.data.length
  ) {
    return null
  }

  return {
    offsetImage: {
      data: offsetImage.data,
      mimeType: offsetImage.mimeType,
    },
    originalImage: {
      data: originalImage.data,
      mimeType: originalImage.mimeType,
    },
  }
}

async function generateAnimatorArtifacts({
  actionType,
  fps,
  firstFrame,
  frameCount,
  frameSize,
  image,
  keyColor,
  lastFrame,
  modelSelection,
  pipeline,
  prompt,
  quality,
}) {
  const normalizedFrameSize = normalizeActionAnimatorFrameSize(frameSize)
  const normalizedFps = clampActionAnimatorFps(fps)
  const normalizedFrameCount = clampAnimatorFrameCount(frameCount)
  const normalizedKeyColor = resolveActionAnimatorKeyColor(keyColor)
  const normalizedPrompt = buildAnimatorPrompt({
    actionType,
    fps: normalizedFps,
    hasFirstFrameGuide: Boolean(firstFrame),
    frameCount: normalizedFrameCount,
    keyColor: normalizedKeyColor,
    hasLastFrameGuide: Boolean(lastFrame),
    pipeline,
    prompt,
  })
  if (pipeline === 'image-strip') {
    const generation = await generateImagesWithModel({
      candidateCount: 1,
      googleConfig: {
        aspectRatio: '3:2',
      },
      modelSelection,
      prompt: normalizedPrompt,
      quality,
      references: [
        {
          data: image.data,
          mimeType: image.mimeType,
          name: image.name || 'character-reference.png',
        },
        ...(firstFrame
          ? [
              {
                data: firstFrame.data,
                mimeType: firstFrame.mimeType,
                name: firstFrame.name || 'first-frame-guide.png',
              },
            ]
          : []),
        ...(lastFrame
          ? [
              {
                data: lastFrame.data,
                mimeType: lastFrame.mimeType,
                name: lastFrame.name || 'last-frame-guide.png',
              },
            ]
          : []),
      ],
      routeKey: '/api/action-animator',
      size: animatorCanvas.width + 'x' + animatorCanvas.height,
      systemInstruction:
        'Return exactly one landscape sprite grid image following the specified rows and columns. ' +
        'Do not add text, labels, borders, UI, or extra panels outside the requested animation frames.',
      timeoutMs: forgeGenerationTimeoutMs,
    })
    const spriteSheetImage = generation.images[0]

    if (!spriteSheetImage?.data) {
      const noImageError = buildNoImageResponseError(
        '/api/action-animator',
        modelSelection,
        generation.text,
        [],
        getActionAnimatorAllowedModelIds('image-strip'),
      )
      const error = new Error(noImageError.error.message)
      error.status = 422
      error.payload = noImageError
      throw error
    }

    const artifactPayload = await createActionAnimatorArtifactsFromImageStrip({
      frameCount: normalizedFrameCount,
      frameSize: normalizedFrameSize,
      fps: normalizedFps,
      keyColor: normalizedKeyColor,
      prompt: normalizedPrompt,
      sourceImageBuffer: Buffer.from(spriteSheetImage.data, 'base64'),
      sourceModel: modelSelection.modelId,
    })

    return {
      artifacts: artifactPayload,
      prompt: normalizedPrompt,
      tokenCount: extractTotalTokenCount(generation.raw),
    }
  }

  throw new Error('Only image-strip animation is supported in the web edition.')
}

async function generateImagesWithModel({ candidateCount = 1, modelSelection, prompt, quality, references = [], size = 'auto', systemInstruction }) {
  if (modelSelection.provider !== 'codex') throw new Error('Only the local Codex runtime is supported.')
  const signal = generationContext.getStore()?.signal
  const result = await generateCodexImages({
    prompt: [systemInstruction, prompt, references.length ? 'Attached reference images, in order: ' + references.map((reference, index) => 'Image ' + (index + 1) + ': ' + (reference.role || reference.slot || reference.name || 'visual reference')).join('; ') + '.' : '', size !== 'auto' ? 'Desired canvas: ' + size + ' pixels. Match this layout and aspect ratio as closely as supported.' : '', quality ? 'Requested visual detail level: ' + quality + '.' : ''].filter(Boolean).join('\n\n'),
    count: candidateCount,
    references: references.map(reference => Buffer.from(reference.data, 'base64')),
    signal,
  })
  return {
    images: result.images.map((image, index) => ({ data: image.buffer.toString('base64'), id: 'codex-image-' + (index + 1), mimeType: image.mimeType, text: image.revisedPrompt })),
    text: '', raw: null, warning: result.warning,
  }
}

function buildAnimatorPrompt({
  actionType,
  fps,
  frameCount,
  hasFirstFrameGuide = false,
  hasLastFrameGuide = false,
  keyColor,
  pipeline = 'image-strip',
  prompt,
}) {
  const keyColorLabel = resolveActionAnimatorKeyColor(keyColor) === 'blue'
    ? '#0000FF blue'
    : '#00FF00 green'
  const basePrompt =
    typeof prompt === 'string' && prompt.trim().length > 0
      ? prompt.trim()
      : [
          `Create a 2D ${actionType || 'idle'} cycle from the supplied character image.`,
          `Target playback: ${frameCount} frames at ${fps} fps.`,
        ].join(' ')

  return [
    basePrompt,
    'Match the view of the source image, unless the user explicitly requests another view. Lock that camera in every pose, with no pans, zooms or rotation.',
    'Preserve the exact character identity, proportions, colors, clothing shapes, and silhouette from the reference image.',
    'Keep the full body visible at a consistent scale with no floor plane, scenery, props, or extra characters.',
    `Use a solid ${keyColorLabel} background that stays flat and consistent in every frame.`,
    pipeline === 'image-strip'
      ? describeActionAnimatorGrid(frameCount)
      : null,
    hasFirstFrameGuide
      ? 'The second attached image is a first-frame guide. Match that opening pose closely.'
      : null,
    hasLastFrameGuide
      ? `The ${hasFirstFrameGuide ? 'third' : 'second'} attached image is a last-frame guide. Match that ending pose closely.`
      : null,
    describeAnimatorMotion(actionType),
  ]
    .filter(Boolean)
    .join(' ')
}

export function normalizeActionAnimatorFrameSize(value) {
  return Number(value) === 1080 ? 1080 : defaultActionAnimatorFrameSizePx
}

export function resolveActionAnimatorKeyColor(value) {
  return value === 'blue' ? 'blue' : 'green'
}

function clampAnimatorFrameCount(frameCount) {
  const numericValue = Number(frameCount)

  if (!Number.isFinite(numericValue)) {
    return 8
  }

  return Math.max(4, Math.min(30, Math.round(numericValue)))
}

function clampActionAnimatorFps(fps) {
  const numericValue = Number(fps)

  if (!Number.isFinite(numericValue)) {
    return 8
  }

  return Math.max(1, Math.min(30, Math.round(numericValue)))
}

function describeAnimatorMotion(actionType) {
  switch (actionType) {
    case 'attack':
      return 'Stage one complete attack cycle with anticipation, a decisive strike, follow-through, and recovery so adjacent frames show obvious motion.'
    case 'jump':
      return 'Stage one complete jump with crouch, launch, airborne apex, and landing, making each phase visually distinct.'
    case 'run':
      return 'Emphasize aggressive forward lean, arm swing, leg extension, and airborne stride changes for a readable run cycle.'
    case 'walk':
      return 'Emphasize alternating contact, passing, and recoil poses so the walk cycle has clear readable spacing.'
    case 'idle':
      return 'Keep both feet planted and the head, equipment and outfit recognizable. Use a subtle cyclic weight shift or breathing motion. The last pose should lead smoothly into the first without repeating it or creating a pause.'
    default:
      return 'Show one complete readable action arc with strong silhouette changes and no duplicate adjacent poses.'
  }
}

function resolveModelForRoute(routeKey, requestedModelId) {
  const allowedModels = routeModelAllowlist[routeKey] ?? []
  const fallbackModel = routeModelDefaults[routeKey]
  const requestedModel =
    typeof requestedModelId === 'string' && requestedModelId.trim().length > 0
      ? requestedModelId.trim()
      : fallbackModel
  const normalizedRequestedModel = normalizeImageModelAlias(requestedModel)

  if (!allowedModels.includes(normalizedRequestedModel)) {
    return {
      ok: false,
      details: [
        `Allowed models for this tab: ${allowedModels.join(', ')}`,
      ],
      message:
        `The selected model "${normalizedRequestedModel}" is not available for this tab's generation flow.`,
    }
  }

  const providerModel = modelRegistry[normalizedRequestedModel]
  const provider = modelProviderRegistry[normalizedRequestedModel]

  if (!providerModel || !provider) {
    return {
      ok: false,
      details: [
        `Model alias "${normalizedRequestedModel}" is missing a provider mapping in the backend configuration.`,
      ],
      message:
        `The selected model "${normalizedRequestedModel}" is not configured on the server yet.`,
    }
  }

  return {
    modelId: normalizedRequestedModel,
    ok: true,
    provider,
    providerModel,
  }
}

function normalizeImageModelAlias(modelId) {
  return ['openai-gpt-image-2', 'openai-text', 'gemini-2.5-flash-image', 'gemini-3-flash-lite', 'gemini-3.1-flash-image-preview', 'veo-3.1-fast'].includes(modelId) ? 'codex' : modelId
}

function getActionAnimatorAllowedModelIds(pipeline = 'image-strip') {
  return pipeline === 'image-strip'
    ? actionAnimatorImageModels
    : [routeModelDefaults['/api/action-animator']]
}

function getActionAnimatorDefaultModelId(pipeline = 'image-strip') {
  return pipeline === 'image-strip' ? 'codex' : routeModelDefaults['/api/action-animator']
}

function resolveActionAnimatorModelSelection({ modelId, pipeline }) {
  const allowedModels = getActionAnimatorAllowedModelIds(pipeline)
  const requestedModel =
    typeof modelId === 'string' && modelId.trim().length > 0
      ? modelId.trim()
      : getActionAnimatorDefaultModelId(pipeline)
  const normalizedRequestedModel = requestedModel === 'veo-3.1-fast'
    ? routeModelDefaults['/api/action-animator']
    : normalizeImageModelAlias(requestedModel)

  if (!allowedModels.includes(normalizedRequestedModel)) {
    return {
      ok: false,
      details: [
        `Allowed models for this animator pipeline: ${allowedModels.join(', ')}`,
      ],
      message:
        `The selected model "${normalizedRequestedModel}" is not available for this action animator pipeline.`,
    }
  }

  return resolveModelForRoute('/api/action-animator', normalizedRequestedModel)
}

function extractTotalTokenCount(result) {
  const directCount = result?.usageMetadata?.totalTokenCount
  const nestedCount = result?.response?.usageMetadata?.totalTokenCount
  const openAiTotal =
    result?.usage?.total_tokens ??
    result?.usage?.totalTokens ??
    ((Number(result?.usage?.input_tokens) || 0) + (Number(result?.usage?.output_tokens) || 0))
  const tokenCount = Number(directCount ?? nestedCount ?? openAiTotal)

  return Number.isFinite(tokenCount) && tokenCount > 0 ? Math.round(tokenCount) : 0
}

function buildNoImageResponseError(
  routeKey,
  modelSelection,
  generationText,
  extraDetails = [],
  recommendedModelIds,
) {
  const incompatibleSignal = looksLikeToolDelegation(generationText)
  const routeRecommendations = recommendedModelIds ?? routeModelAllowlist[routeKey] ?? []
  const recommendations = routeRecommendations
    .filter((modelId) => modelId !== modelSelection.modelId)
    .map((modelId) => `"${modelId}"`)

  const details = [
    `Selected model alias: ${modelSelection.modelId}`,
    `Provider model: ${modelSelection.providerModel}`,
    ...extraDetails,
  ]

  if (recommendations.length) {
    details.push(`Try one of: ${recommendations.join(', ')}`)
  }

  if (incompatibleSignal && generationText) {
    details.push(
      'The model returned a tool-style text response instead of inline image data for this request.',
    )
  }

  return {
    error: {
      code: 'model_output_incompatible',
      details,
      message:
        incompatibleSignal
          ? 'The selected model did not return image parts for this tab. Switch to a supported image-capable model and try again.'
          : 'The selected model returned no image candidates for this request. Try a different model or revise the prompt.',
      title: 'No Image Output Returned',
    },
  }
}

function looksLikeToolDelegation(generationText) {
  if (typeof generationText !== 'string' || !generationText.trim()) {
    return false
  }

  const normalized = generationText.toLowerCase()
  return (
    normalized.includes('dalle.text2im') ||
    normalized.includes('"action"') ||
    normalized.includes('"action_input"')
  )
}

function normalizeGenerationError(error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 502
  const message = typeof error?.message === 'string' ? error.message : 'Codex did not complete this request.'
  return { status, body: { error: {
    code: error?.code || 'codex_request_failed',
    title: error?.code === 'animation_grid_invalid' ? 'Animation Grid Needs Correction' : status === 409 ? 'Codex Is Busy' : status === 401 ? 'Codex Sign-in Required' : 'Codex Generation Stopped',
    message, details: ['No API-key fallback or automatic retry was made.'],
  } } }
}

function clampTimeoutMs(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.max(1000, Math.round(value))
}

function clampNonNegativeInteger(value, fallback) {
  if (!Number.isFinite(value) || value < 0) {
    return fallback
  }

  return Math.round(value)
}

function normalizeLootRarity(rarity) {
  if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
    return rarity
  }

  return 'common'
}

function normalizeVariantForgeFamily(variantFamily) {
  return isVariantForgeFamily(variantFamily) ? variantFamily : 'damage'
}

function normalizeVariantForgePreset(variantFamily, variantPreset) {
  return isVariantForgePresetForFamily(variantFamily, variantPreset)
    ? variantPreset
    : variantForgeDefaultPresetByFamily[variantFamily]
}

function normalizeVariantForgeOptions(variantFamily, variantOptions) {
  const normalizedOptions = Array.isArray(variantOptions)
    ? variantOptions.filter(
        (option, index, entries) =>
          isVariantForgePresetForFamily(variantFamily, option?.preset) &&
          entries.findIndex((entry) => entry?.preset === option?.preset) === index,
      )
    : []

  if (normalizedOptions.length > 0) {
    return normalizedOptions.map((option) => ({
      customSetting:
        typeof option.customSetting === 'string' && option.customSetting.trim()
          ? option.customSetting.trim()
          : '',
      preset: option.preset,
    }))
  }

  return []
}

function clampPercentage(value, fallback) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)))
}

function createTextAi() {
  return { models: { async generateContent({ contents, config = {} }) {
    return { text: await generateCodexText({
      prompt: contents.map(part => part.text ?? '').join('\n'),
      systemInstruction: config.systemInstruction,
      signal: generationContext.getStore()?.signal,
    }) }
  } } }
}
