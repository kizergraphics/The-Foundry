import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import { GoogleGenAI } from '@google/genai/node'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
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
  validateMaterialMapsRequest,
  validateVariantForgeIdeaRequest,
  validateVfxExportRequest,
  validateVfxRecipeRequest,
} from './requestValidation.js'
import {
  buildMaterialMapsFromGeneratedImages,
  readMaterialMapSourceMetadata,
} from './materialMaps.js'
import {
  buildVfxExportBundle,
  buildVfxForgePrompt as buildVfxForgePromptForRequest,
  buildVfxRecipeManifest,
  resolveVfxForgeSystemInstruction as resolveVfxForgeSystemInstructionForRequest,
} from './vfxForge.js'
import {
  getTelemetrySnapshot,
  getUsageSummary,
  recordUsageEvent,
} from './usageStore.js'
import {
  getGoogleTelemetrySnapshot,
  isGoogleTelemetryConfigured,
} from './googleQuotaTelemetry.js'
import {
  getOpenAiTelemetrySnapshot,
  isOpenAiTelemetryConfigured,
  recordOpenAiRateLimitSnapshot,
} from './openaiTelemetry.js'
import {
  formatVariantForgeLabel,
  isVariantForgeFamily,
  isVariantForgePresetForFamily,
  pickVariantForgeIdeaSuggestions,
  variantForgeDefaultPresetByFamily,
} from '../shared/variantForgeCatalog.js'
import { forgeApiModes } from '../shared/modeCatalog.js'
import { resolveVfxEffectLabel } from '../shared/vfxForgeCatalog.js'
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

const envSearchPaths = buildEnvSearchPaths({
  cwd: process.cwd(),
  execPath: process.execPath,
  resourcesPath: process.resourcesPath,
  rootDir,
})

for (const envPath of envSearchPaths) {
  dotenv.config({
    path: envPath,
    override: false,
  })
}

const port = Number(process.env.PORT ?? 3001)
const apiKey =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY
const openAiApiKey = process.env.OPENAI_API_KEY
const openAiOrganizationId = process.env.OPENAI_ORGANIZATION_ID
const openAiProjectId = process.env.OPENAI_PROJECT_ID
const openAiImageQuality = normalizeOpenAiImageQuality(
  process.env.OPENAI_IMAGE_QUALITY,
  'auto',
)
const openAiCharacterSheetQuality = normalizeOpenAiImageQuality(
  process.env.OPENAI_CHARACTER_SHEET_QUALITY,
  'low',
)
const openAiCharacterSheetReferenceMaxEdgePx = clampOpenAiReferenceMaxEdgePx(
  process.env.OPENAI_CHARACTER_SHEET_REFERENCE_MAX_EDGE_PX,
  1024,
)
const allowedCorsOrigin = process.env.CORS_ORIGIN
const generationApiToken = process.env.FORGE_API_TOKEN
const internalApiToken = process.env.INTERNAL_API_TOKEN
const enablePromptOrchestration = process.env.ENABLE_PROMPT_ORCHESTRATION === 'true'
const forgeJsonLimit = process.env.FORGE_JSON_LIMIT ?? '12mb'
const characterSheetJsonLimit = process.env.CHARACTER_SHEET_JSON_LIMIT ?? '14mb'
const actionAnimatorJsonLimit = process.env.ACTION_ANIMATOR_JSON_LIMIT ?? '14mb'
const modelRegistry = {
  'gemini-2.5-flash-image':
    process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  'gemini-3-flash':
    process.env.GEMINI_FLASH_MODEL ?? 'gemini-3.1-flash-image-preview',
  'gemini-3-pro':
    process.env.GEMINI_PRO_MODEL ?? 'gemini-3-pro-image-preview',
  'openai-gpt-image-2':
    process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
  'veo-3.1-fast':
    process.env.GEMINI_VEO_MODEL ?? 'veo-3.1-fast-generate-preview',
}
const modelProviderRegistry = {
  'gemini-2.5-flash-image': 'google',
  'gemini-3-flash': 'google',
  'gemini-3-pro': 'google',
  'openai-gpt-image-2': 'openai',
  'veo-3.1-fast': 'google',
}
const routeModelDefaults = {
  '/api/action-animator': 'veo-3.1-fast',
  '/api/character-sheet': 'openai-gpt-image-2',
  '/api/forge': 'openai-gpt-image-2',
  '/api/material-maps': 'gemini-3-pro',
  '/api/variant-forge-ideas': 'gemini-3-flash',
}
const routeModelAllowlist = {
  '/api/action-animator': [
    'veo-3.1-fast',
    'openai-gpt-image-2',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-flash-image',
  ],
  '/api/character-sheet': ['openai-gpt-image-2', 'gemini-3-pro', 'gemini-3-flash'],
  '/api/forge': [
    'openai-gpt-image-2',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-flash-image',
  ],
  '/api/material-maps': [
    'openai-gpt-image-2',
    'gemini-3-pro',
    'gemini-2.5-flash-image',
    'gemini-3-flash',
  ],
  '/api/variant-forge-ideas': ['gemini-3-flash'],
}
const supportedForgeModes = forgeApiModes
const forgeBatchMaxAttemptsPerImage = 4
const forgeBatchMaxParallelRequests = 4
const forgeBatchRecoveryPasses = 2
const forgeGenerationTimeoutMs = clampTimeoutMs(
  Number(process.env.FORGE_GENERATION_TIMEOUT_MS ?? 90000),
  90000,
)
const textureLabMaxParallelRequests = Math.max(
  1,
  Math.min(Math.round(Number(process.env.TEXTURE_LAB_MAX_PARALLEL_REQUESTS ?? 2)), 2),
)
const textureLabGenerationTimeoutMs = clampTimeoutMs(
  Number(process.env.TEXTURE_LAB_GENERATION_TIMEOUT_MS ?? 30000),
  30000,
)
const textureLabBatchStartStaggerMs = clampNonNegativeInteger(
  Number(process.env.TEXTURE_LAB_BATCH_START_STAGGER_MS ?? 1500),
  1500,
)
const textureLabRetryJitterMs = clampNonNegativeInteger(
  Number(process.env.TEXTURE_LAB_RETRY_JITTER_MS ?? 800),
  800,
)
const variantForgeGenerationTimeoutMs = clampTimeoutMs(
  Number(process.env.VARIANT_FORGE_GENERATION_TIMEOUT_MS ?? 45000),
  45000,
)
const variantForgeMaxAttemptsPerImage = 2
const textureLabMaxAttemptsPerImage = Math.max(
  1,
  Math.min(Math.round(Number(process.env.TEXTURE_LAB_MAX_ATTEMPTS ?? 1)), 2),
)
const forgeBatchInterRequestDelayMs = 250
const forgeBatchRetryDelayMs = 1200
const maxPromptOrchestrationWordCount = 24
const maxPromptEnhancerWordCount = 9
const actionAnimatorPollingIntervalMs = 10000
const actionAnimatorTimeoutMs = 5 * 60 * 1000
const minActionAnimatorDurationSeconds = 4
const maxActionAnimatorDurationSeconds = 8
const actionAnimatorDurationSeconds = clampActionAnimatorDurationSeconds(
  Number(process.env.GEMINI_VEO_DURATION_SECONDS ?? minActionAnimatorDurationSeconds),
)
const actionAnimatorKeyColorHexById = {
  blue: '0x0000FF',
  green: '0x00FF00',
}
const actionAnimatorKeyColorCssById = {
  blue: '#0000FF',
  green: '#00FF00',
}
const defaultActionAnimatorFrameSizePx = 512
const coreSystemRules = [
  'Always render assets on a neutral gray #808080 background.',
  'Never include text, logos, or watermarks in the image.',
  'Ensure all assets are centered and fit entirely within the frame.',
]
const uvLabModelId = 'browser-uv-engine'

const app = express()
const parseForgeBody = express.json({ limit: forgeJsonLimit })
const parseCharacterSheetBody = express.json({ limit: characterSheetJsonLimit })
const parseActionAnimatorBody = express.json({ limit: actionAnimatorJsonLimit })
const usageAuth = createTokenAuthMiddleware({
  allowLoopback: true,
  envToken: internalApiToken,
  headerName: 'x-internal-api-token',
  message:
    'Usage telemetry is restricted. Provide a valid internal API token or access the service from the local machine.',
})
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

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
  })
})

