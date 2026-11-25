import sharp from 'sharp'
import { animatorCanvas, getActionAnimatorLayout } from '../shared/actionAnimatorLayout.js'

const transparent = '#00000000'
const keyColors = { blue: [0, 0, 255], green: [0, 255, 0] }

export async function despillActionAnimatorFrame(pngBuffer, keyColor) {
  const { data, info: { width, height } } = await sharp(pngBuffer)
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const key = keyColor === 'blue' ? 2 : 1
  const other = key === 1 ? 2 : 1
  const radius = 4
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = 4 * (y * width + x)
      const alpha = data[pixel + 3]
      if (!alpha) continue
      const neutral = Math.max(data[pixel], data[pixel + other])
      const excess = data[pixel + key] - neutral
      if (excess < 16) continue
      let nearTransparency = alpha < 240 || x < radius || y < radius || width - 1 - x < radius || height - 1 - y < radius
      for (let dy = -radius; !nearTransparency && dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy <= radius * radius && data[4 * ((y + dy) * width + x + dx) + 3] < 160) {
            nearTransparency = true
            break
          }
        }
      }
      if (nearTransparency) data[pixel + key] = neutral
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

function layoutError(message) {
  const error = new Error(message)
  error.status = 422
  error.code = 'animation_grid_invalid'
  return error
}

function measureCell(source, info, cell, key, index, used) {
  const { width, height, left, top } = cell
  const rgba = Buffer.alloc(width * height * 4)
  const bounds = { left: width, top: height, right: -1, bottom: -1 }
  let solid = 0
  let border = 0
  // Remove a narrow range of chroma tones and feather the transition. The key
  // must not be a costume color; true source transparency is also respected.
  const pad = Math.max(1, Math.floor(Math.min(width, height) * 0.012))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((top + y) * info.width + left + x) * 4
      const dst = (y * width + x) * 4
      const distance = Math.max(Math.abs(source[src] - key[0]), Math.abs(source[src + 1] - key[1]), Math.abs(source[src + 2] - key[2]))
      const alpha = Math.round(source[src + 3] * Math.max(0, Math.min(1, (distance - 35) / 30)))
      if (!alpha) continue
      rgba[dst] = source[src]
      rgba[dst + 1] = source[src + 1]
      rgba[dst + 2] = source[src + 2]
      rgba[dst + 3] = alpha
      if (alpha >= 128) {
        solid += 1
        if (x < pad || y < pad || x >= width - pad || y >= height - pad) border += 1
      }
      if (alpha >= 16) {
        bounds.left = Math.min(bounds.left, x)
        bounds.right = Math.max(bounds.right, x)
        bounds.top = Math.min(bounds.top, y)
        bounds.bottom = Math.max(bounds.bottom, y)
      }
    }
  }
  if (!used) {
    if (solid > Math.max(6, width * height * 0.001)) throw layoutError(`Unexpected foreground in reserved blank cell ${index + 1}.`)
    return null
  }
  const fraction = solid / (width * height)
  if (fraction < 0.008) throw layoutError(`Animation frame ${index + 1} is empty or has only a fragment. Expected one full pose per cell.`)
  if (fraction > 0.89 || border > Math.max(2, (width + height) * 0.014)) {
    throw layoutError(`Animation frame ${index + 1} touches a cell boundary or has an invalid backdrop. Need a full pose within this cell's chroma margin.`)
  }
  return { rgba, bounds }
}

