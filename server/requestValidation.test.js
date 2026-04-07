import { describe, expect, it } from 'vitest'

import {
  validateVfxExportRequest,
  validateForgeRequest,
  validateMaterialMapsRequest,
  validateVariantForgeIdeaRequest,
  validateVfxRecipeRequest,
} from './requestValidation.js'

const validPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII='

describe('validateForgeRequest', () => {
  it('accepts variant forge fields and defaults missing optional values', () => {
    expect(
      validateForgeRequest({
        mode: 'variant-forge',
        references: [
          {
            data: validPngBase64,
            mimeType: 'image/png',
            slot: 'subject',
          },
        ],
        variantFamily: 'elemental',
        variantPreset: 'frozen',
        variantOptions: [
          {
            customSetting: 'Push extra rime along the blade spine.',
            preset: 'frozen',
          },
        ],
      }),
    ).toMatchObject({
      customDirection: '',
      mode: 'variant-forge',
      preservePalette: false,
      preserveSilhouette: true,
      variantFamily: 'elemental',
      variantIntensity: 60,
      variantOptions: [
        {
          customSetting: 'Push extra rime along the blade spine.',
          preset: 'frozen',
        },
      ],
      references: [
        {
          mimeType: 'image/png',
          slot: 'subject',
        },
      ],
      variantPreset: 'frozen',
    })
  })

  it('accepts the no-damage preset for damage variants', () => {
    expect(
      validateForgeRequest({
        mode: 'variant-forge',
        variantFamily: 'damage',
        variantPreset: 'no-damage',
      }),
    ).toMatchObject({
      variantFamily: 'damage',
      variantPreset: 'no-damage',
    })
  })

  it('rejects presets that do not belong to the selected family', () => {
    try {
      validateForgeRequest({
        mode: 'variant-forge',
        variantFamily: 'damage',
        variantPreset: 'legendary',
      })
      throw new Error('Expected validateForgeRequest to reject the payload.')
    } catch (error) {
      expect(error).toMatchObject({
        error: {
          message: 'variantPreset contains an unsupported value.',
        },
      })
    }
  })

  it('rejects variant options that do not belong to the selected family', () => {
    expect(() =>
      validateForgeRequest({
        mode: 'variant-forge',
        variantFamily: 'damage',
        variantOptions: [
          {
            customSetting: 'should fail',
            preset: 'frozen',
          },
        ],
      }),
    ).toThrow()
  })
})

describe('validateVariantForgeIdeaRequest', () => {
  it('accepts variant forge idea-refresh fields and defaults optional values', () => {
    expect(
      validateVariantForgeIdeaRequest({
        styleText: 'Painterly game render',
        variantFamily: 'rarity',
        variantOptions: [
          {
            customSetting: 'Keep the glow restrained and noble.',
            preset: 'epic',
          },
        ],
      }),
    ).toMatchObject({
      customDirection: '',
      preservePalette: false,
      preserveSilhouette: true,
      styleText: 'Painterly game render',
      variantFamily: 'rarity',
      variantIntensity: 60,
      variantOptions: [
        {
          customSetting: 'Keep the glow restrained and noble.',
          preset: 'epic',
        },
      ],
      variantPreset: 'common',
    })
  })

  it('rejects idea-refresh presets that do not belong to the selected family', () => {
    expect(() =>
      validateVariantForgeIdeaRequest({
        variantFamily: 'tech',
        variantPreset: 'legendary',
      }),
    ).toThrow()
  })

  it('accepts VFX forge texture-generation fields and defaults URP pipeline values', () => {
    expect(
      validateForgeRequest({
        effectLabel: 'Fireball',
        exportTarget: 'particle-system',
        mode: 'vfx-forge',
        references: [
          {
            data: validPngBase64,
            mimeType: 'image/png',
            slot: 'style',
          },
        ],
        textureKind: 'flipbook',
        textureOutputs: ['flipbook', 'noise'],
      }),
    ).toMatchObject({
      effectLabel: 'Fireball',
      exportTarget: 'particle-system',
      references: [
        {
          mimeType: 'image/png',
          slot: 'style',
        },
      ],
      textureKind: 'flipbook',
      textureOutputs: ['flipbook', 'noise'],
      unityPipeline: 'urp',
    })
  })
})

describe('validateMaterialMapsRequest', () => {
  it('clamps strength sliders and defaults missing values', () => {
    expect(
      validateMaterialMapsRequest({
        heightStrength: 164,
        metallicStrength: -14,
        sourceImage: {
          data: validPngBase64,
          mimeType: 'image/png',
        },
      }),
    ).toMatchObject({
      heightStrength: 100,
      metallicStrength: 0,
      normalStrength: 60,
      roughnessStrength: 60,
      sourceImage: {
        mimeType: 'image/png',
      },
    })
  })

  it('rejects non-image material-map source payloads', () => {
    expect(() =>
      validateMaterialMapsRequest({
        sourceImage: {
          data: 'abc123',
          mimeType: 'text/plain',
        },
      }),
    ).toThrow()
  })
})

describe('validateVfxRecipeRequest', () => {
  it('accepts recipe payloads with valid texture kinds', () => {
    expect(
      validateVfxRecipeRequest({
        effectLabel: 'Arcane Gate',
        exportTarget: 'vfx-graph',
        frameCount: 12,
        intensity: 72,
        looping: true,
        textureOutputs: ['swirl', 'noise', 'dissolve-mask'],
        textures: [
          {
            data: validPngBase64,
            kind: 'swirl',
            mimeType: 'image/png',
          },
          {
            data: validPngBase64,
            kind: 'noise',
            mimeType: 'image/png',
          },
        ],
        unityPipeline: 'urp',
      }),
    ).toMatchObject({
      effectLabel: 'Arcane Gate',
      exportTarget: 'vfx-graph',
      textureOutputs: ['swirl', 'noise', 'dissolve-mask'],
      unityPipeline: 'urp',
    })
  })

  it('rejects invalid VFX texture kinds', () => {
    expect(() =>
      validateVfxRecipeRequest({
        textureOutputs: ['flipbook'],
        textures: [
          {
            data: validPngBase64,
            kind: 'lava-map',
            mimeType: 'image/png',
          },
        ],
        unitySolution: 'particle-system',
      }),
    ).toThrow()
  })
})

describe('validateVfxExportRequest', () => {
  it('rejects unsupported unity solutions', () => {
    expect(() =>
      validateVfxExportRequest({
        textureOutputs: ['flipbook'],
        textures: [
          {
            data: validPngBase64,
            kind: 'flipbook',
            mimeType: 'image/png',
          },
        ],
        unitySolution: 'shuriken-pro',
      }),
    ).toThrow()
  })
})