app.get('/api/usage', usageAuth, async (request, response) => {
  try {
    const requestedModel =
      typeof request.query?.model === 'string' ? request.query.model : undefined
    const usageSummary = await getUsageSummary({
      model: requestedModel,
    })
    response.json(usageSummary)
  } catch (error) {
    response.status(500).json({
      error: {
        code: 'usage_unavailable',
        message:
          error instanceof Error
            ? error.message
            : 'Usage telemetry is unavailable right now.',
      },
    })
  }
})

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

    if (!hasApiKeyForProvider(modelSelection.provider)) {
      response.status(500).json({
        error: buildMissingApiKeyMessage(modelSelection.provider),
      })
      return
    }

    const ai =
      modelSelection.provider === 'google' && apiKey
        ? new GoogleGenAI({ apiKey })
        : null

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

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/action-animator',
        telemetryModel: resolveTelemetryModelId(
          modelSelection.modelId,
          '/api/action-animator',
        ),
        tokenCount: animatorResult.tokenCount,
      }).catch((logError) => {
        console.warn('Telemetry logging failed for /api/action-animator:', logError)
      })

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
    if (!apiKey) {
      response.status(500).json({
        error:
          'Gemini API key is missing. Set GEMINI_API_KEY in .env or use GOOGLE_API_KEY on the server.',
      })
      return
    }

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

    const ai = new GoogleGenAI({ apiKey })

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

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/variant-forge-ideas',
        telemetryModel: resolveTelemetryModelId(
          modelSelection.modelId,
          '/api/variant-forge-ideas',
        ),
        tokenCount: extractTotalTokenCount(generation),
      }).catch(() => {})

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
    textureOutputs,
    textureSize,
    textureExpansion,
    unityPipeline,
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

  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

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
    const textureGenerationImageConfig =
      requestedWorkflow === 'generate' && mode === 'texture-lab'
        ? {
            aspectRatio: '1:1',
            imageSize: '1K',
          }
        : null

    if (requestedWorkflow === 'expand-texture') {
      const validExpansion = normalizeTextureExpansion(textureExpansion)

      if (!validExpansion) {
        response.status(400).json({
          error:
            'Texture expansion requires a centered expansion canvas and the original source texture.',
        })
        return
      }

      const generation = await generateImagesWithModel({
        candidateCount: 1,
        modelSelection,
        prompt: finalPrompt,
        quality,
        references: [validExpansion.canvasImage, validExpansion.sourceImage],
        routeKey: '/api/forge',
        size: '1024x1024',
        systemInstruction: resolvedSystemInstruction,
        timeoutMs: textureLabGenerationTimeoutMs,
      })
      const images = generation.images

      if (images.length === 0) {
        response
          .status(422)
          .json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
        return
      }

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/forge',
        telemetryModel: resolveTelemetryModelId(modelSelection.modelId, '/api/forge'),
        tokenCount: extractTotalTokenCount(generation.raw),
      }).catch((logError) => {
        console.warn('Telemetry logging failed for /api/forge texture expansion:', logError)
      })

      response.json({
        images,
        model: modelSelection.modelId,
        prompt: finalPrompt,
        providerModel: modelSelection.providerModel,
        styleId: providedStyleText || null,
      })
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
      const images = generation.images

      if (images.length === 0) {
        response
          .status(422)
          .json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
        return
      }

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/forge',
        telemetryModel: resolveTelemetryModelId(modelSelection.modelId, '/api/forge'),
        tokenCount: extractTotalTokenCount(generation.raw),
      }).catch((logError) => {
        console.warn('Telemetry logging failed for /api/forge seam repair:', logError)
      })

      response.json({
        images,
        model: modelSelection.modelId,
        prompt: finalPrompt,
        providerModel: modelSelection.providerModel,
        styleId: providedStyleText || null,
      })
      return
    }

    const baseContents = [
      { text: finalPrompt },
      ...validReferences.map((reference) => ({
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.data,
        },
      })),
    ]

    if (modelSelection.provider === 'openai') {
      const generation = await generateImagesWithModel({
        candidateCount,
        modelSelection,
        prompt: finalPrompt,
        quality,
        references: validReferences,
        routeKey: '/api/forge',
        size: resolveOpenAiForgeImageSize(mode),
        systemInstruction: resolvedSystemInstruction,
        timeoutMs:
          mode === 'texture-lab' ? textureLabGenerationTimeoutMs : forgeGenerationTimeoutMs,
      })

      if (generation.images.length === 0) {
        response
          .status(422)
          .json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
        return
      }

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/forge',
        telemetryModel: resolveTelemetryModelId(modelSelection.modelId, '/api/forge'),
        tokenCount: extractTotalTokenCount(generation.raw),
      }).catch((logError) => {
        console.warn('Telemetry logging failed for /api/forge:', logError)
      })

      response.json({
        images: generation.images,
        model: modelSelection.modelId,
        providerModel: modelSelection.providerModel,
        prompt: finalPrompt,
        styleId: providedStyleText || null,
      })
      return
    }

    const batchRequestId = buildRequestId('forge-batch')
    const batchStartedAt = Date.now()
    logServerEvent(batchRequestId, 'batch started', {
      candidateCount,
      mode,
      model: modelSelection.modelId,
      providerModel: modelSelection.providerModel,
      referenceCount: validReferences.length,
    })
    const successfulRuns = []
    const normalizedErrors = []
    const noImageTexts = []
    const batchWorkerCount = resolveForgeBatchWorkerCount(
      mode,
      requestedWorkflow,
      candidateCount,
    )
    const attemptPolicy = resolveForgeAttemptPolicy(mode, requestedWorkflow)
    const attemptBatchSlotGeneration = async ({
      phase,
      slotIndex,
      workerStartDelayMs = 0,
      workerLabel,
    }) => {
      const slotErrors = []
      const slotNoImageTexts = []
      const slotSuccessfulRuns = []

      for (
        let attempt = 1;
        attempt <= attemptPolicy.maxAttemptsPerImage;
        attempt += 1
      ) {
        try {
          const attemptStartedAt = Date.now()
          const useModalities = attempt % 2 === 1
          logServerEvent(batchRequestId, 'slot attempt started', {
            attempt,
            phase,
            slot: slotIndex + 1,
            startupDelayMs: workerStartDelayMs,
            useModalities,
            worker: workerLabel,
          })
          const generation = await withTimeout(
            ai.models.generateContent({
              model: modelSelection.providerModel,
              contents: baseContents,
              config: useModalities
                ? {
                    candidateCount: 1,
                    ...(textureGenerationImageConfig
                      ? {
                          imageConfig: textureGenerationImageConfig,
                        }
                      : {}),
                    responseModalities: ['IMAGE', 'TEXT'],
                    systemInstruction: resolvedSystemInstruction,
                  }
                : {
                    candidateCount: 1,
                    ...(textureGenerationImageConfig
                      ? {
                          imageConfig: textureGenerationImageConfig,
                        }
                      : {}),
                    systemInstruction: resolvedSystemInstruction,
                  },
            }),
            attemptPolicy.timeoutMs,
            `Gemini image generation timed out after ${Math.round(
              attemptPolicy.timeoutMs / 1000,
            )} seconds.`,
          )

          slotSuccessfulRuns.push(generation)

          const image = extractImages(generation).at(0)

          if (image) {
            logServerEvent(batchRequestId, 'slot attempt succeeded', {
              attempt,
              durationMs: Date.now() - attemptStartedAt,
              phase,
              slot: slotIndex + 1,
              worker: workerLabel,
            })
            return {
              fatalError: null,
              image: {
                image: {
                  ...image,
                  id: `batch-${slotIndex + 1}-${image.id}`,
                },
                slotIndex,
              },
              noImageTexts: slotNoImageTexts,
              normalizedErrors: slotErrors,
              successfulRuns: slotSuccessfulRuns,
            }
          }

          if (generation.text) {
            slotNoImageTexts.push(generation.text)
          }
          logServerEvent(batchRequestId, 'slot returned no image', {
            attempt,
            durationMs: Date.now() - attemptStartedAt,
            phase,
            slot: slotIndex + 1,
            textPreview: generation.text?.slice(0, 120) ?? null,
            worker: workerLabel,
          })

          if (attempt < attemptPolicy.maxAttemptsPerImage) {
            await sleep(forgeBatchInterRequestDelayMs)
          }
        } catch (requestError) {
          const normalizedError = normalizeGenerationError(
            requestError,
            modelSelection.modelId,
            modelSelection.provider,
          )
          slotErrors.push(normalizedError)
          const isRetryable =
            normalizedError.status === 429 || normalizedError.status >= 500

          if (!isRetryable) {
            logServerEvent(batchRequestId, 'slot failed with fatal error', {
              attempt,
              code: normalizedError.body?.error?.code ?? null,
              message: normalizedError.body?.error?.message ?? null,
              phase,
              slot: slotIndex + 1,
              status: normalizedError.status,
              worker: workerLabel,
            })
            return {
              fatalError: normalizedError,
              image: null,
              noImageTexts: slotNoImageTexts,
              normalizedErrors: slotErrors,
              successfulRuns: slotSuccessfulRuns,
            }
          }

          const retryAfterSeconds = normalizedError.body?.error?.retryAfterSeconds
          const retryDelay = resolveForgeRetryDelay({
            mode,
            retryAfterSeconds,
            workflow: requestedWorkflow,
          })
          logServerEvent(batchRequestId, 'slot attempt retrying', {
            attempt,
            baseDelayMs: retryDelay.baseDelayMs,
            code: normalizedError.body?.error?.code ?? null,
            delayMs: retryDelay.effectiveDelayMs,
            jitterMs: retryDelay.jitterMs,
            message: normalizedError.body?.error?.message ?? null,
            phase,
            slot: slotIndex + 1,
            status: normalizedError.status,
            worker: workerLabel,
          })
          await sleep(retryDelay.effectiveDelayMs)
        }
      }

      return {
        fatalError: null,
        image: null,
        noImageTexts: slotNoImageTexts,
        normalizedErrors: slotErrors,
        successfulRuns: slotSuccessfulRuns,
      }
    }
    const batchResults = await Promise.all(
      Array.from(
        {
          length: batchWorkerCount,
        },
        async (_, workerIndex) => {
          const workerStartDelayMs = resolveForgeWorkerStartDelayMs(
            mode,
            requestedWorkflow,
            workerIndex,
          )
          const workerImages = []
          const workerSuccessfulRuns = []
          const workerErrors = []
          const workerNoImageTexts = []
          let fatalError = null

          if (workerStartDelayMs > 0) {
            await sleep(workerStartDelayMs)
          }

          for (
            let slotIndex = workerIndex;
            slotIndex < candidateCount;
            slotIndex += batchWorkerCount
          ) {
            const slotResult = await attemptBatchSlotGeneration({
              phase: 'initial',
              slotIndex,
              workerStartDelayMs,
              workerLabel: workerIndex + 1,
            })

            workerSuccessfulRuns.push(...slotResult.successfulRuns)
            workerErrors.push(...slotResult.normalizedErrors)
            workerNoImageTexts.push(...slotResult.noImageTexts)

            if (slotResult.image) {
              workerImages.push(slotResult.image)
            }

            if (slotResult.fatalError) {
              fatalError = slotResult.fatalError
            }

            if (fatalError) {
              break
            }
          }

          return {
            fatalError,
            normalizedErrors: workerErrors,
            noImageTexts: workerNoImageTexts,
            successfulRuns: workerSuccessfulRuns,
            workerImages,
          }
        },
      ),
    )
    batchResults.forEach((result) => {
      successfulRuns.push(...result.successfulRuns)
      normalizedErrors.push(...result.normalizedErrors)
      noImageTexts.push(...result.noImageTexts)
    })
    const imagesBySlot = new Map(
      batchResults
        .flatMap((result) => result.workerImages)
        .map((entry) => [entry.slotIndex, entry.image]),
    )
    const fatalErrors = batchResults
      .map((result) => result.fatalError)
      .filter(Boolean)

    if (fatalErrors.length === 0 && imagesBySlot.size < candidateCount) {
      let missingSlotIndexes = Array.from(
        { length: candidateCount },
        (_, slotIndex) => slotIndex,
      ).filter((slotIndex) => !imagesBySlot.has(slotIndex))

      for (
        let recoveryPass = 1;
        recoveryPass <= forgeBatchRecoveryPasses && missingSlotIndexes.length > 0;
        recoveryPass += 1
      ) {
        logServerEvent(batchRequestId, 'batch recovery pass started', {
          missingSlots: missingSlotIndexes.map((slotIndex) => slotIndex + 1),
          recoveryPass,
        })

        for (const slotIndex of missingSlotIndexes) {
          const slotResult = await attemptBatchSlotGeneration({
            phase: `recovery-${recoveryPass}`,
            slotIndex,
            workerStartDelayMs: 0,
            workerLabel: `recovery-${recoveryPass}`,
          })

          successfulRuns.push(...slotResult.successfulRuns)
          normalizedErrors.push(...slotResult.normalizedErrors)
          noImageTexts.push(...slotResult.noImageTexts)

          if (slotResult.image) {
            imagesBySlot.set(slotIndex, slotResult.image.image)
          }

          if (slotResult.fatalError) {
            fatalErrors.push(slotResult.fatalError)
            break
          }
        }

        if (fatalErrors.length > 0) {
          break
        }

        missingSlotIndexes = Array.from(
          { length: candidateCount },
          (_, slotIndex) => slotIndex,
        ).filter((slotIndex) => !imagesBySlot.has(slotIndex))
      }
    }

    const images = Array.from(imagesBySlot.entries())
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1])

    if (images.length === 0) {
      if (fatalErrors.length > 0) {
        const preferredError =
          fatalErrors.find((error) => error.status === 429) ?? fatalErrors[0]
        logServerEvent(batchRequestId, 'batch finished with fatal error', {
          durationMs: Date.now() - batchStartedAt,
          errorCode: preferredError.body?.error?.code ?? null,
          status: preferredError.status,
        })
        response.status(preferredError.status).json(preferredError.body)
        return
      }

      if (successfulRuns.length === 0 && normalizedErrors.length > 0) {
        const preferredError =
          normalizedErrors.find((error) => error.status === 429) ??
          normalizedErrors[0]
        logServerEvent(batchRequestId, 'batch finished with retryable failure', {
          durationMs: Date.now() - batchStartedAt,
          errorCode: preferredError.body?.error?.code ?? null,
          status: preferredError.status,
        })
        response.status(preferredError.status).json(preferredError.body)
        return
      }

      const fallbackText = noImageTexts[0] ?? successfulRuns[0]?.text
      logServerEvent(batchRequestId, 'batch finished with no images', {
        durationMs: Date.now() - batchStartedAt,
        textPreview: fallbackText?.slice(0, 120) ?? null,
      })
      response
        .status(422)
        .json(buildNoImageResponseError('/api/forge', modelSelection, fallbackText))
      return
    }

    if (images.length < candidateCount) {
      const preferredError =
        fatalErrors.find((error) => error.status === 429) ?? fatalErrors[0] ?? null
      const fallbackText = noImageTexts[0] ?? successfulRuns[0]?.text
      logServerEvent(batchRequestId, 'batch finished incomplete', {
        durationMs: Date.now() - batchStartedAt,
        imageCount: images.length,
        requestedCount: candidateCount,
        status: preferredError?.status ?? null,
        textPreview: fallbackText?.slice(0, 120) ?? null,
      })
      response
        .status(preferredError?.status ?? 502)
        .json(
          buildIncompleteBatchResponseError({
            candidateCount,
            imageCount: images.length,
            modelSelection,
            preferredError,
          }),
        )
      return
    }

    await Promise.all(
      successfulRuns.map((generation) =>
        recordUsageEvent({
          model: modelSelection.modelId,
          route: '/api/forge',
          telemetryModel: resolveTelemetryModelId(modelSelection.modelId, '/api/forge'),
          tokenCount: extractTotalTokenCount(generation),
        }).catch((logError) => {
          console.warn('Telemetry logging failed for /api/forge:', logError)
        }),
      ),
    )

    response.json({
      images: images.slice(0, candidateCount),
      model: modelSelection.modelId,
      providerModel: modelSelection.providerModel,
      prompt: finalPrompt,
      styleId: providedStyleText || null,
    })
    logServerEvent(batchRequestId, 'batch finished successfully', {
      durationMs: Date.now() - batchStartedAt,
      imageCount: Math.min(images.length, candidateCount),
      retryCount: normalizedErrors.length,
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

    const bundle = await buildVfxExportBundle(validatedRequest)
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
  '/api/material-maps',
  optionalGenerationAuth,
  forgeRateLimit,
  forgeConcurrencyLimit,
  parseForgeBody,
  async (request, response) => {
  let validatedRequest

  try {
    validatedRequest = validateMaterialMapsRequest(request.body ?? {})
  } catch (error) {
    response.status(400).json(toValidationResponse(error))
    return
  }

  const {
    heightStrength,
    metallicStrength,
    modelId,
    normalStrength,
    prompt,
    quality,
    roughnessStrength,
    sourceImage,
    sourceText,
    styleText,
  } = validatedRequest
  const modelSelection = resolveModelForRoute('/api/material-maps', modelId)

  if (!modelSelection.ok) {
    response.status(500).json({
      error: {
        code: 'model_unavailable',
        details: modelSelection.details,
        message: modelSelection.message,
        title: 'Material Maps Are Unavailable',
      },
    })
    return
  }

  if (!hasApiKeyForProvider(modelSelection.provider)) {
    response.status(500).json({
      error: buildMissingApiKeyMessage(modelSelection.provider),
    })
    return
  }

  const sourceImageBuffer = Buffer.from(sourceImage.data, 'base64')
  const requestId = buildRequestId('material-maps')

  try {
    const { height: sourceHeight, width: sourceWidth } =
      await readMaterialMapSourceMetadata(sourceImageBuffer)
    const promptContext = buildMaterialMapContext({
      prompt,
      sourceText,
      styleText,
    })
    const generationRequests = ['height', 'roughness', 'metallic'].map((mapKind) =>
      generateMaterialMapImageWithFallback({
        mapKind,
        preferredModelId: modelSelection.modelId,
        promptContext,
        quality,
        requestId,
        sourceImage,
      }),
    )

    logServerEvent(requestId, 'material map generation started', {
      sourceHeight,
      sourceWidth,
    })

    const generatedMaps = await Promise.all(generationRequests)
    const imageBuffers = {}

    for (const generatedMap of generatedMaps) {
      if (!generatedMap.ok) {
        if (generatedMap.failureKind === 'no-image') {
          response
            .status(422)
            .json(
              buildNoImageResponseError(
                '/api/material-maps',
                generatedMap.modelSelection,
                generatedMap.generationText,
                [`Attempted models: ${generatedMap.attemptedModelIds.join(', ')}`],
              ),
            )
          return
        }

        const normalizedError = normalizeGenerationError(
          generatedMap.error,
          generatedMap.modelSelection.modelId,
          generatedMap.modelSelection.provider,
        )
        response.status(normalizedError.status).json(normalizedError.body)
        return
      }

      imageBuffers[generatedMap.mapKind] = Buffer.from(generatedMap.generatedImage.data, 'base64')
    }

    const finalizedMaps = await buildMaterialMapsFromGeneratedImages({
      heightImageBuffer: imageBuffers.height,
      heightStrength,
      metallicImageBuffer: imageBuffers.metallic,
      metallicStrength,
      normalStrength,
      roughnessImageBuffer: imageBuffers.roughness,
      roughnessStrength,
      sourceHeight,
      sourceWidth,
    })

    await Promise.all(
      generatedMaps.map(({ generation, modelSelection: successfulModelSelection }) =>
        recordUsageEvent({
          model: successfulModelSelection.modelId,
          route: '/api/material-maps',
          telemetryModel: resolveTelemetryModelId(
            successfulModelSelection.modelId,
            '/api/material-maps',
          ),
          tokenCount: extractTotalTokenCount(generation),
        }).catch((logError) => {
          console.warn('Telemetry logging failed for /api/material-maps:', logError)
        }),
      ),
    )

    response.json({
      maps: {
        height: {
          data: finalizedMaps.height.buffer.toString('base64'),
          height: finalizedMaps.height.height,
          id: 'material-height',
          mimeType: finalizedMaps.height.mimeType,
          width: finalizedMaps.height.width,
        },
        metallic: {
          data: finalizedMaps.metallic.buffer.toString('base64'),
          height: finalizedMaps.metallic.height,
          id: 'material-metallic',
          mimeType: finalizedMaps.metallic.mimeType,
          width: finalizedMaps.metallic.width,
        },
        normal: {
          data: finalizedMaps.normal.buffer.toString('base64'),
          height: finalizedMaps.normal.height,
          id: 'material-normal',
          mimeType: finalizedMaps.normal.mimeType,
          width: finalizedMaps.normal.width,
        },
        roughness: {
          data: finalizedMaps.roughness.buffer.toString('base64'),
          height: finalizedMaps.roughness.height,
          id: 'material-roughness',
          mimeType: finalizedMaps.roughness.mimeType,
          width: finalizedMaps.roughness.width,
        },
      },
      model: generatedMaps[0]?.modelSelection.modelId ?? modelSelection.modelId,
    })
    logServerEvent(requestId, 'material map generation finished', {
      sourceHeight,
      sourceWidth,
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

  if (!hasApiKeyForProvider(modelSelection.provider)) {
    response.status(500).json({
      error: buildMissingApiKeyMessage(modelSelection.provider),
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

  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

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
      size: resolveOpenAiCharacterSheetSize(aspectRatio),
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

    await recordUsageEvent({
      model: modelSelection.modelId,
      route: '/api/character-sheet',
      telemetryModel: resolveTelemetryModelId(
        modelSelection.modelId,
        '/api/character-sheet',
      ),
      tokenCount: extractTotalTokenCount(generation.raw),
    }).catch((logError) => {
      console.warn('Telemetry logging failed for /api/character-sheet:', logError)
    })

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

app.get('/api/usage/telemetry', usageAuth, async (_request, response) => {
  try {
    const localTelemetrySnapshot = await getTelemetrySnapshot()
    let telemetrySnapshot = {
      ...localTelemetrySnapshot,
      source: 'local',
    }
    const telemetryErrors = []

    if (isGoogleTelemetryConfigured()) {
      try {
        const googleTelemetrySnapshot = await getGoogleTelemetrySnapshot()
        telemetrySnapshot = mergeTelemetrySnapshots(
          telemetrySnapshot,
          googleTelemetrySnapshot,
        )
      } catch (error) {
        console.warn('Google telemetry unavailable:', error)
        telemetryErrors.push(
          'Google quota telemetry is unavailable right now. Local telemetry is still active.',
        )
      }
    }

    if (isOpenAiTelemetryConfigured()) {
      try {
        const openAiTelemetrySnapshot = await getOpenAiTelemetrySnapshot()
        telemetrySnapshot = mergeTelemetrySnapshots(
          telemetrySnapshot,
          openAiTelemetrySnapshot,
        )
      } catch (error) {
        console.warn('OpenAI telemetry unavailable:', error)
        telemetryErrors.push(
          'OpenAI usage telemetry is unavailable right now. Local telemetry is still active.',
        )
      }
    }

    if (telemetryErrors.length > 0) {
      telemetrySnapshot = {
        ...telemetrySnapshot,
        error: {
          code: 'telemetry_unavailable',
          message: telemetryErrors.join(' '),
        },
      }
    }

    response.set('Cache-Control', 'no-store')
    response.json(telemetrySnapshot)
  } catch (error) {
    response.status(500).json({
      error: {
        code:
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : 'telemetry_unavailable',
        message:
          'Telemetry is unavailable right now.',
      },
    })
  }
})

const googleTelemetryRowIdByLegacyId = {
  'gemini-2.5-flash-image': 'nano-banana',
  'gemini-2.5-flash': 'gemini-2.5-flash-text',
  'gemini-3-pro-image': 'nano-banana-pro',
  'gemini-3.1-flash': 'gemini-3-flash-text',
  'gemini-3.1-flash-image': 'nano-banana-2',
  'veo-3-fast-generate': 'veo-3-fast-generate',
}

function mergeTelemetrySnapshots(localSnapshot, externalSnapshot) {
  const externalRowsById = new Map(
    externalSnapshot.rows.map((row) => [normalizeTelemetryRowId(row.id), row]),
  )

  return {
    ...localSnapshot,
    generatedAt: localSnapshot.generatedAt,
    source: 'hybrid',
    timeZone: localSnapshot.timeZone,
    rows: localSnapshot.rows.map((localRow) =>
      mergeTelemetryRow(localRow, externalRowsById.get(localRow.id)),
    ),
  }
}

function mergeTelemetryRow(localRow, googleRow) {
  if (!googleRow) {
    return localRow
  }

  const localChartHasActivity = localRow.chartPoints.some((value) => value > 0)

  return {
    ...localRow,
    chartPoints: localChartHasActivity ? localRow.chartPoints : googleRow.chartPoints,
    lastRequestAt: resolveLatestTelemetryTimestamp(localRow.lastRequestAt, googleRow.lastRequestAt),
    metrics: {
      rpm: mergeTelemetryMetric(localRow.metrics.rpm, googleRow.metrics.rpm),
      rpd: mergeTelemetryMetric(localRow.metrics.rpd, googleRow.metrics.rpd),
      tpm: mergeTelemetryMetric(localRow.metrics.tpm, googleRow.metrics.tpm),
    },
  }
}

function mergeTelemetryMetric(localMetric, googleMetric) {
  if (!localMetric && !googleMetric) {
    return null
  }

  const current = Math.max(
    normalizeTelemetryMetricValue(localMetric?.current),
    normalizeTelemetryMetricValue(googleMetric?.current),
  )
  // Keep the local limit table as the canonical max for each model. Google quota
  // telemetry is still useful for live usage/current counts, but its reported
  // limits can be broader than the per-model caps shown in the product UI.
  const limitCandidate = firstFiniteTelemetryValue(localMetric?.limit, googleMetric?.limit)

  return {
    current: Number.isFinite(current) ? current : null,
    limit: limitCandidate,
    ratio:
      typeof limitCandidate === 'number' && limitCandidate > 0 && Number.isFinite(current)
        ? Math.max(0, Math.min(current / limitCandidate, 1))
        : firstFiniteTelemetryValue(localMetric?.ratio, googleMetric?.ratio),
  }
}

function normalizeTelemetryRowId(rowId) {
  return googleTelemetryRowIdByLegacyId[rowId] ?? rowId
}

function normalizeTelemetryMetricValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
}

function firstFiniteTelemetryValue(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }

  return null
}

function resolveLatestTelemetryTimestamp(...timestamps) {
  const validTimestamps = timestamps.filter(
    (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)),
  )

  if (validTimestamps.length === 0) {
    return null
  }

  return validTimestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}

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
      internalAuth: internalApiToken ? 'token-or-loopback' : 'loopback-only',
      promptOrchestration: enablePromptOrchestration,
      trustBoundary: 'client requests only; Gemini credentials remain server-side',
      type: 'server-security-config',
    }),
  )
  return app.listen(port, () => {
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

  const orchestratorModel = modelRegistry['gemini-3-flash']

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

    await recordUsageEvent({
      model: 'gemini-3-flash',
      route: '/internal/prompt-orchestrator',
      telemetryModel: resolveTelemetryModelId(
        'gemini-3-flash',
        '/internal/prompt-orchestrator',
      ),
      tokenCount: extractTotalTokenCount(promptGeneration),
    }).catch(() => {})

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

function buildTextureExpansionPrompt({ prompt, styleText, textureExpansion }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText =
    typeof styleText === 'string' ? styleText.trim() : ''
  const targetSize =
    textureExpansion && Number.isFinite(Number(textureExpansion.targetSize))
      ? Number(textureExpansion.targetSize)
      : 1024
  const sourceWidth =
    textureExpansion && Number.isFinite(Number(textureExpansion.sourceWidth))
      ? Number(textureExpansion.sourceWidth)
      : null
  const sourceHeight =
    textureExpansion && Number.isFinite(Number(textureExpansion.sourceHeight))
      ? Number(textureExpansion.sourceHeight)
      : null

  return [
    'Texture outpainting task.',
    `Expand the centered texture into a seamless ${targetSize} x ${targetSize} square material map.`,
    'Fill the entire canvas with texture detail. Do not leave any flat backdrop, blank border, or studio background visible.',
    'Use the central pattern as the authority for material identity, texel density, grain, roughness, lighting, and color.',
    'Generate fresh surrounding detail instead of copy-pasting the center. Avoid obvious repetition.',
    'Preserve a clean top-down texture read suitable for game tiling.',
    'Ensure the new edges match their opposite sides so the final image tiles seamlessly after expansion.',
    sourceWidth && sourceHeight
      ? `Original source dimensions: ${sourceWidth} x ${sourceHeight}.`
      : null,
    normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
    normalizedPrompt ? `Material notes: ${normalizedPrompt}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
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

function buildMaterialMapContext({ prompt, sourceText, styleText }) {
  return [
    typeof sourceText === 'string' && sourceText.trim()
      ? `Source generation notes: ${sourceText.trim()}.`
      : null,
    typeof prompt === 'string' && prompt.trim()
      ? `Texture direction: ${prompt.trim()}.`
      : null,
    typeof styleText === 'string' && styleText.trim()
      ? `Style guidance: ${styleText.trim()}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function buildMaterialMapPrompt(mapKind, promptContext) {
  const mapDescription =
    mapKind === 'height'
      ? 'Generate a clean height map where brighter values are raised and darker values are recessed.'
      : mapKind === 'roughness'
        ? 'Generate a clean roughness map where brighter values are rougher and darker values are smoother.'
        : 'Generate a clean metallic map where metallic surfaces are bright and non-metal surfaces stay dark.'

  return [
    `Material analysis task for the ${mapKind} map.`,
    mapDescription,
    'Use the supplied texture as the single source of truth for pattern placement, scale, and material breakup.',
    'Do not add color coding, legends, labels, borders, lighting, or decorative overlays.',
    'Return one production-ready map image only.',
    promptContext || null,
  ]
    .filter(Boolean)
    .join(' ')
}

function buildMaterialMapSystemInstruction(mapKind) {
  const outputRule =
    mapKind === 'metallic'
      ? 'Favor dark values for non-metals and reserve bright values for truly metallic regions.'
      : mapKind === 'roughness'
        ? 'Keep the output physically plausible and free of color tinting.'
        : 'Keep height detail readable without introducing color tinting.'

  return [
    'You convert source textures into single-channel PBR utility maps.',
    'Return exactly one grayscale material map image with no extra commentary.',
    'Preserve the original material layout, texel density, and tile continuity.',
    outputRule,
  ].join(' ')
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

function resolveForgeAttemptPolicy(mode, workflow = 'generate') {
  if (mode === 'texture-lab' && workflow === 'generate') {
    return {
      maxAttemptsPerImage: textureLabMaxAttemptsPerImage,
      timeoutMs: textureLabGenerationTimeoutMs,
    }
  }

  if (mode === 'variant-forge') {
    return {
      maxAttemptsPerImage: variantForgeMaxAttemptsPerImage,
      timeoutMs: variantForgeGenerationTimeoutMs,
    }
  }

  return {
    maxAttemptsPerImage: forgeBatchMaxAttemptsPerImage,
    timeoutMs: forgeGenerationTimeoutMs,
  }
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

function buildVfxForgePrompt({ frameCount, intensity, prompt, projectileType, styleText }) {
  const normalizedProjectileType =
    typeof projectileType === 'string' && projectileType.trim().length > 0
      ? projectileType.trim()
      : 'Fireball'
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedFrameCount = clampAnimatorFrameCount(frameCount)
  const normalizedIntensity = clampPercentage(intensity, 60)

  return [
    'Generate a 2D projectile spritesheet.',
    `Projectile type: ${normalizedProjectileType}.`,
    `Layout: exactly ${normalizedFrameCount} frames in a single horizontal row.`,
    'Show the effect from birth through peak energy to dissipation.',
    `Intensity target: ${normalizedIntensity} out of 100.`,
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
    styleText ? `Style guidance: ${styleText}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
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
    'The full output must be covered by texture detail from edge to edge.',
    'Do not leave any flat background color, blank border, transparent area, or studio backdrop visible.',
    'Do not introduce perspective, camera tilt, or directional shadows.',
    'Preserve the centered source texture as the visual anchor for the full material.',
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

function resolveVfxForgeSystemInstruction(customInstruction, { frameCount }) {
  const normalizedFrameCount = clampAnimatorFrameCount(frameCount)
  const vfxRules = [
    'Generate a 2D projectile spritesheet on a pure #000000 black background.',
    `Layout: ${normalizedFrameCount} frames in a single horizontal row.`,
    'Use soft glowing edges and no outlines for additive blending compatibility.',
    'Keep the background fully black with no floor, props, or character silhouettes.',
  ]

  return [coreSystemRules.slice(1).join('\n'), vfxRules.join('\n'), customInstruction]
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

  const enhancerModel = modelRegistry['gemini-3-flash']

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

    await recordUsageEvent({
      model: 'gemini-3-flash',
      route: '/internal/prompt-enhancer',
      telemetryModel: resolveTelemetryModelId('gemini-3-flash', '/internal/prompt-enhancer'),
      tokenCount: extractTotalTokenCount(enhancement),
    }).catch(() => {})

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

function extractImages(generation) {
  return (
    generation.candidates?.flatMap((candidate, candidateIndex) => {
      const text = candidate.content?.parts
        ?.filter((part) => typeof part.text === 'string' && part.text.trim().length > 0)
        .map((part) => part.text.trim())
        .join('\n\n')

      return (
        candidate.content?.parts?.flatMap((part, partIndex) => {
          if (!part.inlineData?.data) {
            return []
          }

          return [
            {
              id: `candidate-${candidateIndex + 1}-part-${partIndex + 1}`,
              mimeType: part.inlineData.mimeType ?? 'image/png',
              data: part.inlineData.data,
              text: text || undefined,
            },
          ]
        }) ?? []
      )
    }) ?? []
  )
}

function normalizeTextureExpansion(textureExpansion) {
  const canvasImage = textureExpansion?.canvasImage
  const sourceImage = textureExpansion?.sourceImage

  if (
    typeof canvasImage?.mimeType !== 'string' ||
    typeof canvasImage?.data !== 'string' ||
    !canvasImage.data.length ||
    typeof sourceImage?.mimeType !== 'string' ||
    typeof sourceImage?.data !== 'string' ||
    !sourceImage.data.length
  ) {
    return null
  }

  return {
    canvasImage: {
      data: canvasImage.data,
      mimeType: canvasImage.mimeType,
    },
    sourceImage: {
      data: sourceImage.data,
      mimeType: sourceImage.mimeType,
    },
  }
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
  ai,
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
        aspectRatio: '16:9',
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
      size: '1536x1024',
      systemInstruction:
        'Return exactly one polished horizontal sprite strip image. ' +
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

  const sourceImage = {
    imageBytes: image.data,
    mimeType: image.mimeType,
  }
  const operation = await ai.models.generateVideos({
    model: modelSelection.providerModel,
    source: {
      image: sourceImage,
      prompt: normalizedPrompt,
    },
    config: {
      durationSeconds: actionAnimatorDurationSeconds,
      numberOfVideos: 1,
      personGeneration: 'allow_adult',
    },
  })

  const settledOperation = await waitForVideoOperation(ai, operation)
  const video = settledOperation.response?.generatedVideos?.[0]?.video
  const videoBuffer = await readGeneratedVideo(ai, video)
  const artifactPayload = await createActionAnimatorArtifactsFromVideo({
    frameCount: normalizedFrameCount,
    frameSize: normalizedFrameSize,
    fps: normalizedFps,
    keyColor: normalizedKeyColor,
    prompt: normalizedPrompt,
    sourceModel: modelSelection.modelId,
    videoBuffer,
  })

  return {
    artifacts: artifactPayload,
    prompt: normalizedPrompt,
    tokenCount: 0,
  }
}

async function waitForVideoOperation(ai, operation) {
  const startedAt = Date.now()
  let currentOperation = operation

  while (!currentOperation.done) {
    if (Date.now() - startedAt > actionAnimatorTimeoutMs) {
      throw new Error('Veo video generation timed out before the operation completed.')
    }

    await sleep(actionAnimatorPollingIntervalMs)
    currentOperation = await ai.operations.getVideosOperation({
      operation: currentOperation,
    })
  }

  if (currentOperation.error) {
    throw new Error(JSON.stringify(currentOperation.error))
  }

  return currentOperation
}

async function readGeneratedVideo(ai, video) {
  if (video?.videoBytes) {
    return Buffer.from(video.videoBytes, 'base64')
  }

  if (typeof video?.uri === 'string' && video.uri.length > 0) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forger-veo-download-'))
    const downloadPath = path.join(tempDir, 'generated-video.mp4')

    try {
      if (ai.files?.download) {
        await ai.files.download({
          file: video,
          downloadPath,
        })

        return await fs.readFile(downloadPath)
      }

      const videoResponse = await fetch(video.uri, {
        headers: apiKey
          ? {
              'x-goog-api-key': apiKey,
            }
          : undefined,
      })

      if (!videoResponse.ok) {
        throw new Error('Generated video could not be downloaded from the returned URI.')
      }

      return Buffer.from(await videoResponse.arrayBuffer())
    } finally {
      await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {})
    }
  }

  throw new Error('Veo returned no downloadable video bytes for the animation request.')
}

async function createActionAnimatorArtifactsFromVideo({
  frameCount,
  frameSize,
  fps,
  keyColor,
  prompt,
  sourceModel,
  videoBuffer,
}) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is unavailable, so sprite extraction cannot run.')
  }

  const safeFrameCount = clampAnimatorFrameCount(frameCount)
  const safeFrameSize = normalizeActionAnimatorFrameSize(frameSize)
  const normalizedKeyColor = resolveActionAnimatorKeyColor(keyColor)
  const sampleFps = resolveActionAnimatorSampleFps({
    durationSeconds: actionAnimatorDurationSeconds,
    frameCount: safeFrameCount,
  })
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forger-action-animator-'))
  const videoPath = path.join(tempDir, 'source.mp4')
  const framePattern = path.join(tempDir, 'frame-%03d.png')

  try {
    await fs.writeFile(videoPath, videoBuffer)
    await runFfmpeg([
      '-y',
      '-i',
      videoPath,
      '-filter_complex',
      buildAnimatorMatteFilter({
        frameSizePx: safeFrameSize,
        keyColor: normalizedKeyColor,
        sampleFps,
      }),
      '-map',
      '[out]',
      '-frames:v',
      String(safeFrameCount),
      '-start_number',
      '1',
      framePattern,
    ])

    const extractedFrameNames = (await fs.readdir(tempDir))
      .filter((fileName) => /^frame-\d{3}\.png$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right))
    const extractedFrames = await Promise.all(
      extractedFrameNames.map((fileName) => fs.readFile(path.join(tempDir, fileName))),
    )

    if (extractedFrames.length === 0) {
      throw new Error('Sprite extraction completed without any decoded frames.')
    }

    const rawFrames = extractedFrames.slice(0, safeFrameCount)

    while (rawFrames.length < safeFrameCount) {
      rawFrames.push(rawFrames.at(-1))
    }

    const normalizedFrames = await normalizeAnimatorFrameBuffers(rawFrames, {
      keyColor: normalizedKeyColor,
      targetSize: safeFrameSize,
    })
    const spriteSheetBuffer = await composeHorizontalSpriteSheet(normalizedFrames, safeFrameSize, normalizedKeyColor)

    return {
      frames: normalizedFrames.map((frameBuffer, index) => ({
        data: frameBuffer.toString('base64'),
        id: `action-animator-frame-${String(index + 1).padStart(2, '0')}`,
        mimeType: 'image/png',
        text: `Frame ${index + 1} of ${safeFrameCount}.`,
      })),
      metadata: {
        fps,
        frameCount: safeFrameCount,
        keyColor: normalizedKeyColor,
        normalizedSize: safeFrameSize,
        pipeline: 'veo-video',
        prompt,
        sampleStrategy: 'even',
        sourceModel,
      },
      spriteSheet: {
        data: spriteSheetBuffer.toString('base64'),
        id: 'action-animator-sprite-sheet',
        mimeType: 'image/png',
        text:
          `Generated ${safeFrameCount} keyed sprite frames from Veo 3.1 Fast at ${safeFrameSize} x ${safeFrameSize}. ` +
          'Frames were sampled evenly across the full clip and normalized onto a flat chroma background.',
      },
      video: {
        data: videoBuffer.toString('base64'),
        mimeType: 'video/mp4',
      },
    }
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {})
  }
}

async function createActionAnimatorArtifactsFromImageStrip({
  frameCount,
  frameSize,
  fps,
  keyColor,
  prompt,
  sourceImageBuffer,
  sourceModel,
}) {
  const safeFrameCount = clampAnimatorFrameCount(frameCount)
  const safeFrameSize = normalizeActionAnimatorFrameSize(frameSize)
  const normalizedKeyColor = resolveActionAnimatorKeyColor(keyColor)
  const background = actionAnimatorKeyColorCssById[normalizedKeyColor]
  const targetSpriteWidth = safeFrameCount * safeFrameSize
  const fittedSpriteSheet = await sharp(sourceImageBuffer)
    .resize(targetSpriteWidth, safeFrameSize, {
      background,
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      position: 'center',
    })
    .png()
    .toBuffer()

  const rawFrames = await Promise.all(
    Array.from({ length: safeFrameCount }, (_, index) =>
      sharp(fittedSpriteSheet)
        .extract({
          height: safeFrameSize,
          left: index * safeFrameSize,
          top: 0,
          width: safeFrameSize,
        })
        .png()
        .toBuffer(),
    ),
  )
  const normalizedFrames = await normalizeAnimatorFrameBuffers(rawFrames, {
    keyColor: normalizedKeyColor,
    targetSize: safeFrameSize,
  })
  const spriteSheetBuffer = await composeHorizontalSpriteSheet(
    normalizedFrames,
    safeFrameSize,
    normalizedKeyColor,
  )

  return {
    frames: normalizedFrames.map((frameBuffer, index) => ({
      data: frameBuffer.toString('base64'),
      id: `action-animator-frame-${String(index + 1).padStart(2, '0')}`,
      mimeType: 'image/png',
      text: `Frame ${index + 1} of ${safeFrameCount}.`,
    })),
    metadata: {
      fps,
      frameCount: safeFrameCount,
      keyColor: normalizedKeyColor,
      normalizedSize: safeFrameSize,
      pipeline: 'image-strip',
      prompt,
      sampleStrategy: 'strip',
      sourceModel,
    },
    spriteSheet: {
      data: spriteSheetBuffer.toString('base64'),
      id: 'action-animator-sprite-sheet',
      mimeType: 'image/png',
      text:
        `Generated ${safeFrameCount} sprite frames from an image-model strip at ${safeFrameSize} x ${safeFrameSize}. ` +
        'Frames were split from the returned strip and normalized onto a flat chroma background.',
    },
    video: null,
  }
}

async function normalizeAnimatorFrameBuffers(
  frameBuffers,
  {
    keyColor,
    targetSize,
  },
) {
  const background = actionAnimatorKeyColorCssById[resolveActionAnimatorKeyColor(keyColor)]
  const padding = Math.max(16, Math.round(targetSize * 0.0625))
  const measuredFrames = await Promise.all(
    frameBuffers.map(async (frameBuffer) => {
      const trimmed = await sharp(frameBuffer)
        .trim({ background })
        .png()
        .toBuffer({ resolveWithObject: true })

      return {
        buffer: trimmed.data,
        height: trimmed.info.height,
        width: trimmed.info.width,
      }
    }),
  )
  const maxWidth = Math.max(...measuredFrames.map((frame) => Math.max(1, frame.width)))
  const maxHeight = Math.max(...measuredFrames.map((frame) => Math.max(1, frame.height)))
  const scale = Math.min(
    1,
    (targetSize - padding * 2) / maxWidth,
    (targetSize - padding * 2) / maxHeight,
  )

  return Promise.all(
    measuredFrames.map(async (frame) => {
      const outputWidth = Math.max(1, Math.round(frame.width * scale))
      const outputHeight = Math.max(1, Math.round(frame.height * scale))
      const resizedBuffer = await sharp(frame.buffer)
        .resize(outputWidth, outputHeight, {
          fit: 'fill',
          kernel: sharp.kernel.nearest,
        })
        .png()
        .toBuffer()

      return sharp({
        create: {
          background,
          channels: 4,
          height: targetSize,
          width: targetSize,
        },
      })
        .composite([
          {
            input: resizedBuffer,
            left: Math.round((targetSize - outputWidth) / 2),
            top: targetSize - padding - outputHeight,
          },
        ])
        .png()
        .toBuffer()
    }),
  )
}

function extractOpenAiImages(payload) {
  return (payload?.data ?? []).flatMap((entry, index) => {
    if (typeof entry?.b64_json !== 'string' || !entry.b64_json.trim()) {
      return []
    }

    return [
      {
        data: entry.b64_json,
        id: `openai-image-${index + 1}`,
        mimeType: 'image/png',
        text:
          typeof entry?.revised_prompt === 'string' && entry.revised_prompt.trim()
            ? entry.revised_prompt.trim()
            : undefined,
      },
    ]
  })
}

async function generateImagesWithModel({
  candidateCount = 1,
  googleConfig = {},
  modelSelection,
  prompt,
  quality,
  references = [],
  routeKey,
  size = 'auto',
  systemInstruction,
  timeoutMs,
}) {
  if (modelSelection.provider === 'openai') {
    return generateImagesWithOpenAiModel({
      candidateCount,
      modelSelection,
      prompt,
      quality,
      references,
      routeKey,
      size,
      systemInstruction,
      timeoutMs,
    })
  }

  return generateImagesWithGoogleModel({
    candidateCount,
    googleConfig,
    modelSelection,
    prompt,
    references,
    systemInstruction,
    timeoutMs,
  })
}

async function generateImagesWithGoogleModel({
  candidateCount,
  googleConfig,
  modelSelection,
  prompt,
  references,
  systemInstruction,
  timeoutMs,
}) {
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null
  const generation = await withTimeout(
    ai.models.generateContent({
      model: modelSelection.providerModel,
      contents: [
        { text: prompt },
        ...references.map((reference) => ({
          inlineData: {
            mimeType: reference.mimeType,
            data: reference.data,
          },
        })),
      ],
      config: {
        ...googleConfig,
        candidateCount,
        responseModalities: ['IMAGE', 'TEXT'],
        systemInstruction,
      },
    }),
    timeoutMs,
    `${resolveProviderLabel('google')} image generation timed out after ${Math.round(
      timeoutMs / 1000,
    )} seconds.`,
  )

  return {
    images: extractImages(generation).slice(0, candidateCount),
    raw: generation,
    text: generation.text,
  }
}

async function generateImagesWithOpenAiModel({
  candidateCount,
  modelSelection,
  prompt,
  quality,
  references,
  routeKey,
  size,
  systemInstruction,
  timeoutMs,
}) {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  const telemetryModel = resolveTelemetryModelId(modelSelection.modelId, routeKey)
  const combinedPrompt = buildOpenAiImagePrompt(prompt, systemInstruction)
  const resolvedQuality = quality ?? resolveOpenAiImageQuality(routeKey)
  const preparedReferences = await prepareOpenAiReferencesForRoute({
    references,
    routeKey,
  })
  const editHeaders = buildOpenAiRequestHeaders({
    requestId: buildRequestId('openai-edit'),
  })
  const generationHeaders = buildOpenAiRequestHeaders({
    contentType: 'application/json',
    requestId: buildRequestId('openai-generate'),
  })

  try {
    const response =
      preparedReferences.length > 0
        ? await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: editHeaders,
            body: buildOpenAiImageEditFormData({
              candidateCount,
              model: modelSelection.providerModel,
              prompt: combinedPrompt,
              quality: resolvedQuality,
              references: preparedReferences,
              size,
            }),
            signal: controller.signal,
          })
        : await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: generationHeaders,
            body: JSON.stringify({
              model: modelSelection.providerModel,
              moderation: 'auto',
              n: candidateCount,
              output_format: 'png',
              prompt: combinedPrompt,
              quality: resolvedQuality,
              size,
            }),
            signal: controller.signal,
          })

    recordOpenAiRateLimitSnapshot({
      headers: response.headers,
      telemetryModel,
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw buildProviderHttpError('openai', response.status, payload)
    }

    return {
      images: extractOpenAiImages(payload).slice(0, candidateCount),
      raw: payload,
      text:
        typeof payload?.data?.[0]?.revised_prompt === 'string'
          ? payload.data[0].revised_prompt
          : '',
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.name === 'AbortError') {
      throw buildProviderHttpError('openai', 504, {
        error: {
          message:
            `${resolveProviderLabel('openai')} image generation timed out after ${Math.round(
              timeoutMs / 1000,
            )} seconds.`,
        },
      })
    }

    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function buildOpenAiImagePrompt(prompt, systemInstruction) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedInstruction =
    typeof systemInstruction === 'string' ? systemInstruction.trim() : ''

  return [normalizedInstruction, normalizedPrompt].filter(Boolean).join('\n\n')
}

function buildOpenAiRequestHeaders({ contentType, requestId }) {
  const headers = {
    Authorization: `Bearer ${openAiApiKey}`,
    'X-Client-Request-Id': requestId,
  }
  const normalizedOrganizationId =
    typeof openAiOrganizationId === 'string' ? openAiOrganizationId.trim() : ''
  const normalizedProjectId =
    typeof openAiProjectId === 'string' ? openAiProjectId.trim() : ''

  if (contentType) {
    headers['Content-Type'] = contentType
  }

  if (normalizedOrganizationId) {
    headers['OpenAI-Organization'] = normalizedOrganizationId
  }

  if (normalizedProjectId) {
    headers['OpenAI-Project'] = normalizedProjectId
  }

  return headers
}

function resolveOpenAiForgeImageSize(mode) {
  if (mode === 'visualizer') {
    return '1536x1024'
  }

  return '1024x1024'
}

function resolveOpenAiCharacterSheetSize(aspectRatio) {
  return aspectRatio === '16:9' ? '1536x1024' : '1024x1024'
}

function resolveOpenAiImageQuality(routeKey) {
  return routeKey === '/api/character-sheet'
    ? openAiCharacterSheetQuality
    : openAiImageQuality
}

function normalizeOpenAiImageQuality(value, fallback) {
  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return ['auto', 'low', 'medium', 'high'].includes(normalizedValue)
    ? normalizedValue
    : fallback
}

function clampOpenAiReferenceMaxEdgePx(value, fallback) {
  const normalized = Math.round(Number(value))
  if (!Number.isFinite(normalized)) {
    return fallback
  }

  return Math.max(256, Math.min(normalized, 2048))
}

function resolveOpenAiReferenceMaxEdgePx(routeKey) {
  return routeKey === '/api/character-sheet'
    ? openAiCharacterSheetReferenceMaxEdgePx
    : null
}

async function prepareOpenAiReferencesForRoute({ references, routeKey }) {
  const maxEdgePx = resolveOpenAiReferenceMaxEdgePx(routeKey)

  if (!Array.isArray(references) || references.length === 0 || maxEdgePx === null) {
    return references
  }

  return Promise.all(
    references.map((reference) => downscaleOpenAiReferenceImage(reference, maxEdgePx)),
  )
}

async function downscaleOpenAiReferenceImage(reference, maxEdgePx) {
  if (
    !reference ||
    typeof reference.data !== 'string' ||
    typeof reference.mimeType !== 'string' ||
    !reference.data ||
    !reference.mimeType
  ) {
    return reference
  }

  try {
    const inputBuffer = Buffer.from(reference.data, 'base64')
    const metadata = await sharp(inputBuffer).metadata()
    const width = Number(metadata.width)
    const height = Number(metadata.height)

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return reference
    }

    if (Math.max(width, height) <= maxEdgePx) {
      return reference
    }

    const resized = sharp(inputBuffer).rotate().resize({
      fit: 'inside',
      height: maxEdgePx,
      width: maxEdgePx,
      withoutEnlargement: true,
    })

    const normalizedMimeType =
      reference.mimeType === 'image/jpeg' || reference.mimeType === 'image/jpg'
        ? 'image/jpeg'
        : reference.mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/png'
    const resizedBuffer =
      normalizedMimeType === 'image/jpeg'
        ? await resized.jpeg({ mozjpeg: true, quality: 90 }).toBuffer()
        : normalizedMimeType === 'image/webp'
          ? await resized.webp({ quality: 90 }).toBuffer()
          : await resized.png().toBuffer()

    return {
      ...reference,
      data: resizedBuffer.toString('base64'),
      mimeType: normalizedMimeType,
    }
  } catch {
    return reference
  }
}

function buildOpenAiImageEditFormData({
  candidateCount,
  model,
  prompt,
  quality,
  references,
  size,
}) {
  const formData = new FormData()
  formData.set('model', model)
  formData.set('prompt', prompt)
  formData.set('n', String(candidateCount))
  formData.set('output_format', 'png')
  formData.set('quality', quality)
  formData.set('size', size)

  references.forEach((reference, index) => {
    formData.append(
      'image[]',
      new Blob([Buffer.from(reference.data, 'base64')], {
        type: reference.mimeType,
      }),
      reference.name || `reference-${index + 1}.${inferImageExtension(reference.mimeType)}`,
    )
  })

  return formData
}

function inferImageExtension(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    default:
      return 'png'
  }
}

function buildProviderHttpError(provider, status, payload) {
  const message =
    typeof payload?.error?.message === 'string' && payload.error.message.trim()
      ? payload.error.message.trim()
      : `${resolveProviderLabel(provider)} request failed unexpectedly.`
  const error = new Error(message)
  error.provider = provider
  error.status = status
  error.payload = payload
  return error
}

async function composeHorizontalSpriteSheet(frameBuffers, targetSize, keyColor) {
  const background = actionAnimatorKeyColorCssById[resolveActionAnimatorKeyColor(keyColor)]

  return sharp({
    create: {
      background,
      channels: 4,
      height: targetSize,
      width: targetSize * frameBuffers.length,
    },
  })
    .composite(
      frameBuffers.map((frameBuffer, index) => ({
        input: frameBuffer,
        left: index * targetSize,
        top: 0,
      })),
    )
    .png()
    .toBuffer()
}

function buildAnimatorPrompt({
  actionType,
  fps,
  frameCount,
  hasFirstFrameGuide = false,
  hasLastFrameGuide = false,
  keyColor,
  pipeline = 'veo-video',
  prompt,
}) {
  const keyColorLabel = resolveActionAnimatorKeyColor(keyColor) === 'blue'
    ? '#0000FF blue'
    : '#00FF00 green'
  const basePrompt =
    typeof prompt === 'string' && prompt.trim().length > 0
      ? prompt.trim()
      : [
          `Create a 2D side-profile ${actionType || 'idle'} cycle from the supplied character image.`,
          `Target playback: ${frameCount} frames at ${fps} fps.`,
        ].join(' ')

  return [
    basePrompt,
    'Keep the camera locked in side view with no pans, zooms, or rotation.',
    'Preserve the exact character identity, proportions, colors, clothing shapes, and silhouette from the reference image.',
    'Keep the full body visible at a consistent scale with no floor plane, scenery, props, or extra characters.',
    `Use a solid ${keyColorLabel} background that stays flat and consistent in every frame.`,
    pipeline === 'image-strip'
      ? `Return a single horizontal sprite strip with exactly ${frameCount} equal square frames in one row.`
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

export function buildAnimatorMatteFilter(options = {}) {
  const frameSizePx = normalizeActionAnimatorFrameSize(options.frameSizePx)
  const keyColor = resolveActionAnimatorKeyColor(options.keyColor)
  const keyColorHex = actionAnimatorKeyColorHexById[keyColor]
  const filterSteps = []

  if (typeof options.sampleFps === 'number' && Number.isFinite(options.sampleFps)) {
    filterSteps.push(`fps=${Math.max(0.25, options.sampleFps)}`)
  }

  filterSteps.push(
    `scale=${frameSizePx}:${frameSizePx}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${frameSizePx}:${frameSizePx}:(ow-iw)/2:(oh-ih)/2:color=${keyColorHex}`,
    `chromakey=${keyColorHex}:0.22:0.06`,
    'colorkey=0xFFFFFF:0.18:0.05',
    'format=rgba',
  )

  return `[0:v]${filterSteps.join(',')}[out]`
}

export function normalizeActionAnimatorFrameSize(value) {
  return Number(value) === 1080 ? 1080 : defaultActionAnimatorFrameSizePx
}

export function resolveActionAnimatorKeyColor(value) {
  return value === 'blue' ? 'blue' : 'green'
}

export function resolveActionAnimatorSampleFps(options = {}) {
  const durationSeconds = clampActionAnimatorDurationSeconds(options.durationSeconds)
  const frameCount = clampAnimatorFrameCount(options.frameCount)

  return Math.max(0.25, frameCount / durationSeconds)
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    process.on('error', (error) => {
      reject(error)
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr || `ffmpeg exited with code ${code}.`))
    })
  })
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

function clampActionAnimatorDurationSeconds(durationSeconds) {
  const numericValue = Number(durationSeconds)

  if (!Number.isFinite(numericValue)) {
    return minActionAnimatorDurationSeconds
  }

  return Math.max(
    minActionAnimatorDurationSeconds,
    Math.min(maxActionAnimatorDurationSeconds, Math.round(numericValue)),
  )
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
      return 'Keep the idle subtle but still readable, with weight shift, cloth drag, and arm movement that changes the silhouette.'
    default:
      return 'Show one complete readable action arc with strong silhouette changes and no duplicate adjacent poses.'
  }
}

function resolveModelForRoute(routeKey, requestedModelId) {
  const allowedModels = routeModelAllowlist[routeKey] ?? []
  const fallbackModel = routeModelDefaults[routeKey]
  const normalizedRequestedModel =
    typeof requestedModelId === 'string' && requestedModelId.trim().length > 0
      ? requestedModelId.trim()
      : fallbackModel

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

function getActionAnimatorAllowedModelIds(pipeline = 'veo-video') {
  return pipeline === 'image-strip'
    ? ['openai-gpt-image-2', 'gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-flash-image']
    : ['veo-3.1-fast']
}

function getActionAnimatorDefaultModelId(pipeline = 'veo-video') {
  return pipeline === 'image-strip' ? 'openai-gpt-image-2' : 'veo-3.1-fast'
}

function resolveActionAnimatorModelSelection({ modelId, pipeline }) {
  const allowedModels = getActionAnimatorAllowedModelIds(pipeline)
  const normalizedRequestedModel =
    typeof modelId === 'string' && modelId.trim().length > 0
      ? modelId.trim()
      : getActionAnimatorDefaultModelId(pipeline)

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

function buildRouteModelFallbackSequence(routeKey, preferredModelId) {
  const allowedModels = routeModelAllowlist[routeKey] ?? []

  return [
    preferredModelId,
    ...allowedModels.filter((modelId) => modelId !== preferredModelId),
  ]
}

function resolveTelemetryModelId(modelId, routeKey) {
  if (routeKey === '/internal/prompt-orchestrator') {
    return 'gemini-3-flash-text'
  }

  if (routeKey === '/internal/prompt-enhancer') {
    return 'gemini-3-flash-text'
  }

  if (modelId === 'gemini-3-pro') {
    return 'nano-banana-pro'
  }

  if (modelId === 'openai-gpt-image-2') {
    return 'gpt-image-2'
  }

  if (modelId === 'veo-3.1-fast') {
    return 'veo-3-fast-generate'
  }

  if (modelId === 'gemini-2.5-flash-image') {
    return 'nano-banana'
  }

  if (modelId === 'gemini-3-flash') {
    return 'nano-banana-2'
  }

  return null
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

function resolveProviderLabel(provider) {
  return provider === 'openai' ? 'OpenAI' : 'Gemini'
}

function hasApiKeyForProvider(provider) {
  return provider === 'openai' ? Boolean(openAiApiKey) : Boolean(apiKey)
}

function buildMissingApiKeyMessage(provider) {
  return provider === 'openai'
    ? 'OpenAI API key is missing. Set OPENAI_API_KEY in .env on the server.'
    : 'Gemini API key is missing. Set GEMINI_API_KEY in .env or use GOOGLE_API_KEY on the server.'
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

function buildIncompleteBatchResponseError({
  candidateCount,
  imageCount,
  modelSelection,
  preferredError,
}) {
  const details = [
    `Requested images: ${candidateCount}`,
    `Completed images: ${imageCount}`,
    `Selected model alias: ${modelSelection.modelId}`,
    `Provider model: ${modelSelection.providerModel}`,
    'Try the request again. If this keeps happening, reduce the batch count.',
  ]

  if (preferredError?.body?.error?.message) {
    details.push(`Last upstream error: ${preferredError.body.error.message}`)
  }

  return {
    error: {
      code: 'batch_incomplete',
      details,
      message:
        `${resolveProviderLabel(modelSelection.provider)} did not return the full requested image batch for this forge run. Try again or reduce the batch count.`,
      title: `${resolveProviderLabel(modelSelection.provider)} Batch Incomplete`,
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

function normalizeGenerationError(
  error,
  modelName = routeModelDefaults['/api/forge'],
  provider = 'google',
) {
  const providerLabel = resolveProviderLabel(provider)
  const payloadFromError =
    error && typeof error === 'object' && 'payload' in error ? error.payload : null
  const statusFromError =
    error && typeof error === 'object' && 'status' in error ? Number(error.status) : null

  if (
    payloadFromError?.error &&
    typeof payloadFromError.error.title === 'string' &&
    typeof payloadFromError.error.message === 'string'
  ) {
    return {
      status: Number.isFinite(statusFromError) && statusFromError > 0 ? statusFromError : 500,
      body: payloadFromError,
    }
  }

  const fallbackMessage =
    error instanceof Error ? error.message : `${providerLabel} request failed unexpectedly.`
  const parsedPayload = tryParseErrorPayload(fallbackMessage)
  const payload = payloadFromError?.error ?? payloadFromError ?? parsedPayload?.error ?? parsedPayload
  const statusCode = Number(statusFromError ?? payload?.code) || 500
  const statusText = String(payload?.status ?? '').toUpperCase()
  const message = String(payload?.message || fallbackMessage)
  const retryAfterSeconds = extractRetryAfterSeconds(payload)

  if (
    statusCode === 429 ||
    statusText === 'RESOURCE_EXHAUSTED' ||
    message.toLowerCase().includes('quota exceeded') ||
    message.toLowerCase().includes('rate limit')
  ) {
    return {
      status: 429,
      body: {
        error: {
          code: provider === 'openai' ? 'rate_limit_exceeded' : 'quota_exceeded',
          details:
            provider === 'openai'
              ? buildOpenAiRateLimitDetails(payload, retryAfterSeconds)
              : buildQuotaDetails(payload, retryAfterSeconds),
          message:
            provider === 'openai'
              ? `This OpenAI key or project does not currently have usable rate limit capacity for ${modelName}. Check your usage tier, project limits, and billing status.`
              : `This Gemini key or project does not currently have usable quota for ${modelName}. ` +
                'That can be caused by free-tier limits, missing billing, or model-specific quota restrictions.',
          retryAfterSeconds,
          title:
            provider === 'openai' ? 'OpenAI Rate Limit Unavailable' : 'Gemini Quota Unavailable',
        },
      },
    }
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      status: statusCode,
      body: {
        error: {
          code: 'auth_failed',
          details:
            provider === 'openai'
              ? buildOpenAiAuthDetails(payload)
              : [
                  'Verify that the API key belongs to the intended Google AI Studio project.',
                  'Check that the project has access to Gemini image generation.',
                ],
          message:
            `${providerLabel} rejected the request because the API key or project permissions are not valid for this model.`,
          title: `${providerLabel} Authentication Failed`,
        },
      },
    }
  }

  if (statusCode === 504 || statusText === 'DEADLINE_EXCEEDED') {
    return {
      status: 504,
      body: {
        error: {
          code: 'request_timeout',
          details: message ? [message] : undefined,
          message:
            `${providerLabel} did not finish this image request before the server timeout. Try again or reduce the batch count.`,
          title: `${providerLabel} Request Timed Out`,
        },
      },
    }
  }

  return {
    status: statusCode,
    body: {
      error: {
        code: 'request_failed',
        details: message ? [message] : undefined,
        message: `${providerLabel} returned an unexpected error while processing this forge request.`,
        title: `${providerLabel} Request Failed`,
      },
    },
  }
}

function tryParseErrorPayload(message) {
  const trimmedMessage = String(message).trim()

  if (!trimmedMessage.startsWith('{')) {
    return null
  }

  try {
    return JSON.parse(trimmedMessage)
  } catch {
    return null
  }
}

function extractRetryAfterSeconds(payload) {
  const retryDelay = payload?.details?.find?.(
    (detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo',
  )?.retryDelay

  if (typeof retryDelay !== 'string') {
    return undefined
  }

  const numericValue = Number.parseInt(retryDelay, 10)
  return Number.isFinite(numericValue) ? numericValue : undefined
}

function buildRequestId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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

function logServerEvent(requestId, message, details) {
  const serializedDetails =
    details && Object.keys(details).length > 0
      ? ` ${JSON.stringify(sanitizeLogDetails(details))}`
      : ''
  console.log(`[${new Date().toISOString()}] [${requestId}] ${message}${serializedDetails}`)
}

function sanitizeLogDetails(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogDetails(entry))
  }

  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 160
      ? `${value.slice(0, 157)}...`
      : value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        key === 'data' ||
        key === 'inlineData' ||
        key === 'prompt' ||
        key === 'systemInstruction' ||
        key === 'contents'
      ) {
        return [key, '[redacted]']
      }

      return [key, sanitizeLogDetails(entry)]
    }),
  )
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutHandle

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              JSON.stringify({
                error: {
                  code: 504,
                  message: timeoutMessage,
                  status: 'DEADLINE_EXCEEDED',
                },
              }),
            ),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function buildQuotaDetails(payload, retryAfterSeconds) {
  const details = []
  const model = payload?.details
    ?.find?.((detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure')
    ?.violations?.[0]?.quotaDimensions?.model

  if (model) {
    details.push(`Model affected: ${model}`)
  }

  details.push('Usage counters in AI Studio can be non-zero while a specific model still has zero available quota.')
  details.push('Check billing, project selection, and model-specific quota access for this API key.')

  if (retryAfterSeconds) {
    details.push(`Retry hint from Gemini: wait about ${retryAfterSeconds} seconds before testing again.`)
  }

  return details
}

function buildOpenAiRateLimitDetails(payload, retryAfterSeconds) {
  const details = []

  if (typeof payload?.type === 'string' && payload.type) {
    details.push(`OpenAI error type: ${payload.type}`)
  }

  details.push('Check your project limits, usage tier, and billing status in the OpenAI dashboard.')

  if (retryAfterSeconds) {
    details.push(`Retry hint from OpenAI: wait about ${retryAfterSeconds} seconds before testing again.`)
  }

  return details
}

function buildOpenAiAuthDetails(payload) {
  const details = [
    'Verify that the API key belongs to the intended OpenAI project or organization.',
    'If this key is tied to a specific project, set OPENAI_PROJECT_ID so requests are scoped to the same project.',
    'If your account spans multiple organizations and you use a legacy user key, set OPENAI_ORGANIZATION_ID too.',
    'Check that the project has access to GPT Image generation.',
    'Some OpenAI projects require API Organization Verification before GPT Image requests will succeed.',
  ]

  if (typeof payload?.type === 'string' && payload.type) {
    details.push(`OpenAI error type: ${payload.type}`)
  }

  if (typeof payload?.code === 'string' && payload.code) {
    details.push(`OpenAI error code: ${payload.code}`)
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    details.push(`OpenAI response: ${payload.message.trim()}`)
  }

  return details
}

async function generateMaterialMapImageWithFallback({
  mapKind,
  preferredModelId,
  promptContext,
  quality,
  requestId,
  sourceImage,
}) {
  const attemptedModelIds = []
  let lastGenerationText = ''
  let lastNoImageSelection = null
  let lastError = null

  for (const candidateModelId of buildRouteModelFallbackSequence(
    '/api/material-maps',
    preferredModelId,
  )) {
    const modelSelection = resolveModelForRoute('/api/material-maps', candidateModelId)

    if (!modelSelection.ok || !hasApiKeyForProvider(modelSelection.provider)) {
      continue
    }

    attemptedModelIds.push(modelSelection.modelId)

    try {
      const generation = await generateImagesWithModel({
        candidateCount: 1,
        modelSelection,
        prompt: buildMaterialMapPrompt(mapKind, promptContext),
        quality,
        references: [sourceImage],
        routeKey: '/api/material-maps',
        size: '1024x1024',
        systemInstruction: buildMaterialMapSystemInstruction(mapKind),
        timeoutMs: forgeGenerationTimeoutMs,
      })
      const [generatedImage] = generation.images

      if (generatedImage) {
        if (attemptedModelIds.length > 1) {
          logServerEvent(requestId, 'material map fallback succeeded', {
            attemptedModels: attemptedModelIds,
            mapKind,
            resolvedModel: modelSelection.modelId,
          })
        }

        return {
          attemptedModelIds,
          generatedImage,
          generation: generation.raw,
          mapKind,
          modelSelection,
          ok: true,
        }
      }

      lastGenerationText = generation.text ?? lastGenerationText
      lastNoImageSelection = modelSelection
      logServerEvent(requestId, 'material map generation returned no image', {
        attemptedModels: attemptedModelIds,
        mapKind,
        model: modelSelection.modelId,
        providerModel: modelSelection.providerModel,
      })
    } catch (error) {
      lastError = {
        error,
        modelSelection,
      }
      logServerEvent(requestId, 'material map generation attempt failed', {
        attemptedModels: attemptedModelIds,
        mapKind,
        model: modelSelection.modelId,
        providerModel: modelSelection.providerModel,
      })
    }
  }

  if (lastNoImageSelection) {
    return {
      attemptedModelIds,
      failureKind: 'no-image',
      generationText: lastGenerationText,
      mapKind,
      modelSelection: lastNoImageSelection,
      ok: false,
    }
  }

  return {
    attemptedModelIds,
    error: lastError?.error ?? new Error(`Material ${mapKind} map generation failed.`),
    failureKind: 'error',
    mapKind,
    modelSelection:
      lastError?.modelSelection ??
      resolveModelForRoute('/api/material-maps', preferredModelId),
    ok: false,
  }
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

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
