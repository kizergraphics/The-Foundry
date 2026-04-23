import { describe, expect, it } from 'vitest'

import { buildActionAnimatorPrompt } from './actionAnimator'
import type { ActionAnimatorState } from './forge'

const baseState: ActionAnimatorState = {
  actionType: 'walk',
  characterImage: null,
  customActionPrompt: '',
  fps: 8,
  frameCount: 8,
  firstFrameGuide: null,
  keyColor: 'green',
  lastFrameGuide: null,
  normalizedSize: 512,
  pipeline: 'veo-video',
}

describe('action animator prompt helpers', () => {
  it('describes the Veo video extraction flow', () => {
    expect(buildActionAnimatorPrompt(baseState)).toContain(
      'Use a flat #00FF00 green chroma background',
    )
  })

  it('includes custom direction for preset actions', () => {
    expect(
      buildActionAnimatorPrompt({
        ...baseState,
        customActionPrompt: 'Add heavier footfalls and a slight shoulder dip.',
      }),
    ).toContain('Additional direction: Add heavier footfalls and a slight shoulder dip.')
  })

  it('describes the image-strip flow when selected', () => {
    expect(
      buildActionAnimatorPrompt({
        ...baseState,
        pipeline: 'image-strip',
      }),
    ).toContain('Return a single horizontal sprite strip with 8 evenly spaced square frames in one row.')
  })
})
