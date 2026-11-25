// @vitest-environment node
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { getActionAnimatorLayout } from '../shared/actionAnimatorLayout.js'
import { createActionAnimatorArtifactsFromImageStrip, despillActionAnimatorFrame } from './actionAnimator.js'

it.each(['green', 'blue'])('removes %s spill only at alpha edges without changing alpha', async (key) => {
  const size = 20
  const data = Buffer.alloc(size * size * 4)
  const spread = key === 'green' ? [45, 210, 100] : [45, 100, 210]
  const keptColor = key === 'green' ? [45, 120, 220] : [45, 220, 120]
  const offset = (x, y) => 4 * (y * size + x)
  for (let y = 3; y <= 16; y++) for (let x = 3; x <= 16; x++) {
    data.set([...spread, x === 3 ? 120 : 255], offset(x, y))
  }
  data.set([...keptColor, 255], offset(4, 10))
  const input = await sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
  const cleaned = await sharp(await despillActionAnimatorFrame(input, key)).raw().toBuffer()
  const pixel = (x, y) => [...cleaned.subarray(offset(x, y), offset(x, y) + 4)]
  expect(pixel(3, 10)).toEqual([45, 100, 100, 120])
  expect(pixel(5, 10)).toEqual([45, 100, 100, 255])
  expect(pixel(4, 10)).toEqual([...keptColor, 255])
  expect(pixel(10, 10)).toEqual([...spread, 255])
  expect(pixel(2, 10)).toEqual([0, 0, 0, 0])
})

const opts = { frameCount: 4, frameSize: 512, fps: 8, keyColor: 'green', prompt: 'jump', sourceModel: 'codex' }
async function grid({ count = 4, skip = -1, clipped = -1, stray = false, solid = false, square = false, key = '#00FF00' } = {}) {
  const { columns, rows, unusedCells } = getActionAnimatorLayout(count)
  const width = 384, height = square ? 384 : 256
  const tiles = []
  for (let index = 0; index < count + (stray && unusedCells ? 1 : 0); index += 1) {
    if (index === skip) continue
    const fill = ['#FF0000', '#FFFF00', '#FF00FF', '#FFFFFF'][index % 4]
    tiles.push({
      input: await sharp({ create: { width: 16, height: 26, channels: 4, background: fill } }).png().toBuffer(),
      left: Math.round(index % columns * width / columns) + (index === clipped ? 0 : 18),
      top: Math.round(Math.floor(index / columns) * height / rows) + (index === 1 ? 5 : 34),
    })
  }
  return sharp({ create: { width, height, channels: 4, background: solid ? '#DDDDDD' : key } }).composite(tiles).png().toBuffer()
}
async function bounds(asset) {
  const { data, info } = await sharp(Buffer.from(asset.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let top = info.height, bottom = -1
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (data[(y * info.width + x) * 4 + 3] >= 128) { top = Math.min(top, y); bottom = Math.max(bottom, y) }
  }
  return { top, bottom, data, ...info }
}
describe('Action Animator grid processing', () => {
  it('exports transparent PNGs and a compact atlas with one shared crop preserving jump height and row order', async () => {
    const result = await createActionAnimatorArtifactsFromImageStrip({ ...opts, sourceImageBuffer: await grid() })
    const frames = await Promise.all(result.frames.map(bounds))
    expect(frames).toHaveLength(4)
    expect(frames[1].bottom).toBeLessThan(frames[0].top)
    expect(frames[0].data[3]).toBe(0)
    const offset = ((frames[0].top + 40) * 512 + 256) * 4
    expect([...frames[0].data.subarray(offset, offset + 4)]).toEqual([255, 0, 0, 255])
    expect([...frames[2].data.subarray(offset, offset + 4)]).toEqual([255, 0, 255, 255])
    expect(result.metadata).toMatchObject({ frameCount: 4, durationSeconds: 0.5, background: 'transparent', atlas: { columns: 2, rows: 2, width: 1024, height: 1024 } })
    expect(result.metadata.atlas.frames[2]).toMatchObject({ file: 'frames/frame-03.png', x: 0, y: 512, timeSeconds: 0.25 })
    const sheet = await sharp(Buffer.from(result.spriteSheet.data, 'base64')).metadata()
    expect([sheet.width, sheet.height, sheet.hasAlpha]).toEqual([1024, 1024, true])
    expect(result).not.toHaveProperty('video')
  })
  it('exports 16 ordered idle frames at 12 fps on a compact four by four atlas', async () => {
    const result = await createActionAnimatorArtifactsFromImageStrip({ ...opts, frameCount: 16, fps: 12, sourceImageBuffer: await grid({ count: 16 }) })
    expect(result.frames).toHaveLength(16)
    expect(result.metadata).toMatchObject({ durationSeconds: 16 / 12, atlas: { columns: 4, rows: 4, width: 2048, height: 2048 } })
  })
  it('accepts a square native provider response when the planned grid is square', async () => {
    const result = await createActionAnimatorArtifactsFromImageStrip({ ...opts, frameCount: 16, fps: 12, sourceImageBuffer: await grid({ count: 16, square: true }) })
    expect(result.metadata.atlas).toMatchObject({ columns: 4, rows: 4 })
    expect(result.frames).toHaveLength(16)
    await expect(createActionAnimatorArtifactsFromImageStrip({ ...opts, frameCount: 12, sourceImageBuffer: await grid({ count: 12, square: true }) })).rejects.toThrow('3:2 landscape')
  })
  it('rejects blank, clipped, wrong-aspect, backdrop and overflow frames with a 422', async () => {
    for (const [fixture, message] of [[{ skip: 0 }, /frame 1 is empty/], [{ clipped: 0 }, /touches a cell boundary/], [{ solid: true }, /invalid backdrop/], [{ count: 5, stray: true }, /reserved blank cell/]]) {
      await expect(createActionAnimatorArtifactsFromImageStrip({ ...opts, frameCount: fixture.count || 4, sourceImageBuffer: await grid(fixture) })).rejects.toMatchObject({ status: 422, code: 'animation_grid_invalid', message: expect.stringMatching(message) })
    }
    const strip = await sharp({ create: { width: 256, height: 64, channels: 4, background: '#00FF00' } }).png().toBuffer()
    await expect(createActionAnimatorArtifactsFromImageStrip({ ...opts, sourceImageBuffer: strip })).rejects.toThrow('3:2 landscape')
  })
  it('supports blue and validates numeric ranges', async () => {
    const sourceImageBuffer = await grid({ key: '#0000FF' })
    const result = await createActionAnimatorArtifactsFromImageStrip({ ...opts, keyColor: 'blue', sourceImageBuffer })
    expect(result.metadata.keyColor).toBe('blue')
    await expect(createActionAnimatorArtifactsFromImageStrip({ ...opts, frameCount: NaN, sourceImageBuffer })).rejects.toThrow('frame count')
    await expect(createActionAnimatorArtifactsFromImageStrip({ ...opts, fps: 0, sourceImageBuffer })).rejects.toThrow('FPS')
  })
})
