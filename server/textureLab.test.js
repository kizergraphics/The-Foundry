import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { processTexture, decodeTexture, wrapPixels } from './textureLab.js'
import { minimumCut, quilt } from './textureQuiltWorker.js'
async function solid(w, h, color) {
  return {
    mimeType: 'image/png',
    data: (
      await sharp({
        create: { width: w, height: h, channels: 4, background: color },
      })
        .png()
        .toBuffer()
    ).toString('base64'),
  }
}
const red = { r: 200, g: 40, b: 20, alpha: 1 },
  blue = { r: 20, g: 40, b: 200, alpha: 1 }
function pixel(image, x, y) {
  return [
    ...image.data.subarray(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    ),
  ]
}
describe('authoritative texture processing', () => {
  it.each([512, 1024])(
    'protects scaled source and exports %s',
    async (targetSize) => {
      const sourceImage = await solid(40, 20, red),
        generated = await solid(1024, 1024, blue),
        generate = vi.fn(async () => generated)
      const result = await processTexture(
        { sourceImage, targetSize, sourceWidth: 40, sourceHeight: 20 },
        { generate, maskSupported: true },
      )
      const decoded = await decodeTexture(result),
        g = result.texture.sourceRect
      expect(decoded.width).toBe(targetSize)
      expect(decoded.height).toBe(targetSize)
      expect(pixel(decoded, g.x, g.y)).toEqual([200, 40, 20, 255])
      expect(pixel(decoded, 0, 0)).toEqual([20, 40, 200, 255])
      expect(generate).toHaveBeenCalledTimes(1)
      const mask = await sharp(generate.mock.calls[0][0].mask).raw().toBuffer()
      expect(mask[3]).toBe(0)
      expect(mask[(512 * 1024 + 512) * 4 + 3]).toBe(255)
      expect(result.texture.status).toBe('expanded')
    },
  )
  it('uses two stages without rescaling the source and reserves finishing room', async () => {
    const sourceImage = await solid(40, 20, red),
      generate = async () => solid(1024, 1024, blue)
    const opts = {
      sourceImage,
      targetSize: 512,
      factor: 4,
      direction: 'left',
      seamlessMode: true,
    }
    const first = await processTexture(opts, { generate })
    expect(first.texture.exportSize).toBe(256)
    const second = await processTexture(
      { ...opts, stage: 2, baseImage: first },
      { generate },
    )
    const d = await decodeTexture(second),
      g = second.texture.sourceRect
    expect(g.x + g.width).toBe(512 - g.seamBand)
    expect(pixel(d, g.x, g.y)).toEqual([200, 40, 20, 255])
    const finish = await processTexture(
      { ...opts, operation: 'finish', baseImage: second },
      {
        generate: async () =>
          solid(1024, 1024, { r: 50, g: 150, b: 70, alpha: 1 }),
      },
    )
    const f = await decodeTexture(finish)
    expect(pixel(f, g.x, g.y)).toEqual(pixel(d, g.x, g.y))
    expect(pixel(f, 60, 60)).toEqual(pixel(d, 60, 60))
    expect(finish.texture.status).toBe('finished')
  })
  it('limits blending and region edits to their declared bands', async () => {
    const sourceImage = await solid(40, 40, red),
      generate = async () => solid(1024, 1024, blue)
    const opts = { sourceImage, targetSize: 512, preservation: 'blend' }
    const result = await processTexture(opts, { generate }),
      d = await decodeTexture(result),
      g = result.texture.sourceRect
    expect(pixel(d, g.x + g.band, g.y + g.band)).toEqual([200, 40, 20, 255])
    expect(pixel(d, g.x, g.y)).toEqual([20, 40, 200, 255])
    const edited = await processTexture(
      {
        ...opts,
        operation: 'region',
        region: { x: 0, y: 0, width: 64, height: 64 },
        baseImage: result,
      },
      { generate: async () => solid(1024, 1024, red) },
    )
    const e = await decodeTexture(edited)
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++)
        if (x >= 64 || y >= 64) {
          const i = (y * 512 + x) * 4
          if (!e.data.subarray(i, i + 4).equals(d.data.subarray(i, i + 4)))
            throw new Error('Region leaked')
        }
    await expect(
      processTexture(
        {
          ...opts,
          preservation: 'preserve',
          operation: 'region',
          region: { x: 200, y: 200, width: 20, height: 20 },
          baseImage: result,
        },
        { generate },
      ),
    ).rejects.toThrow('no editable pixels')
  })
  it('rejects corrupt inputs, mismatched source geometry and unexpected provider size', async () => {
    const sourceImage = await solid(8, 8, red)
    await expect(
      processTexture({ sourceImage: { data: 'broken' }, targetSize: 512 }),
    ).rejects.toThrow()
    await expect(
      processTexture({ sourceImage, sourceWidth: 99 }),
    ).rejects.toThrow('dimensions')
    await expect(
      processTexture(
        { sourceImage },
        { generate: async () => solid(512, 256, blue) },
      ),
    ).rejects.toThrow('expected 1024')
  })
  it('wraps offsets reversibly', () => {
    const original = Buffer.from(Array.from({ length: 64 }, (_, i) => i))
    expect(wrapPixels(wrapPixels(original, 4, 2), 4, 2)).toEqual(original)
  })
  it('runs seeded synthesis in a worker, covers the canvas and preserves source', async () => {
    const sourceImage = await solid(32, 16, red)
    const a = await processTexture({
      sourceImage,
      targetSize: 512,
      technique: 'faithful',
      seed: 42,
    })
    const b = await processTexture({
      sourceImage,
      targetSize: 512,
      technique: 'faithful',
      seed: 42,
    })
    expect(a.data).toBe(b.data)
    const d = await decodeTexture(a)
    expect(
      d.data.every((value, index) => index % 4 !== 3 || value === 255),
    ).toBe(true)
    expect(pixel(d, 256, 256)).toEqual([200, 40, 20, 255])
  }, 20000)
  it('finds a minimum error cut and reproduces structured and irregular patches', () => {
    expect([...minimumCut([9, 0, 9, 9, 0, 9, 9, 0, 9], 3, 3)]).toEqual([
      1, 1, 1,
    ])
    for (const kind of ['stripes', 'noise']) {
      const source = Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) =>
        i % 4 === 3
          ? 255
          : kind === 'stripes'
            ? (Math.floor(i / 128) % 2) * 200
            : (i * 73) % 256,
      )
      const a = quilt({ source, sw: 32, sh: 32, size: 64, seed: 7 }),
        b = quilt({ source, sw: 32, sh: 32, size: 64, seed: 7 })
      expect(a).toEqual(b)
      expect(a.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true)
    }
  })
})
