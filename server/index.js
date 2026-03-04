import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import { GoogleGenAI } from '@google/genai'

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
const imageModel = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'
const characterSheetModel =
  process.env.GEMINI_CHARACTER_MODEL ?? 'gemini-3-pro-image-preview'

const modeInstructions = {
  armory:
    '2D game asset, transparent-style background, thick outlines, production-ready presentation.',
  'texture-lab':
    'seamless texture, flat lighting, tileable surface, 1024x1024 composition.',
  visualizer:
    '8k resolution, cinematic lighting, concept art quality, premium reference composition.',
}

const app = express()

app.use(express.json({ limit: '25mb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    models: {
      'character-sheet': characterSheetModel,
      forge: imageModel,
    },
    keyConfigured: Boolean(apiKey),
  })
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
    prompt,
    generationCount,
    references = [],
  } = request.body ?? {}

  if (typeof prompt !== 'string' || !prompt.trim()) {
    response.status(400).json({ error: 'A non-empty prompt is required.' })
    return
  }

  if (!Object.hasOwn(modeInstructions, mode)) {
    response.status(400).json({ error: 'Unsupported forge mode.' })
    return
  }

  const candidateCount = Math.min(Math.max(Number(generationCount) || 1, 1), 4)

  const validReferences = Array.isArray(references)
    ? references.filter(
        (reference) =>
          typeof reference?.mimeType === 'string' &&
          typeof reference?.data === 'string' &&
          reference.data.length > 0,
      )
    : []

  const finalPrompt = buildPrompt({
    mode,
    prompt,
    hasStyleReference: validReferences.some((reference) => reference.slot === 'style'),
    hasSubjectReference: validReferences.some((reference) => reference.slot === 'subject'),
  })

  const ai = new GoogleGenAI({ apiKey })

  try {
    const generation = await ai.models.generateContent({
      model: imageModel,
      contents: [
        { text: finalPrompt },
        ...validReferences.map((reference) => ({
          inlineData: {
            mimeType: reference.mimeType,
            data: reference.data,
          },
        })),
      ],
      config: {
        candidateCount,
      },
    })

    const images = extractImages(generation).slice(0, candidateCount)

    if (images.length === 0) {
      response.status(502).json({
        error:
          generation.text ||
          'Gemini returned no image candidates for this request. Try revising the prompt or references.',
      })
      return
    }

    response.json({
      images,
      model: imageModel,
      prompt: finalPrompt,
    })
  } catch (error) {
    const normalizedError = normalizeGeminiError(error)

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
    parentId,
    prompt,
    references = [],
    responseModalities = ['IMAGE', 'TEXT'],
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
    const generation = await ai.models.generateContent({
      model: characterSheetModel,
      contents: [
        { text: prompt.trim() },
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
        systemInstruction:
          typeof systemInstruction === 'string' && systemInstruction.trim()
            ? systemInstruction.trim()
            : 'Provide the 5 dominant hex codes for this character at the end of the response.',
      },
    })

    const images = extractImages(generation).slice(0, 1)

    if (images.length === 0) {
      response.status(502).json({
        error:
          generation.text ||
          'Gemini returned no character sheet image for this request. Try revising the manifest or references.',
      })
      return
    }

    response.json({
      images,
      model: characterSheetModel,
      parentId: typeof parentId === 'string' ? parentId : null,
      prompt: prompt.trim(),
    })
  } catch (error) {
    const normalizedError = normalizeGeminiError(error, characterSheetModel)

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

function buildPrompt({
  mode,
  prompt,
  hasStyleReference,
  hasSubjectReference,
}) {
  const promptSections = [prompt.trim(), modeInstructions[mode]]

  if (hasStyleReference) {
    promptSections.push(
      'Use the style reference to guide rendering language, palette, finish, and material treatment.',
    )
  }

  if (hasSubjectReference) {
    promptSections.push(
      'Use the subject reference to preserve silhouette, structure, and recognizable content.',
    )
  }

  return promptSections.join('\n\n')
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

function normalizeGeminiError(error, modelName = imageModel) {
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
