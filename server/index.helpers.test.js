import { describe, expect, it } from 'vitest'

import {
  buildAnimatorMatteFilter,
  buildEnvSearchPaths,
  buildVariantForgeIdeaPrompt,
  buildVariantForgePrompt,
  normalizeActionAnimatorFrameSize,
  resolveActionAnimatorSampleFps,
  normalizeVariantForgeIdeaResponse,
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
      keyColor: 'blue',
      sampleFps: 2,
    })

    expect(filter).toContain('fps=2')
    expect(filter).toContain('scale=1080:1080')
    expect(filter).toContain('pad=1080:1080')
    expect(filter).toContain('chromakey=0x0000FF')
    expect(filter).toContain('format=rgba')
    expect(filter).not.toContain('overlay=')
  })

  it('derives evenly sampled extraction fps from frame count and duration', () => {
    expect(
      resolveActionAnimatorSampleFps({
        durationSeconds: 4,
        frameCount: 8,
      }),
    ).toBe(2)
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

  it('searches parent desktop build folders for the project .env file', () => {
    expect(
      buildEnvSearchPaths({
        cwd: 'C:\\Users\\ant77\\Desktop\\The Foundry',
        execPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\release\\The Foundry.exe',
        resourcesPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\release\\resources',
        rootDir: 'C:\\Users\\ant77\\Desktop\\The Foundry\\server\\..',
      }),
    ).toContain('C:\\Users\\ant77\\Desktop\\The Foundry\\.env')

    expect(
      buildEnvSearchPaths({
        cwd: 'C:\\Users\\ant77\\Desktop\\The Foundry',
        execPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\release\\win-unpacked\\The Foundry.exe',
        resourcesPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\release\\win-unpacked\\resources',
        rootDir: 'C:\\Users\\ant77\\Desktop\\The Foundry\\server\\..',
      }),
    ).toContain('C:\\Users\\ant77\\Desktop\\The Foundry\\.env')
  })
})

describe('variant forge idea helpers', () => {
  it('builds idea prompts with family, lead preset, active options, and custom direction', () => {
    const prompt = buildVariantForgeIdeaPrompt({
      customDirection: 'quiet prestige, jewel sockets, and druidic premium treatment',
      preservePalette: true,
      preserveSilhouette: true,
      styleText: 'painted fantasy inventory render',
      variantFamily: 'rarity',
      variantIntensity: 72,
      variantOptions: [
        {
          customSetting: 'Keep the upgrade noble rather than explosive.',
          preset: 'epic',
        },
      ],
      variantPreset: 'rare',
    })

    expect(prompt).toContain('Variant family: Rarity.')
    expect(prompt).toContain('Lead preset: Rare.')
    expect(prompt).toContain('Enabled presets: Epic.')
    expect(prompt).toContain('Epic custom setting: Keep the upgrade noble rather than explosive.')
    expect(prompt).toContain(
      'Family direction: quiet prestige, jewel sockets, and druidic premium treatment.',
    )
    expect(prompt).toContain('Style guidance: painted fantasy inventory render.')
  })

  it('falls back to curated ideas when the model text is incomplete', () => {
    const response = normalizeVariantForgeIdeaResponse(
      '1. noble trim\n2. jewel socket accents',
      'rarity',
    )

    expect(response.source).toBe('fallback')
    expect(response.ideas).toHaveLength(4)
  })

  it('returns normalized ai ideas when four distinct lines are available', () => {
    const response = normalizeVariantForgeIdeaResponse(
      '1. wind-carved fuller\n2. drifting pollen halo\n3. seedpod pommel wrap\n4. thorn-vein filigree',
      'elemental',
    )

    expect(response).toEqual({
      ideas: [
        'wind-carved fuller',
        'drifting pollen halo',
        'seedpod pommel wrap',
        'thorn-vein filigree',
      ],
      source: 'ai',
    })
  })
})
