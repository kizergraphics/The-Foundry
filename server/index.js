import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import { GoogleGenAI } from '@google/genai/node'
import ffmpegPath from 'ffmpeg-static'
import { getUsageSummary, recordUsageEvent } from './usageStore.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

const port = Number(process.env.PORT ?? 3001)
const apiKey =
  process.env.GEMINI_API_KEY ??
  process.env.VITE_GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY
const modelRegistry = {
  'gemini-2.5-flash-image':
    process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  'gemini-3-flash':
    process.env.GEMINI_FLASH_MODEL ?? 'gemini-3.1-flash-image-preview',
  'gemini-3-pro':
    process.env.GEMINI_PRO_MODEL ?? 'gemini-3-pro-image-preview',
  'veo-3.1-fast':
    process.env.GEMINI_VEO_MODEL ?? 'veo-3.1-fast-generate-preview',
}
const routeModelDefaults = {
  '/api/action-animator': 'veo-3.1-fast',
  '/api/character-sheet': 'gemini-3-pro',
  '/api/forge': 'gemini-3-flash',
}
const routeModelAllowlist = {
  '/api/action-animator': ['veo-3.1-fast'],
  '/api/character-sheet': ['gemini-3-pro', 'gemini-3-flash'],
  '/api/forge': ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-flash-image'],
}
const supportedForgeModes = [
  'armory',
  'loot-leveler',
  'portrait-studio',
  'texture-lab',
  'vfx-forge',
  'visualizer',
]
const forgeBatchMaxAttemptsPerImage = 4
const forgeBatchInterRequestDelayMs = 250
const forgeBatchRetryDelayMs = 1200
const actionAnimatorPollingIntervalMs = 10000
const actionAnimatorTimeoutMs = 5 * 60 * 1000
const minActionAnimatorDurationSeconds = 4
const maxActionAnimatorDurationSeconds = 8
const actionAnimatorDurationSeconds = clampActionAnimatorDurationSeconds(
  Number(process.env.GEMINI_VEO_DURATION_SECONDS ?? minActionAnimatorDurationSeconds),
)
const actionAnimatorBackgroundColor = '0x00FF00'
const actionAnimatorFrameSizePx = 512
const coreSystemRules = [
  'Always render assets on a neutral gray #808080 background.',
  'Never include text, logos, or watermarks in the image.',
  'Ensure all assets are centered and fit entirely within the frame.',
]

const app = express()

app.use(express.json({ limit: '25mb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    availableModels: {
      'action-animator': routeModelAllowlist['/api/action-animator'],
      'character-sheet': routeModelAllowlist['/api/character-sheet'],
      forge: routeModelAllowlist['/api/forge'],
    },
    models: {
      'action-animator': routeModelDefaults['/api/action-animator'],
      'character-sheet': routeModelDefaults['/api/character-sheet'],
      forge: routeModelDefaults['/api/forge'],
    },
    keyConfigured: Boolean(apiKey),
  })
})

