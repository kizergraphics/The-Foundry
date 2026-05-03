import { createDataUrl, fileToBase64 } from './browser'
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
  keyColor: ActionAnimatorKeyColor
  normalizedSize: ActionAnimatorState['normalizedSize']
  pipeline: ActionAnimatorPipeline
  prompt: string
  sampleStrategy: 'even' | 'strip'
  sourceModel: string | null
}

export type ActionAnimatorArtifacts = {
  frames: ActionAnimatorFrameAsset[]
  metadata: ActionAnimatorMetadata
  spriteSheet: ForgeResult
  video: {
    dataUrl: string
    mimeType: string
  } | null
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
          keyColor?: ActionAnimatorKeyColor
          normalizedSize?: ActionAnimatorState['normalizedSize']
          pipeline?: ActionAnimatorPipeline
          prompt?: string
          sampleStrategy?: 'even' | 'strip'
          sourceModel?: string | null
        }
        spriteSheet?: {
          data: string
          id: string
          mimeType: string
          text?: string
        }
        video?: {
          data: string
          mimeType: string
        } | null
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

type ActionAnimatorVideoRequestPayload = {
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
  const isImageStripPipeline = state.pipeline === 'image-strip'

  return [
    isImageStripPipeline
      ? `Create a 2D game sprite ${actionLabel} strip from the provided character image.`
      : `Create a 2D game sprite ${actionLabel} animation cycle from the provided character image.`,
    'Use a locked side-profile camera with no camera motion or angle changes.',
    'Keep the exact face, proportions, silhouette, outfit shapes, colors, and surface detail from the source image.',
    'Show the full body at a consistent scale with no cropping.',
    `Target ${state.frameCount} frames at ${state.fps} fps.`,
    isImageStripPipeline
      ? `Return a single horizontal sprite strip with ${state.frameCount} evenly spaced square frames in one row.`
      : null,
    `Normalize the output frames to ${state.normalizedSize} x ${state.normalizedSize}.`,
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
}: {
  modelId: string
  quality: OpenAiImageQuality
  state: ActionAnimatorState
}) {
  if (!state.characterImage) {
    throw new Error('A character image is required before generating animation.')
  }

  const request = await buildActionAnimatorVideoRequest(state, modelId, quality)
  const payload = await postActionAnimatorRequest(request)
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
  const metadata = {
    fps: payload.artifacts?.metadata?.fps ?? state.fps,
    frameCount: payload.artifacts?.metadata?.frameCount ?? state.frameCount,
    keyColor: payload.artifacts?.metadata?.keyColor ?? state.keyColor,
    normalizedSize: payload.artifacts?.metadata?.normalizedSize ?? state.normalizedSize,
    pipeline: payload.artifacts?.metadata?.pipeline ?? state.pipeline,
    prompt: payload.artifacts?.metadata?.prompt ?? payload.prompt ?? request.prompt,
    sampleStrategy:
      payload.artifacts?.metadata?.sampleStrategy ??
      (state.pipeline === 'image-strip' ? 'strip' : 'even'),
    sourceModel: payload.artifacts?.metadata?.sourceModel ?? payload.model ?? null,
  }

  return {
    artifacts: {
      frames,
      metadata,
      spriteSheet,
      video:
        payload.artifacts?.video?.data && payload.artifacts.video.mimeType
          ? {
              dataUrl: createDataUrl(
                payload.artifacts.video.data,
                payload.artifacts.video.mimeType,
              ),
              mimeType: payload.artifacts.video.mimeType,
            }
          : null,
    } satisfies ActionAnimatorArtifacts,
    model: payload.model ?? null,
    prompt: payload.prompt ?? request.prompt,
    results: [spriteSheet],
  }
}

async function buildActionAnimatorVideoRequest(
  state: ActionAnimatorState,
  modelId: string,
  quality: OpenAiImageQuality,
): Promise<ActionAnimatorVideoRequestPayload> {
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
    pipeline: state.pipeline,
    prompt: buildActionAnimatorPrompt(state),
    quality,
  }
}

async function postActionAnimatorRequest(request: ActionAnimatorVideoRequestPayload) {
  const response = await fetch('/api/action-animator', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  const payload = (await response.json()) as ActionAnimatorApiResponse

  if (!response.ok) {
    throw payload?.error ?? 'Action Animator generation failed.'
  }

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
  if (!asset?.data || !asset.mimeType) {
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
      return 'Keep the idle subtle but still readable, with weight shift, cloth drag, and arm movement that changes the silhouette.'
    case 'custom':
    default:
      return 'Show one complete readable action arc with strong silhouette changes and no duplicate adjacent poses.'
  }
}
