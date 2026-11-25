import { describeActionAnimatorGrid } from '../../shared/actionAnimatorLayout.js'
import { createDataUrl, fileToBase64 } from './browser'
import { reportLibrarySave } from './imageLibrary'
import type {
  ActionAnimatorActionType,
  ActionAnimatorKeyColor,
  OpenAiImageQuality,
  ActionAnimatorPipeline,
  ActionAnimatorState,
  ForgeResult,
} from './forge'

export const actionAnimatorActionOptions: Array<{
  label: string
  value: ActionAnimatorActionType
}> = [
  { label: 'Idle', value: 'idle' },
  { label: 'Walk', value: 'walk' },
  { label: 'Run', value: 'run' },
  { label: 'Attack', value: 'attack' },
  { label: 'Jump', value: 'jump' },
  { label: 'Custom', value: 'custom' },
]

export type ActionAnimatorFrameAsset = ForgeResult

export type ActionAnimatorMetadata = {
  fps: number
  frameCount: number
  background?: 'transparent'
  durationSeconds?: number
  atlas?: { columns: number; rows: number; width: number; height: number; frames: Array<{ file: string; x: number; y: number; width: number; height: number; timeSeconds: number }> }
  keyColor: ActionAnimatorKeyColor
  normalizedSize: ActionAnimatorState['normalizedSize']
  pipeline: ActionAnimatorPipeline
  prompt: string
  sampleStrategy: 'strip'
  sourceModel: string | null
}

export type ActionAnimatorArtifacts = {
  frames: ActionAnimatorFrameAsset[]
  metadata: ActionAnimatorMetadata
  spriteSheet: ForgeResult
}

export function getActionAnimatorPreviewPosition(start: number, elapsedMs: number, fps: number, count: number) {
  return count > 0 ? (start + Math.max(0, elapsedMs) * (Number.isFinite(fps) && fps > 0 ? fps : 1) / 1000) % count : 0
}

export function getActionAnimatorAtlasPreviewFrames(artifacts?: ActionAnimatorArtifacts | null) {
  const atlas = artifacts?.metadata.atlas
  if (!atlas || !artifacts.spriteSheet.dataUrl || !Number.isSafeInteger(atlas.width) || atlas.width <= 0
    || !Number.isSafeInteger(atlas.height) || atlas.height <= 0 || !Array.isArray(atlas.frames)
    || atlas.frames.length !== artifacts.frames.length) return null

  if (atlas.frames.some((rect) => !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.width !== rect.height
    || rect.x + rect.width > atlas.width || rect.y + rect.height > atlas.height)) return null

  return atlas.frames.map((rect) => ({
    backgroundSize: `${100 * atlas.width / rect.width}% ${100 * atlas.height / rect.height}%`,
    backgroundPosition: `${atlas.width === rect.width ? 0 : 100 * rect.x / (atlas.width - rect.width)}% ${atlas.height === rect.height ? 0 : 100 * rect.y / (atlas.height - rect.height)}%`,
  }))
}

type ActionAnimatorApiResponse =
  | {
      artifacts?: {
        frames?: Array<{
          data: string
          id: string
          mimeType: string
          text?: string
        }>
        metadata?: {
          fps?: number
          frameCount?: number
          background?: ActionAnimatorMetadata['background']
          durationSeconds?: number
          atlas?: ActionAnimatorMetadata['atlas']
          keyColor?: ActionAnimatorKeyColor
          normalizedSize?: ActionAnimatorState['normalizedSize']
          pipeline?: ActionAnimatorPipeline
          prompt?: string
          sampleStrategy?: 'strip'
          sourceModel?: string | null
        }
        spriteSheet?: {
          data: string
          id: string
          mimeType: string
          text?: string
        }
      }
      error?:
        | string
        | {
            code?: string
            details?: string[]
            message?: string
            retryAfterSeconds?: number
            title?: string
          }
      model?: string
      prompt?: string
    }
  | undefined

