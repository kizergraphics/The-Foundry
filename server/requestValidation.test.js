import { describe, expect, it } from 'vitest'

import {
  validateActionAnimatorRequest,
  validateForgeRequest,
} from './requestValidation.js'

const validPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII='

function buildActionAnimatorPayload(frameSize) {
  return {
    actionType: 'walk',
    fps: 8,
    frameCount: 8,
    frameSize,
    image: {
      data: validPngBase64,
      mimeType: 'image/png',
    },
    modelId: 'veo-3.1-fast',
    prompt: 'Walk cycle',
  }
}

describe('validateActionAnimatorRequest', () => {
  it('accepts 512 and 1080 frame sizes', () => {
    expect(validateActionAnimatorRequest(buildActionAnimatorPayload(512)).frameSize).toBe(512)
    expect(validateActionAnimatorRequest(buildActionAnimatorPayload(1080)).frameSize).toBe(1080)
  })

  it('defaults missing frame size to 512', () => {
    expect(validateActionAnimatorRequest(buildActionAnimatorPayload(undefined)).frameSize).toBe(
      512,
    )
  })

  it('rejects unsupported frame sizes', () => {
    expect(() => validateActionAnimatorRequest(buildActionAnimatorPayload(256))).toThrow()
    expect(() => validateActionAnimatorRequest(buildActionAnimatorPayload(1024))).toThrow()
  })
})

describe('validateForgeRequest', () => {
  it('accepts variant forge fields and defaults missing optional values', () => {
    expect(
      validateForgeRequest({
        mode: 'variant-forge',
        references: [
          {
            data: validPngBase64,
            mimeType: 'image/png',
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
