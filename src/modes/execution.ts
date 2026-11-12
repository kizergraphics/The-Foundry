import type { TextureMetadata } from '../../shared/textureLab.js'
import {
  createDataUrl,
  dataUrlToBlob,
  fileToBase64,
} from '../lib/browser'
import type {
  ForgeMode,
  ForgeResult,
  ForgeState,
  OpenAiImageQuality,
  ReferenceAsset,
  ReferenceSlot,
} from '../lib/forge'
import type {
  VfxRecipeManifest,
  VfxTextureKind,
} from '../../shared/vfxForgeCatalog.js'

export type ForgeApiResponse = {
  error?:
    | string
    | {
        code?: string
        details?: string[]
        message?: string
        retryAfterSeconds?: number
        title?: string
      }
  images?: Array<{
    data: string
    id: string
    mimeType: string
    text?: string
    texture?: TextureMetadata
  }>
  model?: string
  prompt?: string
}

export type VfxRecipeApiResponse = {
  error?:
    | string
    | {
        code?: string
        details?: string[]
        message?: string
        retryAfterSeconds?: number
        title?: string
      }
  recipe?: VfxRecipeManifest
}

export type VfxTexturePayload = {
  kind: VfxTextureKind
  mimeType: string
  result: ForgeResult
}

export type ForgeRequestOptions = {
  timeoutMs?: number
}

function buildForgeRequestTimeoutError(timeoutMs: number) {
  return {
    code: 'request_timeout',
    details: [
      `Client waited ${Math.round(timeoutMs / 1000)}s for this output slot.`,
      'The stalled slot was stopped so the forge pass can finish with completed outputs visible.',
    ],
    message:
      'One output slot did not finish before the client timeout. The app will retry it when possible.',
    title: 'Output Slot Timed Out',
  }
}

export async function postForgeRequest(
  body: Record<string, unknown>,
  options: ForgeRequestOptions = {},
) {
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let didTimeout = false
  const request = fetch('/api/forge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller?.signal,
  })

  let response: Response

  try {
    response = await (
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? Promise.race([
            request,
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                didTimeout = true
                controller?.abort()
                reject(buildForgeRequestTimeoutError(options.timeoutMs as number))
              }, options.timeoutMs)
            }),
          ])
        : request
    )
  } catch (error) {
    if (didTimeout) {
      throw buildForgeRequestTimeoutError(options.timeoutMs as number)
    }

    throw error
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }

  const payload = (await response.json()) as ForgeApiResponse | undefined

  return {
    ok: response.ok,
    payload,
  }
}

export async function postVfxRecipeRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/vfx-recipe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as VfxRecipeApiResponse | undefined

  return {
    ok: response.ok,
    payload,
  }
}

export async function postVfxExportRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/vfx-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return {
    blob: response.ok ? await response.blob() : null,
    ok: response.ok,
    payload: response.ok ? null : ((await response.json()) as VfxRecipeApiResponse | undefined),
  }
}

export function normalizeForgeApiResults(payload: ForgeApiResponse): ForgeResult[] {
  return (payload.images ?? []).map((image) => ({
    dataUrl: createDataUrl(image.data, image.mimeType),
    id: image.id,
    mimeType: image.mimeType,
    text: image.text,
    texture: image.texture,
  }))
}

export async function buildStandardForgeRequest({
  generationCount,
  mode,
  modelId,
  quality,
  state,
  styleText,
}: {
  generationCount?: number
  mode: ForgeMode
  modelId: string
  quality: OpenAiImageQuality
  state: ForgeState
  styleText: string
}) {
  const references = await Promise.all(
    Object.entries(state.references)
      .filter((entry): entry is [ReferenceSlot, ReferenceAsset] => Boolean(entry[1]))
      .map(async ([slot, asset]) => ({
        data: await fileToBase64(asset.file),
        mimeType: asset.mimeType,
        name: asset.name,
        slot,
      })),
  )

  return {
    generationCount: generationCount ?? state.generationCount,
    modelId,
    mode,
    prompt: state.prompt.trim(),
    quality,
    references,
    styleText,
  }
}

