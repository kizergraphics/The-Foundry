import { describe, it, expect } from 'vitest'
import {
  validateTextureRequest,
  textureGeometry,
  textureCallCount,
} from './textureLab.js'
describe('texture contract', () => {
  it.each([512, 1024])(
    'round trips geometry and controls at %s',
    (targetSize) => {
      const o = validateTextureRequest({
        targetSize,
        factor: 4,
        direction: 'left',
        seamlessMode: true,
        preservation: 'blend',
        technique: 'faithful',
        variants: 3,
        sourceWidth: 200,
        sourceHeight: 100,
      })
      expect(o.sourceWidth).toBe(200)
      const g = textureGeometry(200, 100, o)
      expect(g.width).toBe(targetSize / 4)
      expect(g.height).toBe(targetSize / 8)
      expect(g.x + g.width).toBe(targetSize - g.seamBand)
      expect(textureCallCount(o)).toBe(0)
    },
  )
  it('defaults old settings and rejects bad requests', () => {
    expect(validateTextureRequest({}).seamlessMode).toBe(false)
    for (const input of [
      { targetSize: 700 },
      { factor: 3 },
      { stage: 2 },
      { seamlessMode: 'false' },
      { operation: 'region', region: { x: -1, y: 0, width: 20, height: 20 } },
    ])
      expect(() => validateTextureRequest(input)).toThrow()
  })
})
