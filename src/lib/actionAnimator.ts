import {
  buildAnimatorStripCanvasInput,
  createDataUrl,
  fileToBase64,
  normalizeAnimatorSpriteFrames,
  sliceSpriteSheetFrames,
  sliceAnimatorStripSlots,
} from './browser'
import type {
  ActionAnimatorActionType,
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

type ActionAnimatorVideoRequestPayload = {
  actionType: ActionAnimatorActionType
  frameCount: number
  frameSize: ActionAnimatorState['normalizedSize']
  fps: number
  image: {
    data: string
    mimeType: string
    name: string
  }
  modelId: string
  prompt: string
}

type ActionAnimatorStripChunkRequestPayload = {
  actionType: ActionAnimatorActionType
  anchorImage: {
    data: string
    mimeType: string
    name: string
  }
  canvasImage: {
    data: string
    mimeType: string
  }
  chunkIndex: number
  frameCount: number
  fps: number
  modelId: string
  prompt: string
}

type ActionAnimatorApiResponse =
  | {
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
  | undefined

type ActionAnimatorChunkPlan = {
  chunkIndex: number
  slotCount: number
}

export function buildActionAnimatorPrompt(state: ActionAnimatorState) {
  return state.pipeline === 'veo-video'
    ? buildActionAnimatorVideoPrompt(state)
    : buildActionAnimatorStripPrompt(state)
}

export function planActionAnimatorChunks(frameCount: number): ActionAnimatorChunkPlan[] {
  const safeFrameCount = Math.max(4, Math.round(frameCount))
  const chunkCount = Math.max(1, Math.ceil((safeFrameCount - 1) / 3))

  return Array.from({ length: chunkCount }, (_, chunkIndex) => ({
    chunkIndex,
    slotCount: 4,
  }))
}

async function buildActionAnimatorVideoRequest(
  state: ActionAnimatorState,
  modelId: string,
): Promise<ActionAnimatorVideoRequestPayload> {
  if (!state.characterImage) {
    throw new Error('A character image is required before generating animation.')
  }

  return {
    actionType: state.actionType,
    frameCount: state.frameCount,
    frameSize: state.normalizedSize,
    fps: state.fps,
    image: {
      data: await fileToBase64(state.characterImage.file),
      mimeType: state.characterImage.mimeType,
      name: state.characterImage.name,
    },
    modelId,
    prompt: buildActionAnimatorPrompt(state),
  }
}

async function buildActionAnimatorStripChunkRequest(
  state: ActionAnimatorState,
  modelId: string,
  anchorSource: string,
  chunkIndex: number,
): Promise<ActionAnimatorStripChunkRequestPayload> {
  if (!state.characterImage) {
    throw new Error('A seed frame is required before generating animation.')
  }

  const canvasImage = await buildAnimatorStripCanvasInput(anchorSource, {
    slotCount: 4,
    slotSize: 256,
  })
  const anchorBase64 = anchorSource.startsWith('data:')
    ? anchorSource.slice(anchorSource.indexOf(',') + 1)
    : await fileToBase64(state.characterImage.file)
  const anchorMimeType =
    anchorSource.startsWith('data:')
      ? anchorSource.match(/^data:([^;]+);base64,/)?.[1] ?? 'image/png'
      : state.characterImage.mimeType

  return {
    actionType: state.actionType,
    anchorImage: {
      data: anchorBase64,
      mimeType: anchorMimeType,
      name: `action-animator-anchor-${String(chunkIndex + 1).padStart(2, '0')}.png`,
    },
    canvasImage: {
      data: canvasImage.base64,
      mimeType: canvasImage.mimeType,
    },
    chunkIndex,
    frameCount: 4,
    fps: state.fps,
    modelId,
    prompt: buildActionAnimatorPrompt(state),
  }
}

export async function generateActionAnimator({
  modelId,
  state,
}: {
  modelId: string
  state: ActionAnimatorState
}) {
  return state.pipeline === 'veo-video'
    ? generateVeoActionAnimator({
        modelId,
        state,
      })
    : generateStripActionAnimator({
        modelId,
        state,
      })
}

async function generateVeoActionAnimator({
  modelId,
  state,
}: {
  modelId: string
  state: ActionAnimatorState
}) {
  const request = await buildActionAnimatorVideoRequest(state, modelId)
  const payload = await postActionAnimatorRequest('/api/action-animator', request)
  const normalizedResults = await Promise.all(
    payload.images.map(async (image) => {
      const rawSpriteSheetDataUrl = createDataUrl(image.data, image.mimeType)
      const rawFrames = await sliceSpriteSheetFrames(rawSpriteSheetDataUrl, state.frameCount)
      const normalizedFrames = await normalizeAnimatorSpriteFrames(rawFrames, {
        seedFrame: rawFrames[0] ?? rawSpriteSheetDataUrl,
        targetSize: state.normalizedSize,
      })

      return {
        dataUrl: normalizedFrames.spriteSheetDataUrl,
        id: image.id,
        mimeType: 'image/png',
        text:
          image.text ??
          `Generated ${state.frameCount} normalized frames at ${state.normalizedSize} x ${state.normalizedSize}.`,
      } satisfies ForgeResult
    }),
  )

  return {
    model: payload.model ?? null,
    prompt: payload.prompt ?? null,
    results: normalizedResults,
  }
}

async function generateStripActionAnimator({
  modelId,
  state,
}: {
  modelId: string
  state: ActionAnimatorState
}) {
  if (!state.characterImage) {
    throw new Error('A seed frame is required before generating animation.')
  }

  const seedBase64 = await fileToBase64(state.characterImage.file)
  const seedDataUrl = createDataUrl(seedBase64, state.characterImage.mimeType)
  const chunkPlan = planActionAnimatorChunks(state.frameCount)
  const rawFrames: string[] = []
  let latestModel: string | null = null
  let latestPrompt: string | null = null
  let anchorSource = seedDataUrl

  for (const chunk of chunkPlan) {
    const request = await buildActionAnimatorStripChunkRequest(
      state,
      modelId,
      anchorSource,
      chunk.chunkIndex,
    )
    const payload = await postActionAnimatorRequest('/api/action-animator-strip', request)
    const chunkImage = payload.images[0]
    const rawStripDataUrl = createDataUrl(chunkImage.data, chunkImage.mimeType)
    const slotFrames = await sliceAnimatorStripSlots(rawStripDataUrl, chunk.slotCount)
    const nextFrames = chunk.chunkIndex === 0 ? slotFrames : slotFrames.slice(1)

    rawFrames.push(...nextFrames)
    anchorSource = slotFrames[slotFrames.length - 1] ?? anchorSource
    latestModel = payload.model ?? latestModel
    latestPrompt = payload.prompt ?? latestPrompt
  }

  const normalizedFrames = await normalizeAnimatorSpriteFrames(
    rawFrames.slice(0, state.frameCount),
    {
      seedFrame: seedDataUrl,
      targetSize: state.normalizedSize,
    },
  )

  return {
    model: latestModel,
    prompt: latestPrompt ?? buildActionAnimatorPrompt(state),
    results: [
      {
        dataUrl: normalizedFrames.spriteSheetDataUrl,
        id: 'action-animator-sprite-strip',
        mimeType: 'image/png',
        text:
          `Generated ${state.frameCount} normalized frames at ${state.normalizedSize} x ${state.normalizedSize}. ` +
          'The strip pipeline used four-slot chunking with frame 1 locked to the seed frame.',
      },
    ],
  }
}

async function postActionAnimatorRequest(
  route: '/api/action-animator' | '/api/action-animator-strip',
  request: ActionAnimatorVideoRequestPayload | ActionAnimatorStripChunkRequestPayload,
) {
  const response = await fetch(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })
  const payload = (await response.json()) as ActionAnimatorApiResponse

  if (!response.ok || !payload?.images?.length) {
    throw payload?.error ?? 'Action Animator generation failed.'
  }

  return {
    images: payload.images,
    model: payload.model ?? null,
    prompt: payload.prompt ?? null,
  }
}

function buildActionAnimatorStripPrompt(state: ActionAnimatorState) {
  const directionPrompt = state.customActionPrompt.trim()
  const actionLabel =
    state.actionType === 'custom' ? directionPrompt || 'custom action' : state.actionType

  return [
    `Create a candidate production sprite strip for a 2D game ${actionLabel} animation.`,
    'Use the uploaded seed frame as the identity anchor and exact starting frame.',
    `${state.frameCount} total frames with chunked four-slot strip generation.`,
    `Normalize the final output to ${state.normalizedSize} x ${state.normalizedSize} frames.`,
    `Preview target playback rate: ${state.fps} fps.`,
    describeActionAnimatorMotion(state.actionType),
    state.actionType !== 'custom' && directionPrompt
      ? `Additional direction: ${directionPrompt}.`
      : null,
    'Preserve the exact face, palette, silhouette, proportions, outfit shapes, and side-view orientation from the seed frame.',
    'Push clear readable pose changes from frame to frame instead of near-static micro-movement.',
    'Keep the character large inside each slot, with only a small safety margin for motion.',
    'Do not introduce props, scenery, floor planes, glow, haze, labels, or UI.',
    'Keep the image transparent outside the reserved frame slots and avoid poster-style empty margins.',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildActionAnimatorVideoPrompt(state: ActionAnimatorState) {
  const directionPrompt = state.customActionPrompt.trim()
  const actionLabel =
    state.actionType === 'custom' ? directionPrompt || 'custom action' : state.actionType

  if (state.actionType === 'walk' && state.frameCount === 8 && !directionPrompt) {
    return 'A 2D game sprite walk cycle of the character in the image, side-profile view, 8 frames of fluid motion, isolated on a solid #00FF00 green screen background.'
  }

  return [
    `A 2D game sprite ${actionLabel} animation cycle of the character in the image.`,
    'Side-profile view.',
    `${state.frameCount} frames of fluid motion.`,
    `Target playback rate: ${state.fps} fps.`,
    describeActionAnimatorMotion(state.actionType),
    state.actionType !== 'custom' && directionPrompt
      ? `Additional direction: ${directionPrompt}.`
      : null,
    'Preserve the exact character design from the reference image with no new accessories, materials, texture detail, props, or costume changes.',
    'Do not alter the face, proportions, silhouette, colors, clothing shapes, or surface details from the reference image.',
    'Animate the existing character only. Do not redesign or embellish the subject.',
    'Keep the camera locked and the character occupying most of the frame height with consistent scale.',
    'Isolated on a solid #00FF00 green screen background.',
    'The background must remain perfectly identical in every frame.',
    'Do not introduce white backdrops, dark green flicker, gradients, shadows, floor planes, or background changes.',
  ]
    .filter(Boolean)
    .join(' ')
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
