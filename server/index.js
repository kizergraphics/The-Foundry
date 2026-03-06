import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import { GoogleGenAI } from '@google/genai'
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
  '/api/character-sheet': 'gemini-3-pro',
  '/api/forge': 'gemini-3-flash',
}
const routeModelAllowlist = {
  '/api/character-sheet': ['gemini-3-pro', 'gemini-3-flash'],
  '/api/forge': ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-flash-image'],
}
const supportedForgeModes = ['armory', 'texture-lab', 'visualizer']
const forgeBatchMaxAttemptsPerImage = 4
const forgeBatchInterRequestDelayMs = 250
const forgeBatchRetryDelayMs = 1200
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
      'character-sheet': routeModelAllowlist['/api/character-sheet'],
      forge: routeModelAllowlist['/api/forge'],
    },
    models: {
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
    references = [],
    styleId,
    styleText,
    systemInstruction,
    textureExpansion,
    workflow,
  } = request.body ?? {}

  if (!supportedForgeModes.includes(mode)) {
    response.status(400).json({ error: 'Unsupported forge mode.' })
    return
  }

  const requestedWorkflow = workflow === 'expand-texture' ? 'expand-texture' : 'generate'
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  if (requestedWorkflow !== 'expand-texture' && !normalizedPrompt) {
    response.status(400).json({ error: 'A non-empty prompt is required.' })
    return
  }

  if (requestedWorkflow === 'expand-texture' && mode !== 'texture-lab') {
    response.status(400).json({
      error: 'Texture expansion is only supported inside Texture Lab.',
    })
    return
  }

  const candidateCount =
    requestedWorkflow === 'expand-texture'
      ? 1
      : Math.min(Math.max(Number(generationCount) || 1, 1), 4)
  const modelSelection =
    requestedWorkflow === 'expand-texture'
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
        : await buildForgePromptWithBestPractices({
            ai,
            mode,
            prompt: normalizedPrompt,
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

  const orchestratorModel = modelRegistry['gemini-3-flash']

  if (!orchestratorModel) {
    return buildForgePromptFallback({
      mode,
      prompt: normalizedPrompt,
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
    styleText: normalizedStyleText,
    hasStyleReference,
    hasSubjectReference,
  })
}

function buildForgePromptFallback({
  mode,
  prompt,
  styleText,
  hasStyleReference,
  hasSubjectReference,
}) {
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

function resolveSystemInstruction(customInstruction) {
  if (typeof customInstruction !== 'string' || !customInstruction.trim()) {
    return coreSystemRules.join('\n')
  }

  return `${coreSystemRules.join('\n')}\n${customInstruction.trim()}`
}

function resolveTextureExpansionSystemInstruction(customInstruction) {
  const textureExpansionRules = [
    'This request is a texture outpainting task.',
    'Do not introduce perspective, camera tilt, or directional shadows.',
    'Preserve the centered source texture as the visual anchor for the full material.',
    'Keep texel density stable from center to edge.',
    'The final full canvas must be tile-safe: top must match bottom and left must match right.',
  ]

  return resolveSystemInstruction(
    [textureExpansionRules.join('\n'), customInstruction]
      .filter((value) => typeof value === 'string' && value.trim())
      .join('\n'),
  )
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

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
