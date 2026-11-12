import sharp from 'sharp'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  validateTextureRequest,
  textureGeometry,
} from '../shared/textureLab.js'

const rawOptions = (size) => ({
  raw: { width: size, height: size, channels: 4 },
})
export async function decodeTexture(image) {
  if (!image?.data) throw new Error('A source image is required.')
  const input = Buffer.from(image.data, 'base64')
  const result = await sharp(input, { limitInputPixels: 32 * 1024 * 1024 })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
  }
}
export function wrapPixels(data, size, offset) {
  const out = Buffer.alloc(data.length)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = (x + offset + size) % size,
        sy = (y + offset + size) % size
      data.copy(
        out,
        (y * size + x) * 4,
        (sy * size + sx) * 4,
        (sy * size + sx) * 4 + 4,
      )
    }
  return out
}
export function blendPixels(base, generated, mask) {
  const out = Buffer.from(base)
  for (let i = 0; i < mask.length; i++)
    if (mask[i])
      for (let c = 0; c < 4; c++)
        out[i * 4 + c] = Math.round(
          base[i * 4 + c] +
            ((generated[i * 4 + c] - base[i * 4 + c]) * mask[i]) / 255,
        )
  return out
}
function put(base, size, source, w, h, x, y) {
  for (let j = 0; j < h; j++)
    source.copy(base, ((y + j) * size + x) * 4, j * w * 4, (j + 1) * w * 4)
}
function sourceProtection(mask, size, g) {
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const d = Math.min(x, y, g.width - 1 - x, g.height - 1 - y)
      const weight = g.band ? Math.max(0, 1 - d / g.band) : 0
      const i = (g.y + y) * size + g.x + x
      mask[i] = Math.min(mask[i], Math.round(weight * 255))
    }
}
export function stageViewport(n, g, direction) {
  const size = n / 2
  let x = Math.floor((n - size) / 2),
    y = x
  if (direction === 'right') x = 0
  if (direction === 'left') x = n - size
  if (direction === 'down') y = 0
  if (direction === 'up') y = n - size
  // Extreme aspect ratios remain entirely within the stage.
  x = Math.max(0, Math.min(x, g.x, n - size))
  y = Math.max(0, Math.min(y, g.y, n - size))
  return { x, y, size }
}
function runQuilt(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'textureQuiltWorker.js',
      ),
      { workerData: data },
    )
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Faithful synthesis timed out.'))
    }, 120000)
    worker.once('message', (message) => {
      clearTimeout(timer)
      void worker.terminate()
      message.error
        ? reject(new Error(message.error))
        : resolve(Buffer.from(message.data))
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error('Synthesis worker stopped.'))
    })
  })
}
export function texturePrompt(operation, notes = '') {
  return [
    operation === 'finish'
      ? 'Repair only the central crossing seams in this wrap-offset material. Continue structures across both seams and their intersection.'
      : operation === 'region'
        ? 'Invent plausible fresh material detail inside the selected edit area.'
        : 'Extend the source material into the surrounding canvas with varied plausible new detail.',
    'Maintain material identity, grain direction, lighting and feature scale. Neutral outside context is disposable. Do not stamp, mirror, repeat distinctive marks, or reconstruct the source as a full-frame image. Fill the frame with a top-down material sample.',
    notes,
  ]
    .filter(Boolean)
    .join(' ')
}
// One operation per request lets the client stop/retry between stages without repeating paid work.
export async function processTexture(
  input,
  { generate, maskSupported = false, notes = '' } = {},
) {
  const started = Date.now(),
    o = validateTextureRequest(input),
    n = o.targetSize
  const source = await decodeTexture(input.sourceImage)
  if (
    (o.sourceWidth && o.sourceWidth !== source.width) ||
    (o.sourceHeight && o.sourceHeight !== source.height)
  )
    throw new Error('Source dimensions do not match the decoded image.')
  o.sourceWidth = source.width
  o.sourceHeight = source.height
  const g = textureGeometry(source.width, source.height, o)
  const scaled = await sharp(source.data, {
    raw: { width: source.width, height: source.height, channels: 4 },
  })
    .resize(g.width, g.height, { fit: 'fill' })
    .raw()
    .toBuffer()
  const viewport = stageViewport(n, g, o.direction)
  const intermediate =
    o.operation === 'expand' && o.factor === 4 && o.stage === 1
  const size = intermediate ? viewport.size : n
  const local = {
    ...g,
    x: g.x - (intermediate ? viewport.x : 0),
    y: g.y - (intermediate ? viewport.y : 0),
  }
  let base
  if (o.operation !== 'expand' || o.stage === 2) {
    const previous = await decodeTexture(input.baseImage)
    const expected = o.operation === 'expand' ? viewport.size : n
    if (previous.width !== expected || previous.height !== expected)
      throw new Error('The previous operation returned unexpected dimensions.')
    if (o.operation === 'expand') {
      const stats = await sharp(scaled, {
        raw: { width: g.width, height: g.height, channels: 4 },
      }).stats()
      base = Buffer.alloc(n * n * 4)
      for (let i = 0; i < n * n; i++)
        for (let c = 0; c < 4; c++)
          base[i * 4 + c] = c === 3 ? 255 : Math.round(stats.channels[c].mean)
      put(base, n, previous.data, expected, expected, viewport.x, viewport.y)
    } else base = previous.data
  } else {
    const stats = await sharp(scaled, {
      raw: { width: g.width, height: g.height, channels: 4 },
    }).stats()
    base = Buffer.alloc(size * size * 4)
    for (let i = 0; i < size * size; i++)
      for (let c = 0; c < 4; c++)
        base[i * 4 + c] = c === 3 ? 255 : Math.round(stats.channels[c].mean)
  }
  if (o.operation === 'expand')
    put(base, size, scaled, g.width, g.height, local.x, local.y)
  let mask = new Uint8Array(size * size).fill(255)
  if (o.operation === 'expand' && o.stage === 2) {
    const b = Math.max(4, Math.min(32, Math.round(viewport.size * 0.04)))
    for (let y = 0; y < viewport.size; y++)
      for (let x = 0; x < viewport.size; x++)
        mask[(viewport.y + y) * n + viewport.x + x] = Math.round(
          255 *
            Math.max(
              0,
              1 -
                Math.min(x, y, viewport.size - 1 - x, viewport.size - 1 - y) /
                  b,
            ),
        )
  }
  if (o.operation === 'region') {
    mask.fill(0)
    const r = o.region,
      b = Math.max(
        1,
        Math.min(16, Math.round(Math.min(r.width, r.height) * 0.04)),
      )
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++)
        mask[y * n + x] = Math.round(
          255 *
            Math.min(
              1,
              (1 +
                Math.min(
                  x - r.x,
                  y - r.y,
                  r.x + r.width - 1 - x,
                  r.y + r.height - 1 - y,
                )) /
                b,
            ),
        )
  }
  if (o.operation === 'finish') {
    mask.fill(0)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (
          x < g.seamBand / 2 ||
          x >= n - g.seamBand / 2 ||
          y < g.seamBand / 2 ||
          y >= n - g.seamBand / 2
        )
          mask[y * n + x] = 255
  }
  sourceProtection(mask, size, local)
  if (!mask.some((v) => v > 0))
    throw new Error(
      'The selection contains no editable pixels. The original source is protected.',
    )
  if (o.operation === 'finish') {
    base = wrapPixels(base, n, n / 2)
    const rgba = Buffer.alloc(n * n * 4)
    for (let i = 0; i < mask.length; i++) rgba.fill(mask[i], i * 4, i * 4 + 4)
    const wrapped = wrapPixels(rgba, n, n / 2)
    mask = Uint8Array.from(mask, (_, i) => wrapped[i * 4])
  }
  let generated,
    generationSize = size,
    usage = null
  if (o.technique === 'faithful') {
    generated = await runQuilt({
      source: scaled,
      sw: g.width,
      sh: g.height,
      size,
      seed: o.seed,
      initial: base,
      mask,
    })
  } else {
    if (!generate) throw new Error('No creative image provider is available.')
    generationSize = 1024
    const canvas = await sharp(base, rawOptions(size))
      .resize(generationSize, generationSize)
      .png()
      .toBuffer()
    const maskRgba = Buffer.alloc(size * size * 4, 255)
    for (let i = 0; i < mask.length; i++)
      maskRgba[i * 4 + 3] = mask[i] > 0 ? 0 : 255
    const providerMask = await sharp(maskRgba, rawOptions(size))
      .resize(generationSize, generationSize, { kernel: 'nearest' })
      .png()
      .toBuffer()
    const image = await generate({
      canvas,
      mask: maskSupported ? providerMask : undefined,
      size: generationSize,
      prompt: texturePrompt(
        o.operation,
        [
          notes,
          o.region
            ? `Edit rectangle in the ${generationSize} square reference: x=${Math.round((o.region.x / n) * generationSize)}, y=${Math.round((o.region.y / n) * generationSize)}, width=${Math.round((o.region.width / n) * generationSize)}, height=${Math.round((o.region.height / n) * generationSize)}.`
            : '',
        ].join(' '),
      ),
    })
    usage = image.usage ?? null
    const decoded = await decodeTexture(image)
    if (decoded.width !== generationSize || decoded.height !== generationSize)
      throw new Error(
        `Provider returned ${decoded.width}×${decoded.height}; expected ${generationSize}×${generationSize}.`,
      )
    generated = await sharp(decoded.data, rawOptions(generationSize))
      .resize(size, size)
      .raw()
      .toBuffer()
  }
  let output = blendPixels(base, generated, mask)
  if (o.operation === 'finish') output = wrapPixels(output, n, n / 2)
  const png = await sharp(output, rawOptions(size)).png().toBuffer()
  return {
    id: `texture-${randomUUID()}`,
    data: png.toString('base64'),
    mimeType: 'image/png',
    texture: {
      options: o,
      sourceRect: g,
      generationSize,
      exportSize: size,
      status: intermediate
        ? 'intermediate'
        : o.operation === 'finish'
          ? 'finished'
          : o.seamlessMode
            ? 'unfinished'
            : 'expanded',
      maskMode:
        o.technique === 'faithful'
          ? 'local quilting'
          : maskSupported
            ? 'native mask + protected composite'
            : 'reference guidance + protected composite',
      usage,
      elapsedMs: Date.now() - started,
    },
  }
}
