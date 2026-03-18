import { describe, expect, it } from 'vitest'

import {
  buildAnimatorMatteFilter,
  buildVariantForgePrompt,
  normalizeActionAnimatorFrameSize,
  resolveVariantForgeSystemInstruction,
} from './index.js'

describe('action animator server sizing helpers', () => {
  it('normalizes Veo frame sizes to supported square values', () => {
    expect(normalizeActionAnimatorFrameSize(512)).toBe(512)
    expect(normalizeActionAnimatorFrameSize(1080)).toBe(1080)
    expect(normalizeActionAnimatorFrameSize(256)).toBe(512)
  })

  it('builds the ffmpeg matte filter using the requested square frame size', () => {
    const filter = buildAnimatorMatteFilter({
      frameSizePx: 1080,
      sampleFps: 2,
    })

    expect(filter).toContain('fps=2')
    expect(filter).toContain('scale=1080:1080')
    expect(filter).toContain('pad=1080:1080')
    expect(filter).toContain('s=1080x1080')
  })

  it('keeps variant forge prompts free of fallback presets when no options are active', () => {
    const prompt = buildVariantForgePrompt({
      customDirection: '',
      preservePalette: false,
      preserveSilhouette: true,
      styleText: '',
      variantFamily: 'damage',
      variantIntensity: 60,
      variantOptions: [],
      variantPreset: 'worn',
    })

    expect(prompt).toContain('Variant preset toggles: none enabled.')
    expect(prompt).not.toContain('Variant preset: Worn.')
  })

  it('keeps variant forge system instructions free of fallback presets when no options are active', () => {
    const instruction = resolveVariantForgeSystemInstruction('', {
      preservePalette: false,
      preserveSilhouette: true,
      variantFamily: 'damage',
      variantIntensity: 60,
      variantOptions: [],
      variantPreset: 'worn',
    })

    expect(instruction).toContain('without applying any named preset cues')
    expect(instruction).not.toContain('Use damage family cues and worn preset cues')
  })
})
