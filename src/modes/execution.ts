import {
  buildTextureExpansionInput,
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
  TextureMaterialMapDefaults,
  TextureMaterialMapKey,
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
  }>
  model?: string
  prompt?: string
}

export type MaterialMapsApiResponse = {
  error?:
    | string
    | {
        code?: string
        details?: string[]
        message?: string
        retryAfterSeconds?: number
        title?: string
      }
  maps?: Partial<
    Record<
      TextureMaterialMapKey,
      {
        data: string
        id: string
        mimeType: string
        height: number
        width: number
      }
    >
  >
  model?: string
}

export type MaterialMapResult = {
  dataUrl: string
  height: number
  id: string
  mimeType: string
  width: number
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

export async function postForgeRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/forge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as ForgeApiResponse | undefined

  return {
    ok: response.ok,
    payload,
  }
}

export async function postMaterialMapsRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/material-maps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as MaterialMapsApiResponse | undefined

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
  }))
}

export function normalizeMaterialMapsApiResults(
  payload: MaterialMapsApiResponse,
): Partial<Record<TextureMaterialMapKey, MaterialMapResult>> {
  return Object.fromEntries(
    Object.entries(payload.maps ?? {}).map(([key, image]) => [
      key,
      {
        dataUrl: createDataUrl(image.data, image.mimeType),
        height: image.height,
        id: image.id,
        mimeType: image.mimeType,
        width: image.width,
      },
    ]),
  ) as Partial<Record<TextureMaterialMapKey, MaterialMapResult>>
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
    seamlessMode: mode === 'texture-lab' && state.textureLab.workflow === 'generate'
      ? state.textureLab.seamlessMode
      : undefined,
    styleText,
    textureSize:
      mode === 'texture-lab' && state.textureLab.workflow === 'generate'
        ? state.textureLab.expansionTargetSize
        : undefined,
  }
}

export async function buildMaterialMapsRequest({
  modelId,
  prompt,
  quality,
  result,
  strengths,
  styleText,
}: {
  modelId: string
  prompt: string
  quality: OpenAiImageQuality
  result: ForgeResult
  strengths: TextureMaterialMapDefaults
  styleText: string
}) {
  const sourceBlob = await dataUrlToBlob(result.dataUrl)

  return {
    ...strengths,
    modelId,
    prompt: prompt.trim(),
    quality,
    sourceImage: {
      data: await fileToBase64(sourceBlob),
      mimeType: sourceBlob.type || result.mimeType,
    },
    sourceText: result.text?.trim() ?? '',
    styleText: styleText.trim(),
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
  const [expansionCanvas, sourceBase64] = await Promise.all([
    buildTextureExpansionInput(sourceAsset.file, {
      targetSize: state.textureLab.expansionTargetSize,
    }),
    fileToBase64(sourceAsset.file),
  ])

  return {
    generationCount: 1,
    mode: state.activeMode,
    modelId,
    prompt: state.prompt.trim(),
    quality,
    styleText,
    textureExpansion: {
      canvasImage: {
        data: expansionCanvas.base64,
        mimeType: expansionCanvas.mimeType,
        name: `expanded-canvas-${sourceAsset.name}`,
      },
      sourceCoverage: expansionCanvas.sourceCoverage,
      sourceHeight: expansionCanvas.sourceHeight,
      sourceImage: {
        data: sourceBase64,
        mimeType: sourceAsset.mimeType,
        name: sourceAsset.name,
      },
      sourceWidth: expansionCanvas.sourceWidth,
      targetSize: expansionCanvas.targetSize,
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