export async function buildVariantForgeRequest({
  activeVariantOptions,
  customDirection,
  modelId,
  quality,
  state,
  styleText,
}: {
  activeVariantOptions: Array<{
    customSetting: string
    preset: string
  }>
  customDirection: string
  modelId: string
  quality: OpenAiImageQuality
  state: ForgeState['variantForge']
  styleText: string
}) {
  if (!state.baseAsset) {
    throw new Error('Attach a base asset before running Variant Forge.')
  }

  return {
    generationCount: 1,
    mode: 'variant-forge',
    modelId,
    prompt: '',
    quality,
    customDirection: customDirection.trim(),
    preservePalette: state.preservePalette,
    preserveSilhouette: state.preserveSilhouette,
    references: [
      {
        data: await fileToBase64(state.baseAsset.file),
        mimeType: state.baseAsset.mimeType,
        name: state.baseAsset.name,
        slot: 'subject',
      },
    ],
    styleText,
    variantFamily: state.variantFamily,
    variantIntensity: state.intensity,
    variantOptions: activeVariantOptions,
    variantPreset: state.variantPreset,
  }
}

export async function buildPortraitStudioRequest({
  heroImage,
  modelId,
  prompt,
  quality,
  styleText,
}: {
  heroImage: NonNullable<ForgeState['portraitStudio']['heroImage']>
  modelId: string
  prompt: string
  quality: OpenAiImageQuality
  styleText: string
}) {
  return {
    generationCount: 1,
    mode: 'portrait-studio',
    modelId,
    prompt,
    quality,
    references: [
      {
        data: await fileToBase64(heroImage.file),
        mimeType: heroImage.mimeType,
        name: heroImage.name,
        slot: 'subject',
      },
    ],
    styleText,
  }
}

export async function buildTextureExpansionRequest({
  modelId,
  quality,
  sourceAsset,
  state,
  styleText,
}: {
  modelId: string
  quality: OpenAiImageQuality
  sourceAsset: NonNullable<ForgeState['textureLab']['expansionSource']>
  state: ForgeState
  styleText: string
}) {
  return {
    generationCount: 1,
    mode: 'texture-lab', modelId, prompt: state.prompt.trim(), quality, styleText,
    seamlessMode: state.textureLab.seamlessMode,
    textureExpansion: {
      ...state.textureLab.settings,
      sourceImage: { data: await fileToBase64(sourceAsset.file), mimeType: sourceAsset.mimeType, name: sourceAsset.name },
      targetSize: state.textureLab.expansionTargetSize,
      seamlessMode: state.textureLab.seamlessMode,
    },
    workflow: 'expand-texture',
  }
}

export async function buildVfxForgeRequest({
  modelId,
  quality,
  textureKind,
  state,
  styleText,
}: {
  modelId: string
  quality: OpenAiImageQuality
  textureKind: VfxTextureKind
  state: ForgeState
  styleText: string
}) {
  const styleReference = state.references.style
  const references = styleReference
    ? [
        {
          data: await fileToBase64(styleReference.file),
          mimeType: styleReference.mimeType,
          name: styleReference.name,
          slot: 'style' as const,
        },
      ]
    : undefined

  return {
    effectLabel: state.vfxForge.effectLabel.trim(),
    exportTarget:
      state.vfxForge.exportTarget !== 'none' ? state.vfxForge.exportTarget : undefined,
    generationCount: 1,
    frameCount: state.vfxForge.frameCount,
    intensity: state.vfxForge.intensity,
    looping: state.vfxForge.looping,
    mode: 'vfx-forge',
    modelId,
    prompt: state.vfxForge.prompt.trim(),
    quality,
    references,
    styleText,
    textureKind,
  }
}

export async function buildVfxRecipeRequest({
  recipeState,
  textures,
}: {
  recipeState: ForgeState['vfxForge']
  textures: VfxTexturePayload[]
}) {
  return {
    effectLabel: recipeState.effectLabel.trim(),
    exportTarget: recipeState.exportTarget,
    frameCount: recipeState.frameCount,
    intensity: recipeState.intensity,
    looping: recipeState.looping,
    prompt: recipeState.prompt.trim(),
    textureOutputs: recipeState.textureOutputs,
    textures: await Promise.all(
      textures.map(async ({ kind, mimeType, result }) => {
        const blob = await dataUrlToBlob(result.dataUrl)

        return {
          data: await fileToBase64(blob),
          kind,
          mimeType: blob.type || mimeType,
          resultId: result.id,
        }
      }),
    ),
    unityPipeline: 'urp',
  }
}
