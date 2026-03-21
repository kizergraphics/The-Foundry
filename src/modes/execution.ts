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
  ReferenceAsset,
  ReferenceSlot,
  TextureMaterialMapDefaults,
  TextureMaterialMapKey,
} from '../lib/forge'

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
  state,
  styleText,
}: {
  generationCount?: number
  mode: ForgeMode
  modelId: string
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
  prompt,
  result,
  strengths,
  styleText,
}: {
  prompt: string
  result: ForgeResult
  strengths: TextureMaterialMapDefaults
  styleText: string
}) {
  const sourceBlob = await dataUrlToBlob(result.dataUrl)

  return {
    ...strengths,
    prompt: prompt.trim(),
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
  state,
  styleText,
}: {
  activeVariantOptions: Array<{
    customSetting: string
    preset: string
  }>
  customDirection: string
  modelId: string
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
  styleText,
}: {
  heroImage: NonNullable<ForgeState['portraitStudio']['heroImage']>
  modelId: string
  prompt: string
  styleText: string
}) {
  return {
    generationCount: 1,
    mode: 'portrait-studio',
    modelId,
    prompt,
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
  sourceAsset,
  state,
  styleText,
}: {
  modelId: string
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

export function buildVfxForgeRequest({
  modelId,
  state,
  styleText,
}: {
  modelId: string
  state: ForgeState['vfxForge']
  styleText: string
}) {
  return {
    generationCount: 1,
    frameCount: state.frameCount,
    intensity: state.intensity,
    mode: 'vfx-forge',
    modelId,
    projectileType: state.projectileType.trim(),
    prompt: state.prompt.trim(),
    styleText,
  }
}