app.get('/api/usage', async (request, response) => {
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

app.post('/api/forge', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({
      error:
        'Gemini API key is missing. Set GEMINI_API_KEY in .env. VITE_GEMINI_API_KEY is accepted temporarily, but server-side naming is preferred.',
    })
    return
  }

  const {
    mode,
    modelId,
    prompt,
    generationCount,
    intensity,
    projectileType,
    frameCount,
    rarity,
    references = [],
    styleId,
    styleText,
    systemInstruction,
    seamRepair,
    seamlessMode,
    textureExpansion,
    workflow,
  } = request.body ?? {}

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

  if (
    requestedWorkflow === 'generate' &&
    !normalizedPrompt &&
    mode !== 'loot-leveler' &&
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
  const modelSelection =
    requestedWorkflow === 'expand-texture' || requestedWorkflow === 'repair-seams'
      ? resolveModelForRoute('/api/forge', 'gemini-3-pro')
      : resolveModelForRoute('/api/forge', modelId)

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

  const ai = new GoogleGenAI({ apiKey })

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
        : mode === 'loot-leveler'
          ? buildLootLevelerPrompt({
              rarity,
              styleText: providedStyleText,
            })
        : mode === 'portrait-studio'
          ? buildPortraitStudioPrompt({
              prompt: normalizedPrompt,
              styleText: providedStyleText,
            })
        : mode === 'vfx-forge'
          ? buildVfxForgePrompt({
              frameCount,
              intensity,
              prompt: normalizedPrompt,
              projectileType,
              styleText: providedStyleText,
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
          })
    const resolvedSystemInstruction =
      requestedWorkflow === 'expand-texture'
        ? resolveTextureExpansionSystemInstruction(systemInstruction)
        : requestedWorkflow === 'repair-seams'
          ? resolveSeamRepairSystemInstruction(systemInstruction)
        : mode === 'loot-leveler'
          ? resolveLootLevelerSystemInstruction(systemInstruction, { rarity })
        : mode === 'portrait-studio'
          ? resolvePortraitStudioSystemInstruction(systemInstruction)
        : mode === 'vfx-forge'
          ? resolveVfxForgeSystemInstruction(systemInstruction, { frameCount })
          : mode === 'texture-lab'
          ? resolveTextureGenerationSystemInstruction(systemInstruction, {
              seamlessMode: Boolean(seamlessMode),
            })
        : resolveSystemInstruction(systemInstruction)

    if (requestedWorkflow === 'expand-texture') {
      const validExpansion = normalizeTextureExpansion(textureExpansion)

      if (!validExpansion) {
        response.status(400).json({
          error:
            'Texture expansion requires a centered expansion canvas and the original source texture.',
        })
        return
      }

      const generation = await ai.models.generateContent({
        model: modelSelection.providerModel,
        contents: [
          { text: finalPrompt },
          {
            inlineData: {
              mimeType: validExpansion.canvasImage.mimeType,
              data: validExpansion.canvasImage.data,
            },
          },
          {
            inlineData: {
              mimeType: validExpansion.sourceImage.mimeType,
              data: validExpansion.sourceImage.data,
            },
          },
        ],
        config: {
          candidateCount: 1,
          responseModalities: ['IMAGE', 'TEXT'],
          systemInstruction: resolvedSystemInstruction,
        },
      })

      const images = extractImages(generation).slice(0, 1)

      if (images.length === 0) {
        response
          .status(422)
          .json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
        return
      }

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/forge',
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

      const generation = await ai.models.generateContent({
        model: modelSelection.providerModel,
        contents: [
          { text: finalPrompt },
          {
            inlineData: {
              mimeType: validRepair.offsetImage.mimeType,
              data: validRepair.offsetImage.data,
            },
          },
          {
            inlineData: {
              mimeType: validRepair.originalImage.mimeType,
              data: validRepair.originalImage.data,
            },
          },
        ],
        config: {
          candidateCount: 1,
          responseModalities: ['IMAGE', 'TEXT'],
          systemInstruction: resolvedSystemInstruction,
        },
      })

      const images = extractImages(generation).slice(0, 1)

      if (images.length === 0) {
        response
          .status(422)
          .json(buildNoImageResponseError('/api/forge', modelSelection, generation.text))
        return
      }

      await recordUsageEvent({
        model: modelSelection.modelId,
        route: '/api/forge',
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
    const maxAttempts = candidateCount * forgeBatchMaxAttemptsPerImage
    const successfulRuns = []
    const normalizedErrors = []
    const noImageTexts = []
    const images = []
    let attempts = 0

    while (images.length < candidateCount && attempts < maxAttempts) {
      attempts += 1

      try {
        const useModalities = attempts % 2 === 1
        const generation = await ai.models.generateContent({
          model: modelSelection.providerModel,
          contents: baseContents,
          config: useModalities
            ? {
                candidateCount: 1,
                responseModalities: ['IMAGE', 'TEXT'],
                systemInstruction: resolvedSystemInstruction,
              }
            : {
                candidateCount: 1,
                systemInstruction: resolvedSystemInstruction,
              },
        })

        successfulRuns.push(generation)

        const image = extractImages(generation).at(0)

        if (image) {
          images.push({
            ...image,
            id: `batch-${images.length + 1}-${image.id}`,
          })
        } else if (generation.text) {
          noImageTexts.push(generation.text)
        }

        if (images.length < candidateCount) {
          await sleep(forgeBatchInterRequestDelayMs)
        }
      } catch (requestError) {
        const normalizedError = normalizeGeminiError(
          requestError,
          modelSelection.modelId,
        )
        normalizedErrors.push(normalizedError)
        const isRetryable =
          normalizedError.status === 429 || normalizedError.status >= 500
        if (!isRetryable) {
          break
        }

        const retryAfterSeconds = normalizedError.body?.error?.retryAfterSeconds
        const retryAfterDelay =
          typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : forgeBatchRetryDelayMs
        await sleep(retryAfterDelay)
      }
    }

    if (images.length === 0) {
      if (successfulRuns.length === 0 && normalizedErrors.length > 0) {
        const preferredError =
          normalizedErrors.find((error) => error.status === 429) ??
          normalizedErrors[0]
        response.status(preferredError.status).json(preferredError.body)
        return
      }

      const fallbackText = noImageTexts[0] ?? successfulRuns[0]?.text
      response
        .status(422)
        .json(buildNoImageResponseError('/api/forge', modelSelection, fallbackText))
      return
    }

    await Promise.all(
      successfulRuns.map(() =>
        recordUsageEvent({
          model: modelSelection.modelId,
          route: '/api/forge',
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
  } catch (error) {
    const normalizedError = normalizeGeminiError(error, modelSelection.modelId)

    response.status(normalizedError.status).json(normalizedError.body)
  }
})

app.post('/api/character-sheet', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({
      error:
        'Gemini API key is missing. Set GEMINI_API_KEY in .env. VITE_GEMINI_API_KEY is accepted temporarily, but server-side naming is preferred.',
    })
    return
  }

  const {
    aspectRatio = '16:9',
    generationMode,
    modelId,
    parentId,
    prompt,
    references = [],
    responseModalities = ['IMAGE', 'TEXT'],
    styleId,
    systemInstruction,
  } = request.body ?? {}

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

  const ai = new GoogleGenAI({ apiKey })

  try {
    const trimmedPrompt = prompt.trim()
    const styleLabel =
      typeof styleId === 'string' && styleId.trim() ? styleId.trim() : 'studio-default'
    const promptForGeneration = await maybeEnhancePrompt({
      ai,
      prompt: trimmedPrompt,
      styleLabel,
    })

    const generation = await ai.models.generateContent({
      model: modelSelection.providerModel,
      contents: [
        { text: promptForGeneration },
        ...validReferences.map((reference) => ({
          inlineData: {
            mimeType: reference.mimeType,
            data: reference.data,
          },
        })),
      ],
      config: {
        aspectRatio,
        candidateCount: 1,
        responseModalities,
        systemInstruction: resolveSystemInstruction(
          typeof systemInstruction === 'string' && systemInstruction.trim()
            ? systemInstruction.trim()
            : 'Provide the 5 dominant hex codes for this character at the end of the response.',
        ),
      },
    })

    const images = extractImages(generation).slice(0, 1)

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
    const normalizedError = normalizeGeminiError(error, modelSelection.modelId)

    response.status(normalizedError.status).json(normalizedError.body)
  }
})

app.post('/api/action-animator', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({
      error:
        'Gemini API key is missing. Set GEMINI_API_KEY in .env. VITE_GEMINI_API_KEY is accepted temporarily, but server-side naming is preferred.',
    })
    return
  }

  const { actionType, fps, frameCount, image, modelId, prompt } = request.body ?? {}
  const normalizedFps = clampActionAnimatorFps(fps)
  const normalizedFrameCount = clampAnimatorFrameCount(frameCount)

  if (
    typeof image?.mimeType !== 'string' ||
    typeof image?.data !== 'string' ||
    !image.data.length
  ) {
    response.status(400).json({
      error: 'Action Animator requires a source character image.',
    })
    return
  }

  const modelSelection = resolveModelForRoute('/api/action-animator', modelId)

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

  const ai = new GoogleGenAI({ apiKey })

  try {
    const animatorResult = await generateAnimatorSpriteSheet({
      actionType,
      ai,
      fps: normalizedFps,
      frameCount: normalizedFrameCount,
      image,
      modelSelection,
      prompt,
    })

    await recordUsageEvent({
      model: modelSelection.modelId,
      route: '/api/action-animator',
    }).catch((logError) => {
      console.warn('Telemetry logging failed for /api/action-animator:', logError)
    })

    response.json({
      images: [
        {
          data: animatorResult.spriteSheetBase64,
          id: 'action-animator-sprite-sheet',
          mimeType: 'image/png',
          text: animatorResult.note,
        },
      ],
      model: modelSelection.modelId,
      prompt: animatorResult.prompt,
      providerModel: modelSelection.providerModel,
    })
  } catch (error) {
    const normalizedError = normalizeGeminiError(error, modelSelection.modelId)

    response.status(normalizedError.status).json(normalizedError.body)
  }
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir))

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Kizer Forge API listening on http://localhost:${port}`)
})

async function buildForgePromptWithBestPractices({
  ai,
  mode,
  prompt,
  seamlessMode,
  styleText,
  hasStyleReference,
  hasSubjectReference,
}) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText =
    typeof styleText === 'string' ? styleText.trim() : ''

  if (!normalizedPrompt) {
    return ''
  }

  if (mode === 'texture-lab' && seamlessMode) {
    return buildSemanticTilingPrompt({
      prompt: normalizedPrompt,
      styleText: normalizedStyleText,
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
    })
  }

  const modeTask =
    mode === 'texture-lab'
      ? 'Build a seamless, tile-safe texture prompt for production use.'
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
  })
}

