import { describe, expect, it } from 'vitest'

import { buildActionAnimatorPrompt, planActionAnimatorChunks } from './actionAnimator'
import {
  clampActionAnimatorNormalizedSize,
  getActionAnimatorNormalizedSizeOptions,
  initialState,
} from './forge'

describe('planActionAnimatorChunks', () => {
  it('chunks long animations into four-slot strip requests', () => {
    expect(planActionAnimatorChunks(4)).toEqual([
      {
        chunkIndex: 0,
        slotCount: 4,
      },
    ])
    expect(planActionAnimatorChunks(8)).toEqual([
      {
        chunkIndex: 0,
        slotCount: 4,
      },
      {
        chunkIndex: 1,
        slotCount: 4,
      },
      {
        chunkIndex: 2,
        slotCount: 4,
      },
    ])
  })
})

describe('buildActionAnimatorPrompt', () => {
  it('builds a strip-oriented prompt when the sprite pipeline is selected', () => {
    const prompt = buildActionAnimatorPrompt({
      ...initialState.actionAnimator,
      frameCount: 12,
      normalizedSize: 512,
      pipeline: 'sprite-strip',
    })

    expect(prompt).toContain('seed frame')
    expect(prompt).toContain('12 total frames')
    expect(prompt).toContain('512 x 512')
  })

  it('keeps the Veo green-screen prompt for 512 video mode', () => {
    const prompt = buildActionAnimatorPrompt({
      ...initialState.actionAnimator,
      normalizedSize: 512,
      pipeline: 'veo-video',
    })

    expect(prompt).toContain('#00FF00')
    expect(prompt).toContain('character in the image')
  })

  it('keeps the Veo green-screen prompt for 1080 video mode', () => {
    const prompt = buildActionAnimatorPrompt({
      ...initialState.actionAnimator,
      normalizedSize: 1080,
      pipeline: 'veo-video',
    })

    expect(prompt).toContain('#00FF00')
    expect(prompt).toContain('character in the image')
  })
})

describe('action animator sizing helpers', () => {
  it('exposes pipeline-specific size options', () => {
    expect(getActionAnimatorNormalizedSizeOptions('sprite-strip')).toEqual([
      64,
      128,
      256,
      512,
    ])
    expect(getActionAnimatorNormalizedSizeOptions('veo-video')).toEqual([512, 1080])
  })

  it('clamps strip sizes to the nearest supported square export', () => {
    expect(clampActionAnimatorNormalizedSize(300, 'sprite-strip')).toBe(256)
    expect(clampActionAnimatorNormalizedSize(700, 'sprite-strip')).toBe(512)
  })

  it('forces Veo video sizes to 512 or 1080', () => {
    expect(clampActionAnimatorNormalizedSize(512, 'veo-video')).toBe(512)
    expect(clampActionAnimatorNormalizedSize(1080, 'veo-video')).toBe(1080)
    expect(clampActionAnimatorNormalizedSize(256, 'veo-video')).toBe(512)
  })
})
