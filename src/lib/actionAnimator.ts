import { createDataUrl, fileToBase64 } from './browser'
import type { ActionAnimatorActionType, ActionAnimatorState, ForgeResult } from './forge'

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

export type ActionAnimatorRequestPayload = {
  actionType: ActionAnimatorActionType
  frameCount: number
  fps: number
  image: {
    data: string
    mimeType: string
    name: string
  }
  modelId: string
  prompt: string
}

export function buildActionAnimatorPrompt(state: ActionAnimatorState) {
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
    state.actionType !== 'custom' && directionPrompt
      ? `Additional direction: ${directionPrompt}.`
      : null,
    'Preserve the exact character design from the reference image with no new accessories, materials, texture detail, props, or costume changes.',
    'Do not alter the face, proportions, silhouette, colors, clothing shapes, or surface details from the reference image.',
    'Animate the existing character only. Do not redesign or embellish the subject.',
    'Isolated on a solid #00FF00 green screen background.',
    'The background must remain perfectly identical in every frame.',
    'Do not introduce white backdrops, dark green flicker, gradients, shadows, floor planes, or background changes.',
  ]
    .filter(Boolean)
    .join(' ')
}

export async function buildActionAnimatorRequest(
  state: ActionAnimatorState,
  modelId: string,
): Promise<ActionAnimatorRequestPayload> {
  if (!state.characterImage) {
    throw new Error('A character image is required before generating animation.')
  }

  return {
    actionType: state.actionType,
    frameCount: state.frameCount,
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

export async function generateActionAnimator({
  modelId,
  state,
}: {
  modelId: string
  state: ActionAnimatorState
}) {
  const request = await buildActionAnimatorRequest(state, modelId)
  const response = await fetch('/api/action-animator', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = (await response.json()) as
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

  if (!response.ok || !payload?.images?.length) {
    throw payload?.error ?? 'Action Animator generation failed.'
  }

  return {
    model: payload.model ?? null,
    prompt: payload.prompt ?? null,
    results: payload.images.map<ForgeResult>((image) => ({
      dataUrl: createDataUrl(image.data, image.mimeType),
      id: image.id,
      mimeType: image.mimeType,
      text: image.text,
    })),
  }
}