type ActionAnimatorRequestPayload = {
  actionType: ActionAnimatorActionType
  fps: number
  firstFrame?: {
    data: string
    mimeType: string
    name: string
  }
  frameCount: number
  image: {
    data: string
    mimeType: string
    name: string
  }
  keyColor: ActionAnimatorKeyColor
  lastFrame?: {
    data: string
    mimeType: string
    name: string
  }
  modelId: string
  normalizedSize: ActionAnimatorState['normalizedSize']
  pipeline: ActionAnimatorState['pipeline']
  prompt: string
  quality: OpenAiImageQuality
}

export function buildActionAnimatorPrompt(state: ActionAnimatorState) {
  const directionPrompt = state.customActionPrompt.trim()
  const actionLabel =
    state.actionType === 'custom' ? directionPrompt || 'custom action' : state.actionType
  const keyColorLabel = state.keyColor === 'blue' ? '#0000FF blue' : '#00FF00 green'

  return [
    `Create a 2D game sprite ${actionLabel} cycle from the provided character image.`,
    'Match the view of the source image unless the user requests a different view. Lock the camera, with no motion or angle changes between poses.',
    'Keep the exact face, proportions, silhouette, outfit shapes, colors, and surface detail from the source image.',
    'Show the full body at a consistent scale with no cropping. Keep a common origin and ground line across all frames, preserving airborne movement.',
    `Target ${state.frameCount} frames at ${state.fps} fps.`,
    describeActionAnimatorGrid(state.frameCount),
    `Use a flat ${keyColorLabel} chroma background with no gradients, shadows, floor planes, props, or scenery.`,
    state.firstFrameGuide
      ? 'Use the supplied first-frame guide as the opening pose.'
      : null,
    state.lastFrameGuide
      ? 'Use the supplied last-frame guide as the ending pose.'
      : null,
    describeActionAnimatorMotion(state.actionType),
    directionPrompt ? `Additional direction: ${directionPrompt}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export async function generateActionAnimator({
  modelId,
  quality,
  state,
  signal,
}: {
  modelId: string
  quality: OpenAiImageQuality
  state: ActionAnimatorState
  signal?: AbortSignal
}) {
  if (!state.characterImage) {
    throw new Error('A character image is required before generating animation.')
  }

  signal?.throwIfAborted()
  validateActionAnimatorState(state)
  const request = await buildActionAnimatorRequest(state, modelId, quality)
  signal?.throwIfAborted()
  const payload = await postActionAnimatorRequest(request, signal)
  signal?.throwIfAborted()
  const spriteSheet = normalizeForgeResult(
    payload.artifacts?.spriteSheet,
    'action-animator-sprite-sheet',
  )

  if (!spriteSheet) {
    throw payload.error ?? 'Action Animator generation returned no sprite sheet.'
  }

  const frames = (payload.artifacts?.frames ?? [])
    .map((frame, index) =>
      normalizeForgeResult(frame, `action-animator-frame-${String(index + 1).padStart(2, '0')}`),
    )
    .filter((frame): frame is ForgeResult => frame !== null)
  if (frames.length !== state.frameCount) {
    throw new Error(`Action Animator returned ${frames.length} readable frames; expected ${state.frameCount}. Try a corrected sprite strip.`)
  }
  const returnedMetadata = payload.artifacts?.metadata
  if (returnedMetadata?.frameCount !== undefined && returnedMetadata.frameCount !== frames.length) {
    throw new Error('Action Animator frame metadata does not match the returned images.')
  }
  const metadata = {
    fps: returnedMetadata?.fps ?? state.fps,
    frameCount: frames.length,
    background: returnedMetadata?.background,
    durationSeconds: returnedMetadata?.durationSeconds,
    atlas: returnedMetadata?.atlas,
    keyColor: payload.artifacts?.metadata?.keyColor ?? state.keyColor,
    normalizedSize: payload.artifacts?.metadata?.normalizedSize ?? state.normalizedSize,
    pipeline: 'image-strip' as const,
    prompt: payload.artifacts?.metadata?.prompt ?? payload.prompt ?? request.prompt,
    sampleStrategy: 'strip' as const,
    sourceModel: payload.artifacts?.metadata?.sourceModel ?? payload.model ?? null,
  }

  return {
    artifacts: {
      frames,
      metadata,
      spriteSheet,
    } satisfies ActionAnimatorArtifacts,
    model: payload.model ?? null,
    prompt: payload.prompt ?? request.prompt,
    results: [spriteSheet],
  }
}

async function buildActionAnimatorRequest(
  state: ActionAnimatorState,
  modelId: string,
  quality: OpenAiImageQuality,
): Promise<ActionAnimatorRequestPayload> {
  if (!state.characterImage) {
    throw new Error('A character image is required before generating animation.')
  }

  return {
    actionType: state.actionType,
    fps: state.fps,
    firstFrame: state.firstFrameGuide
      ? {
          data: await fileToBase64(state.firstFrameGuide.file),
          mimeType: state.firstFrameGuide.mimeType,
          name: state.firstFrameGuide.name,
        }
      : undefined,
    frameCount: state.frameCount,
    image: {
      data: await fileToBase64(state.characterImage.file),
      mimeType: state.characterImage.mimeType,
      name: state.characterImage.name,
    },
    keyColor: state.keyColor,
    lastFrame: state.lastFrameGuide
      ? {
          data: await fileToBase64(state.lastFrameGuide.file),
          mimeType: state.lastFrameGuide.mimeType,
          name: state.lastFrameGuide.name,
        }
      : undefined,
    modelId,
    normalizedSize: state.normalizedSize,
    pipeline: 'image-strip',
    prompt: buildActionAnimatorPrompt(state),
    quality,
  }
}

async function postActionAnimatorRequest(request: ActionAnimatorRequestPayload, signal?: AbortSignal) {
  const response = await fetch('/api/action-animator', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json', 'X-Foundry-Request': '1',
    },
    body: JSON.stringify(request),
  })
  let payload: ActionAnimatorApiResponse
  try {
    payload = (await response.json()) as ActionAnimatorApiResponse
  } catch {
    signal?.throwIfAborted()
    throw new Error(`Action Animator returned an unreadable response (HTTP ${response.status}).`)
  }

  if (!response.ok) {
    throw payload?.error ?? 'Action Animator generation failed.'
  }
  reportLibrarySave(response)

  return {
    artifacts: payload?.artifacts,
    error: payload?.error,
    model: payload?.model ?? null,
    prompt: payload?.prompt ?? null,
  }
}

function normalizeForgeResult(
  asset:
    | {
        data: string
        id: string
        mimeType: string
        text?: string
      }
    | undefined,
  fallbackId: string,
): ForgeResult | null {
  if (!asset?.data?.trim() || !/^image\/(png|jpeg|webp)$/.test(asset.mimeType)) {
    return null
  }

  return {
    dataUrl: createDataUrl(asset.data, asset.mimeType),
    id: asset.id || fallbackId,
    mimeType: asset.mimeType,
    text: asset.text,
  }
}

function describeActionAnimatorMotion(actionType: ActionAnimatorActionType) {
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
      return 'Keep the idle subtle, with planted feet and a small cyclical weight shift. Make the last pose flow into the first without a duplicate endpoint.'
    case 'custom':
    default:
      return 'Show one complete readable action arc with strong silhouette changes and no duplicate adjacent poses.'
  }
}

function validateActionAnimatorState(state: ActionAnimatorState) {
  if (!Number.isInteger(state.frameCount) || state.frameCount < 4 || state.frameCount > 30) {
    throw new Error('Animation frame count must be a whole number from 4 to 30.')
  }
  if (!Number.isInteger(state.fps) || state.fps < 1 || state.fps > 30) {
    throw new Error('Animation FPS must be a whole number from 1 to 30.')
  }
  if (![512, 1080].includes(state.normalizedSize)) {
    throw new Error('Animation frame size must be 512 or 1080 pixels.')
  }
}
