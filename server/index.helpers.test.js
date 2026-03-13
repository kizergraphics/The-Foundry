import { describe, expect, it } from 'vitest'

import {
  buildAnimatorMatteFilter,
  normalizeActionAnimatorFrameSize,
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
})
