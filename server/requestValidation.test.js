import { describe, expect, it } from 'vitest'

import { validateActionAnimatorRequest } from './requestValidation.js'

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
