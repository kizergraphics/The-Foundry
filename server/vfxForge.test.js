import { describe, expect, it } from 'vitest'

import {
  buildVfxForgePrompt,
  resolveVfxForgeSystemInstruction,
} from './vfxForge.js'

describe('VFX flipbook prompting', () => {
  it('tells the image model to keep each flipbook frame inside its own slot', () => {
    const prompt = buildVfxForgePrompt({
      effectLabel: 'Sci-Fi Explosion',
      exportTarget: 'none',
      frameCount: 10,
      hasStyleReference: false,
      intensity: 70,
      looping: false,
      prompt: '',
      styleText: '',
      textureKind: 'flipbook',
    })

    expect(prompt).toContain('Each frame must stay fully inside its own equally sized slot.')
    expect(prompt).toContain(
      'Do not overlap adjacent frames, stack frames vertically, or turn the strip into one continuous panorama.',
    )
  })

  it('hardens the flipbook system instruction against cross-frame bleed', () => {
    const instruction = resolveVfxForgeSystemInstruction('', {
      frameCount: 10,
      looping: true,
      textureKind: 'flipbook',
    })

    expect(instruction).toContain('Each frame must be isolated inside an equally sized slot.')
    expect(instruction).toContain(
      'Do not let the effect cross frame boundaries or read like one continuous panoramic image.',
    )
  })
})