// Split the provider grid before any resizing. One crop/transform retains ground
// alignment, subtle pose changes and airborne motion across the whole sequence.
export async function createActionAnimatorArtifactsFromImageStrip({
  frameCount, frameSize, fps, keyColor, prompt, sourceImageBuffer, sourceModel,
}) {
  const { columns, rows } = getActionAnimatorLayout(frameCount)
  if (![512, 1080].includes(frameSize)) throw new Error('Unsupported animation frame size.')
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) throw new Error('Unsupported animation FPS.')
  const keyName = keyColor === 'blue' ? 'blue' : 'green'
  const key = keyColors[keyName]
  const { data, info } = await sharp(sourceImageBuffer, { limitInputPixels: 32 * 1024 * 1024 })
    .rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const ratio = info.width / info.height
  const expectedRatio = animatorCanvas.width / animatorCanvas.height
  const validLandscape = Math.abs(ratio / expectedRatio - 1) <= 0.09
  const squareFallback = columns === rows && Math.abs(ratio - 1) <= 0.06
  if ((!validLandscape && !squareFallback) || info.width / columns < 24 || info.height / rows < 24) {
    throw layoutError(`Provider returned ${info.width} × ${info.height}; expected a 3:2 landscape canvas${columns === rows ? ' or a square grid' : ''} for ${columns} × ${rows} poses with usable cell detail.`)
  }
  const cellWidth = Math.ceil(info.width / columns)
  const cellHeight = Math.ceil(info.height / rows)
  const union = { left: cellWidth, top: cellHeight, right: -1, bottom: -1 }
  const cells = []
  for (let index = 0; index < columns * rows; index += 1) {
    const col = index % columns, row = Math.floor(index / columns)
    const left = Math.round(col * info.width / columns)
    const top = Math.round(row * info.height / rows)
    const width = Math.round((col + 1) * info.width / columns) - left
    const height = Math.round((row + 1) * info.height / rows) - top
    const cell = measureCell(data, info, { width, height, left, top }, key, index, index < frameCount)
    if (!cell) continue
    cells.push({ ...cell, width, height })
    union.left = Math.min(union.left, cell.bounds.left)
    union.top = Math.min(union.top, cell.bounds.top)
    union.right = Math.max(union.right, cell.bounds.right)
    union.bottom = Math.max(union.bottom, cell.bounds.bottom)
  }
  const cropWidth = union.right - union.left + 1
  const cropHeight = union.bottom - union.top + 1
  const padding = Math.round(frameSize * 0.0625)
  const scale = Math.min((frameSize - 2 * padding) / cropWidth, (frameSize - 2 * padding) / cropHeight)
  const width = Math.max(1, Math.round(cropWidth * scale))
  const height = Math.max(1, Math.round(cropHeight * scale))
  const frames = []
  for (const cell of cells) {
    const extracted = await sharp(cell.rgba, { raw: { width: cell.width, height: cell.height, channels: 4 } })
      .extend({ right: cellWidth - cell.width, bottom: cellHeight - cell.height, background: transparent }).png().toBuffer()
    const normalized = await sharp(extracted).extract({ left: union.left, top: union.top, width: cropWidth, height: cropHeight })
      .resize(width, height).png().toBuffer()
    const framed = await sharp({ create: { width: frameSize, height: frameSize, channels: 4, background: transparent } })
      .composite([{ input: normalized, left: Math.round((frameSize - width) / 2), top: frameSize - padding - height }]).png().toBuffer()
    frames.push(await despillActionAnimatorFrame(framed, keyName))
  }
  const sheet = await sharp({ create: { width: frameSize * columns, height: frameSize * rows, channels: 4, background: transparent } })
    .composite(frames.map((input, index) => ({ input, left: index % columns * frameSize, top: Math.floor(index / columns) * frameSize }))).png().toBuffer()
  const metrics = frames.map((_, index) => ({
    file: `frames/frame-${String(index + 1).padStart(2, '0')}.png`,
    x: index % columns * frameSize,
    y: Math.floor(index / columns) * frameSize,
    width: frameSize, height: frameSize, timeSeconds: index / fps,
  }))
  return {
    frames: frames.map((buffer, index) => ({ data: buffer.toString('base64'), id: `action-animator-frame-${String(index + 1).padStart(2, '0')}`, mimeType: 'image/png', text: `Frame ${index + 1} of ${frameCount}.` })),
    metadata: { fps, frameCount, keyColor: keyName, normalizedSize: frameSize, pipeline: 'image-strip', prompt, sampleStrategy: 'strip', sourceModel, background: 'transparent', durationSeconds: frameCount / fps, atlas: { columns, rows, width: frameSize * columns, height: frameSize * rows, frames: metrics } },
    spriteSheet: { data: sheet.toString('base64'), id: 'action-animator-sprite-sheet', mimeType: 'image/png', text: `${frameCount} ordered transparent frames in a ${columns} × ${rows} atlas.` },
  }
}
