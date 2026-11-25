import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { processTexture, decodeTexture, wrapPixels, normalizeTextureProviderImage } from './textureLab.js'
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
        generated = await solid(1254, 1254, blue),
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
      generate = async () => solid(1254, 1254, blue)
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
          solid(1254, 1254, { r: 50, g: 150, b: 70, alpha: 1 }),
      },
    )
    const f = await decodeTexture(finish)
    expect(pixel(f, g.x, g.y)).toEqual(pixel(d, g.x, g.y))
    expect(pixel(f, 60, 60)).toEqual(pixel(d, 60, 60))
    expect(finish.texture.status).toBe('finished')
  })
  it('limits blending and region edits to their declared bands', async () => {
    const sourceImage = await solid(40, 40, red),
      generate = async () => solid(1254, 1254, blue)
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
      { generate: async () => solid(1254, 1254, red) },
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
  it('feathers seamless joins without changing the preserved source or the unedited interior', async () => {
    const targetSize = 512
    const sourceImage = await solid(40, 40, red)
    const generated = await solid(1024, 1024, blue)
    const options = { sourceImage, targetSize, seamlessMode: true }
    const expanded = await processTexture(options, { generate: async () => generated })
    const before = await decodeTexture(expanded)
    const g = expanded.texture.sourceRect
    expect(pixel(before, g.x, g.y)).toEqual([200, 40, 20, 255])
    expect(pixel(before, g.x - 1, g.y)).toEqual([200, 40, 20, 255])
    expect(pixel(before, 32, 32)).toEqual([20, 40, 200, 255])

    // Simulate a provider edit that changes tone at the center crossing and between both strips.
    const edit = Buffer.alloc(targetSize * targetSize * 4)
    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        const offset = (y * targetSize + x) * 4
        edit[offset] = x < targetSize / 2 ? 40 : 170
        edit[offset + 1] = y < targetSize / 2 ? 30 : 180
        edit[offset + 2] = 90
        edit[offset + 3] = 255
      }
    }
    const repaired = {
      data: (await sharp(edit, { raw: { width: targetSize, height: targetSize, channels: 4 } }).png().toBuffer()).toString('base64'),
    }
    const finished = await processTexture(
      { ...options, operation: 'finish', baseImage: expanded },
      { generate: async () => repaired },
    )
    const after = await decodeTexture(finished)
    const band = Math.ceil(g.seamBand / 2)
    for (let i = 0; i < targetSize; i++) {
      expect(pixel(after, 0, i)).toEqual(pixel(after, targetSize - 1, i))
      expect(pixel(after, i, 0)).toEqual(pixel(after, i, targetSize - 1))
    }
    expect(pixel(after, 0, 40)).not.toEqual(pixel(before, 0, 40))
    expect(Math.abs(pixel(after, band - 1, 40)[0] - pixel(after, band, 40)[0])).toBeLessThan(6)
    expect(pixel(after, band, 40)).toEqual(pixel(before, band, 40))
    for (let row = g.y; row < g.y + g.height; row++) {
      const start = (row * targetSize + g.x) * 4
      const end = start + g.width * 4
      expect(after.data.subarray(start, end)).toEqual(before.data.subarray(start, end))
    }
  })
  it('matches generated source edges only when seamless processing is requested', async () => {
    const image = {
      data: (await sharp(Buffer.from([0, 10, 20, 255, 100, 110, 120, 255, 20, 30, 40, 255, 40, 50, 60, 255]),
        { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer()).toString('base64'),
    }
    const plain = await decodeTexture(await normalizeTextureProviderImage(image, 2))
    const tiled = await decodeTexture(await normalizeTextureProviderImage(image, 2, { matchEdges: true }))
    expect(pixel(plain, 0, 0)).toEqual([0, 10, 20, 255])
    expect(pixel(tiled, 0, 0)).toEqual([40, 50, 60, 255])
    expect(pixel(tiled, 1, 1)).toEqual(pixel(tiled, 0, 0))
  })
  it('rejects corrupt inputs, mismatched source geometry and non-square provider aspect', async () => {
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
    ).rejects.toThrow('expected a square (1:1)')
  })
  it('normalizes actual 1254 square pixels to 1024 without cropping reference coordinates', async () => {
    const native = Buffer.alloc(1254 * 1254 * 4)
    for (let y = 0; y < 1254; y++)
      for (let x = 0; x < 1254; x++) {
        const i = (y * 1254 + x) * 4
        native[i] = Math.round(x * 255 / 1253)
        native[i + 1] = Math.round(y * 255 / 1253)
        native[i + 2] = x < 627 ? 20 : 200
        native[i + 3] = 255
      }
    const image = { data: (await sharp(native, { raw: { width: 1254, height: 1254, channels: 4 } }).png().toBuffer()).toString('base64') }
    const normalized = await normalizeTextureProviderImage(image, 1024)
    expect(normalized.providerDimensions).toEqual({ width: 1254, height: 1254 })
    expect(normalized.mimeType).toBe('image/png')
    const d = await decodeTexture(normalized)
    expect([d.width, d.height]).toEqual([1024, 1024])
    for (const [x, y] of [[0, 0], [256, 768], [768, 256], [1023, 1023]]) {
      expect(Math.abs(pixel(d, x, y)[0] - Math.round(x * 255 / 1023))).toBeLessThanOrEqual(1)
      expect(Math.abs(pixel(d, x, y)[1] - Math.round(y * 255 / 1023))).toBeLessThanOrEqual(1)
      expect(pixel(d, x, y)[2]).toBe(x < 512 ? 20 : 200)
    }
    const sourceImage = await solid(40, 20, red)
    const result = await processTexture({ sourceImage, targetSize: 1024 }, { generate: async () => image })
    const output = await decodeTexture(result)
    const g = result.texture.sourceRect
    const expected = Buffer.from(d.data)
    const sourceRow = Buffer.from(Array.from({ length: g.width }, () => [200, 40, 20, 255]).flat())
    for (let y = g.y; y < g.y + g.height; y++)
      sourceRow.copy(expected, (y * 1024 + g.x) * 4)
    expect(output.data.equals(expected)).toBe(true)
    expect(result.texture.providerDimensions).toEqual({ width: 1254, height: 1254 })
  }, 20000)
  it.each([[1254, 1024], [1024, 1254], [1254, 1253]])('refuses aspect mismatch %sx%s rather than stretching or cropping', async (w, h) => {
    await expect(normalizeTextureProviderImage(await solid(w, h, blue), 1024)).rejects.toThrow('cannot be safely aligned')
  })
  it('rejects malformed generated output and invalid normalization sizes', async () => {
    await expect(normalizeTextureProviderImage({ data: 'broken' }, 1024)).rejects.toThrow()
    await expect(normalizeTextureProviderImage({}, 1024)).rejects.toThrow('source image is required')
    await expect(normalizeTextureProviderImage({}, 0)).rejects.toThrow('normalization size')
    await expect(processTexture({ sourceImage: await solid(8, 8, red) }, { generate: async () => ({ data: 'broken' }) })).rejects.toThrow()
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