function buildForgePromptFallback({
  mode,
  prompt,
  seamlessMode,
  styleText,
  hasStyleReference,
  hasSubjectReference,
}) {
  if (mode === 'texture-lab' && seamlessMode) {
    return buildSemanticTilingPrompt({ prompt, styleText })
  }

  const modeBestPractices =
    mode === 'texture-lab'
      ? 'seamless tile-safe structure, flat lighting, controlled surface scale'
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

function buildSemanticTilingPrompt({ prompt, styleText }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText =
    typeof styleText === 'string' && styleText.trim()
      ? styleText.trim()
      : 'neutral production texture'

  return (
    `Create a seamless repeating pattern of ${normalizedPrompt}. ` +
    'Ensure smooth transitions at the edges for flawless tiling. ' +
    `Style: ${normalizedStyleText}, high resolution, perfectly tileable horizontal and vertical edges, balanced composition. ` +
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

function buildLootLevelerPrompt({ rarity, styleText }) {
  const normalizedRarity = normalizeLootRarity(rarity)
  const rarityEffects = {
    common: 'Keep the asset grounded and production clean.',
    rare: 'Add minor engravings, subtle shine, and restrained rarity cues.',
    epic: 'Introduce glow accents, premium materials, and a bolder rarity read.',
    legendary:
      'Add elemental aura language, floating shards, and dramatic premium VFX accents.',
  }

  return [
    'Upgrade the attached base asset into a higher-rarity game item render.',
    'Preserve the original silhouette, proportions, and core weapon or item type exactly.',
    `Rarity target: ${normalizedRarity}.`,
    rarityEffects[normalizedRarity],
    styleText ? `Style guidance: ${styleText}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
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

function resolveLootLevelerSystemInstruction(customInstruction, { rarity }) {
  const normalizedRarity = normalizeLootRarity(rarity)
  const strengthGuidance = {
    common: 'Keep changes minimal and close to the original base asset.',
    rare: 'Apply a low-strength upgrade pass comparable to a 0.2 variation.',
    epic: 'Apply a medium-strength upgrade pass comparable to a 0.5 variation.',
    legendary: 'Apply a high-strength upgrade pass comparable to a 0.8 variation.',
  }

  return [
    coreSystemRules.join('\n'),
    'Maintain the silhouette and core geometry of the input image.',
    'Keep the weapon or item type identical to the source asset.',
    `Apply ${normalizedRarity} visual upgrades only.`,
    strengthGuidance[normalizedRarity],
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

function resolveTextureGenerationSystemInstruction(customInstruction, { seamlessMode }) {
  const textureRules = [
    'This request is a full-frame material texture generation task.',
    'Fill the image edge to edge with texture detail. Do not create a backdrop or empty border.',
    'Keep the view top-down and lighting flat and production-safe.',
    seamlessMode
      ? 'The result must tile seamlessly on both the horizontal and vertical edges.'
      : null,
  ]

  return [coreSystemRules.slice(1).join('\n'), textureRules.join('\n'), customInstruction]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

async function maybeEnhancePrompt({ ai, prompt, styleLabel }) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  if (!normalizedPrompt || countWords(normalizedPrompt) >= 10) {
    return normalizedPrompt
  }

  const enhancerModel = modelRegistry['gemini-3-flash']

  if (!enhancerModel) {
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

  if (!providerModel) {
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
    providerModel,
  }
}

function buildNoImageResponseError(routeKey, modelSelection, generationText) {
  const incompatibleSignal = looksLikeToolDelegation(generationText)
  const recommendedModelIds = routeModelAllowlist[routeKey] ?? []
  const recommendations = recommendedModelIds
    .filter((modelId) => modelId !== modelSelection.modelId)
    .map((modelId) => `"${modelId}"`)

  const details = [
    `Selected model alias: ${modelSelection.modelId}`,
    `Provider model: ${modelSelection.providerModel}`,
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

function normalizeGeminiError(
  error,
  modelName = routeModelDefaults['/api/forge'],
) {
  const fallbackMessage =
    error instanceof Error ? error.message : 'Gemini request failed unexpectedly.'
  const parsedPayload = tryParseErrorPayload(fallbackMessage)
  const payload = parsedPayload?.error ?? parsedPayload
  const statusCode = Number(payload?.code) || 500
  const statusText = String(payload?.status ?? '').toUpperCase()
  const message = String(payload?.message || fallbackMessage)
  const retryAfterSeconds = extractRetryAfterSeconds(payload)

  if (
    statusCode === 429 ||
    statusText === 'RESOURCE_EXHAUSTED' ||
    message.toLowerCase().includes('quota exceeded')
  ) {
    return {
      status: 429,
      body: {
        error: {
          code: 'quota_exceeded',
          details: buildQuotaDetails(payload, retryAfterSeconds),
          message:
            `This Gemini key or project does not currently have usable quota for ${modelName}. ` +
            'That can be caused by free-tier limits, missing billing, or model-specific quota restrictions.',
          retryAfterSeconds,
          title: 'Gemini Quota Unavailable',
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
          details: [
            'Verify that the API key belongs to the intended Google AI Studio project.',
            'Check that the project has access to Gemini image generation.',
          ],
          message:
            'Gemini rejected the request because the API key or project permissions are not valid for this model.',
          title: 'Gemini Authentication Failed',
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
        message: 'Gemini returned an unexpected error while processing this forge request.',
        title: 'Gemini Request Failed',
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

async function generateAnimatorSpriteSheet({
  actionType,
  ai,
  fps,
  frameCount,
  image,
  modelSelection,
  prompt,
}) {
  const normalizedPrompt = buildAnimatorPrompt({
    actionType,
    fps,
    frameCount,
    prompt,
  })
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
  const spriteSheetBase64 = await createSpriteSheetFromVideo({
    image,
    frameCount,
    videoBuffer,
  })

  return {
    note:
      `Generated ${frameCount} frame sprite sheet from Veo 3.1 Fast with a target playback rate of ${fps} fps. ` +
      'Frame 1 is locked to the reference image, with feet, lighting, centering, and background constraints injected server-side.',
    prompt: normalizedPrompt,
    spriteSheetBase64,
  }
}

function buildAnimatorPrompt({ actionType, fps, frameCount, prompt }) {
  const normalizedAction =
    typeof actionType === 'string' && actionType.trim().length > 0
      ? actionType.trim().toLowerCase()
      : 'idle'
  const normalizedFps = clampActionAnimatorFps(fps)
  const normalizedFrameCount = clampAnimatorFrameCount(frameCount)
  const baseWalkPrompt =
    'A 2D game sprite walk cycle of the character in the image, side-profile view, 8 frames of fluid motion, isolated on a solid #00FF00 green screen background.'

  const basePrompt =
    normalizedAction === 'walk' && normalizedFrameCount === 8
      ? baseWalkPrompt
      : typeof prompt === 'string' && prompt.trim().length > 0
        ? prompt.trim()
        : [
            `A 2D game sprite ${normalizedAction} cycle of the character in the image, side-profile view,`,
            `${normalizedFrameCount} frames of fluid motion,`,
            'isolated on a solid #00FF00 green screen background.',
          ].join(' ')

  return [
    basePrompt,
    `Target playback rate: ${normalizedFps} fps.`,
    'Keep the feet on the same horizontal plane with no vertical drifting.',
    'Keep the lighting constant across all frames.',
    'Keep the character centered within each frame to prevent jitter.',
    'Preserve the exact character design from the reference image with no new accessories, materials, texture detail, props, or costume changes.',
    'Do not alter the face, proportions, silhouette, colors, clothing shapes, or surface details from the reference image.',
    'Animate the existing character only. Do not redesign or embellish the subject.',
    'The background must remain perfectly identical in every frame.',
    'Do not introduce white backdrops, dark green flicker, gradients, shadows, floor planes, or background changes.',
    'Use a solid green background (#00FF00) for easy post-processing removal.',
  ].join(' ')
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
      await ai.files.download({
        file: video,
        downloadPath,
      })

      return await fs.readFile(downloadPath)
    } catch (downloadError) {
      const videoResponse = await fetch(video.uri, {
        headers: apiKey
          ? {
              'x-goog-api-key': apiKey,
            }
          : undefined,
      })

      if (!videoResponse.ok) {
        throw new Error(
          `Generated video could not be downloaded from the returned URI. ` +
            `SDK download failed first: ${
              downloadError instanceof Error ? downloadError.message : 'unknown error'
            }`,
        )
      }

      return Buffer.from(await videoResponse.arrayBuffer())
    } finally {
      await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {})
    }
  }

  throw new Error('Veo returned no downloadable video bytes for the animation request.')
}

async function createSpriteSheetFromVideo({ frameCount, image, videoBuffer }) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is unavailable, so sprite sheet extraction cannot run.')
  }

  const safeFrameCount = clampAnimatorFrameCount(frameCount)
  const extractedVideoFrameCount = Math.max(0, safeFrameCount - 1)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forger-action-animator-'))
  const referenceImagePath = path.join(
    tempDir,
    `reference-source${getAnimatorImageExtension(image?.mimeType)}`,
  )
  const videoPath = path.join(tempDir, 'source.mp4')
  const framePattern = path.join(tempDir, 'frame-%02d.png')
  const spriteSheetPath = path.join(tempDir, 'sprite-sheet.png')

  try {
    await fs.writeFile(referenceImagePath, Buffer.from(image.data, 'base64'))
    await fs.writeFile(videoPath, videoBuffer)
    await runFfmpeg([
      '-y',
      '-i',
      referenceImagePath,
      '-filter_complex',
      buildAnimatorMatteFilter(),
      '-map',
      '[out]',
      '-frames:v',
      '1',
      path.join(tempDir, 'frame-01.png'),
    ])

    if (extractedVideoFrameCount > 0) {
      await runFfmpeg([
        '-y',
        '-i',
        videoPath,
        '-filter_complex',
        buildAnimatorMatteFilter({
          sampleFps: extractedVideoFrameCount / actionAnimatorDurationSeconds,
        }),
        '-map',
        '[out]',
        '-frames:v',
        String(extractedVideoFrameCount),
        '-start_number',
        '2',
        framePattern,
      ])
    }

    const frameInputs = Array.from({ length: safeFrameCount }, (_, index) => [
      '-i',
      path.join(tempDir, `frame-${String(index + 1).padStart(2, '0')}.png`),
    ]).flat()

    await runFfmpeg([
      '-y',
      ...frameInputs,
      '-filter_complex',
      `${Array.from({ length: safeFrameCount }, (_, index) => `[${index}:v]`).join('')}hstack=inputs=${safeFrameCount},format=rgba`,
      '-frames:v',
      '1',
      spriteSheetPath,
    ])

    const spriteSheetBuffer = await fs.readFile(spriteSheetPath)
    return spriteSheetBuffer.toString('base64')
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {})
  }
}

function buildAnimatorMatteFilter(options = {}) {
  const filterSteps = []

  if (typeof options.sampleFps === 'number' && Number.isFinite(options.sampleFps)) {
    filterSteps.push(`fps=${Math.max(0.5, options.sampleFps)}`)
  }

  filterSteps.push(
    `scale=${actionAnimatorFrameSizePx}:${actionAnimatorFrameSizePx}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${actionAnimatorFrameSizePx}:${actionAnimatorFrameSizePx}:(ow-iw)/2:(oh-ih)/2:color=${actionAnimatorBackgroundColor}`,
    `chromakey=${actionAnimatorBackgroundColor}:0.22:0.06`,
    'colorkey=0xFFFFFF:0.18:0.05',
  )

  return [
    `[0:v]${filterSteps.join(',')}[subject]`,
    `color=c=${actionAnimatorBackgroundColor}:s=${actionAnimatorFrameSizePx}x${actionAnimatorFrameSizePx}[background]`,
    '[background][subject]overlay=format=auto,format=rgba[out]',
  ].join(';')
}

function getAnimatorImageExtension(mimeType) {
  if (mimeType === 'image/jpeg') {
    return '.jpg'
  }

  if (mimeType === 'image/webp') {
    return '.webp'
  }

  return '.png'
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

function normalizeLootRarity(rarity) {
  if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
    return rarity
  }

  return 'common'
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
