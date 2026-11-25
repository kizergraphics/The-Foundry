export function smoothFalloff(distance, width) {
  const t = Math.min(1, distance / width)
  return 1 - t * t * (3 - 2 * t)
}

export function matchTextureEdges(pixels, size, width) {
  // Rows and columns use the same pairing, so the two passes also match all four corners.
  for (const stride of [1, size]) {
    const lineStride = stride === 1 ? size : 1
    for (let distance = 0; distance < width; distance++) {
      const weight = smoothFalloff(distance, width) / 2
      for (let line = 0; line < size; line++) {
        const first = (line * lineStride + distance * stride) * 4
        const last = (line * lineStride + (size - 1 - distance) * stride) * 4
        for (let channel = 0; channel < 4; channel++) {
          const a = pixels[first + channel]
          const b = pixels[last + channel]
          pixels[first + channel] = Math.round(a + (b - a) * weight)
          pixels[last + channel] = Math.round(b + (a - b) * weight)
        }
      }
    }
  }
}

function measureSourceEdge(pixels, size, start, length, along, inward, inside, outside, width) {
  if (!outside) return null
  const prefix = new Float32Array((length + 1) * 3)
  const depth = Math.max(1, Math.round(width / 4))
  const innerDepth = Math.min(depth, inside)
  const outerDepth = Math.min(depth, outside)
  for (let line = 0; line < length; line++) {
    const pixel = start + line * along
    for (let channel = 0; channel < 3; channel++) {
      let inner = 0
      let outer = 0
      for (let d = 0; d < innerDepth; d++) inner += pixels[(pixel + d * inward) * 4 + channel]
      for (let d = 1; d <= outerDepth; d++) outer += pixels[(pixel - d * inward) * 4 + channel]
      prefix[(line + 1) * 3 + channel] = prefix[line * 3 + channel] + inner / innerDepth - outer / outerDepth
    }
  }
  const differences = new Float32Array(length * 3)
  for (let line = 0; line < length; line++) {
    const first = Math.max(0, line - depth)
    const end = Math.min(length, line + depth + 1)
    for (let channel = 0; channel < 3; channel++) {
      differences[line * 3 + channel] = (prefix[end * 3 + channel] - prefix[first * 3 + channel]) / (end - first)
    }
  }
  return differences
}

export function softenSourceJoin(pixels, size, rect, width) {
  const { x, y, width: sourceWidth, height: sourceHeight } = rect
  const right = x + sourceWidth - 1
  const bottom = y + sourceHeight - 1
  const leftEdge = measureSourceEdge(pixels, size, y * size + x, sourceHeight, size, 1, sourceWidth, x, width)
  const rightEdge = measureSourceEdge(pixels, size, y * size + right, sourceHeight, size, -1, sourceWidth, size - 1 - right, width)
  const topEdge = measureSourceEdge(pixels, size, y * size + x, sourceWidth, 1, size, sourceHeight, y, width)
  const bottomEdge = measureSourceEdge(pixels, size, bottom * size + x, sourceWidth, 1, -size, sourceHeight, size - 1 - bottom, width)

  // Match the local tone around the source while keeping its pixels and the generated grain.
  for (let row = Math.max(0, y - width); row <= Math.min(size - 1, bottom + width); row++) {
    const nearestY = Math.max(y, Math.min(bottom, row))
    const vertical = row < y ? topEdge : row > bottom ? bottomEdge : null
    for (let column = Math.max(0, x - width); column <= Math.min(size - 1, right + width); column++) {
      const nearestX = Math.max(x, Math.min(right, column))
      const horizontal = column < x ? leftEdge : column > right ? rightEdge : null
      if (!horizontal && !vertical) continue
      const dx = Math.abs(column - nearestX)
      const dy = Math.abs(row - nearestY)
      const weight = smoothFalloff(Math.hypot(dx, dy) - 1, width)
      for (let channel = 0; channel < 3; channel++) {
        const horizontalDelta = horizontal?.[(nearestY - y) * 3 + channel] ?? 0
        const verticalDelta = vertical?.[(nearestX - x) * 3 + channel] ?? 0
        // At a corner favor the closer face and meet both face corrections continuously.
        const delta = (horizontalDelta * dx + verticalDelta * dy) / (dx + dy)
        const offset = (row * size + column) * 4 + channel
        pixels[offset] = Math.max(0, Math.min(255, Math.round(pixels[offset] + delta * weight)))
      }
    }
  }
}
