import { parentPort, workerData } from 'node:worker_threads'
// Dynamic-programming minimum error seam through an overlap rectangle.
export function minimumCut(cost, width, height) {
  const sums = Float64Array.from(cost),
    back = new Int32Array(width * height)
  for (let y = 1; y < height; y++)
    for (let x = 0; x < width; x++) {
      let best = x
      for (let k = Math.max(0, x - 1); k <= Math.min(width - 1, x + 1); k++)
        if (sums[(y - 1) * width + k] < sums[(y - 1) * width + best]) best = k
      sums[y * width + x] += sums[(y - 1) * width + best]
      back[y * width + x] = best
    }
  const cut = new Int32Array(height)
  let x = 0
  for (let k = 1; k < width; k++)
    if (sums[(height - 1) * width + k] < sums[(height - 1) * width + x]) x = k
  for (let y = height - 1; y >= 0; y--) {
    cut[y] = x
    x = back[y * width + x]
  }
  return cut
}
export function quilt({ source, sw, sh, size, seed = 1, initial, mask }) {
  const out = initial
    ? Uint8Array.from(initial)
    : new Uint8Array(size * size * 4)
  const known = new Uint8Array(size * size)
  if (initial && mask)
    for (let i = 0; i < known.length; i++) known[i] = mask[i] === 0 ? 1 : 0
  const patch = Math.max(
    1,
    Math.min(64, sw, sh, Math.round(Math.min(sw, sh) / 8)),
  )
  const overlap = Math.min(patch - 1, Math.max(1, Math.round(patch / 4))),
    step = patch - overlap
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
  const error = (oi, si) => {
    let e = 0
    for (let c = 0; c < 3; c++) e += (out[oi + c] - source[si + c]) ** 2
    return e
  }
  for (let y = 0; y < size; y += step)
    for (let x = 0; x < size; x += step) {
      const w = Math.min(patch, size - x),
        h = Math.min(patch, size - y)
      let bx = 0,
        by = 0,
        best = Infinity
      for (let candidate = 0; candidate < 24; candidate++) {
        const sx = Math.floor(random() * (sw - patch + 1)),
          sy = Math.floor(random() * (sh - patch + 1))
        let score = 0
        for (let j = 0; j < h; j += 2)
          for (let i = 0; i < w; i += 2)
            if (known[(y + j) * size + x + i])
              score += error(
                ((y + j) * size + x + i) * 4,
                ((sy + j) * sw + sx + i) * 4,
              )
        if (score < best) {
          best = score
          bx = sx
          by = sy
        }
      }
      const ow = Math.min(overlap, w),
        oh = Math.min(overlap, h)
      const vertical = new Float64Array(ow * h),
        horizontal = new Float64Array(oh * w)
      for (let j = 0; j < h; j++)
        for (let i = 0; i < ow; i++)
          vertical[j * ow + i] = error(
            ((y + j) * size + x + i) * 4,
            ((by + j) * sw + bx + i) * 4,
          )
      for (let i = 0; i < w; i++)
        for (let j = 0; j < oh; j++)
          horizontal[i * oh + j] = error(
            ((y + j) * size + x + i) * 4,
            ((by + j) * sw + bx + i) * 4,
          )
      const vc = ow ? minimumCut(vertical, ow, h) : new Int32Array(h),
        hc = oh ? minimumCut(horizontal, oh, w) : new Int32Array(w)
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const pixel = (y + j) * size + x + i,
            oi = pixel * 4,
            si = ((by + j) * sw + bx + i) * 4
          if (mask && mask[pixel] === 0) continue
          if (
            known[pixel] &&
            ((x > 0 && i < ow && i < vc[j]) || (y > 0 && j < oh && j < hc[i]))
          )
            continue
          for (let c = 0; c < 4; c++) out[oi + c] = source[si + c]
          known[pixel] = 1
        }
    }
  return out
}
if (parentPort) {
  try {
    parentPort.postMessage({ data: quilt(workerData) })
  } catch (error) {
    parentPort.postMessage({ error: error.message })
  }
}
