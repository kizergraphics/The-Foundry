export const animatorCanvas = { width: 1536, height: 1024 }

export function getActionAnimatorLayout(frameCount) {
  if (!Number.isInteger(frameCount) || frameCount < 4 || frameCount > 30) {
    throw new Error('Animation frame count must be an integer from 4 to 30.')
  }
  const fixed = { 4: 2, 8: 4, 12: 4, 16: 4, 24: 6 }
  let columns = fixed[frameCount]
  if (!columns) {
    let best = Infinity
    for (let candidate = 2; candidate <= 6; candidate += 1) {
      const rows = Math.ceil(frameCount / candidate)
      const nativeAspect = (animatorCanvas.width * rows) / (animatorCanvas.height * candidate)
      const score = Math.abs(Math.log(nativeAspect)) + (candidate * rows - frameCount) * 0.12
      if (score < best) { columns = candidate; best = score }
    }
  }
  const rows = Math.ceil(frameCount / columns)
  return { columns, rows, unusedCells: columns * rows - frameCount }
}

export function describeActionAnimatorGrid(frameCount) {
  const { columns, rows, unusedCells } = getActionAnimatorLayout(frameCount)
  return [
    `Return one 3:2 landscape image: exactly ${columns} columns by ${rows} rows of equal-sized rectangular cells covering the whole canvas. Place ${frameCount} poses in reading order (left to right, then top to bottom).`,
    'Keep a generous empty chroma margin around every pose, including at the cell boundaries. Repeat the same viewpoint, size and ground line in each cell.',
    'No grid lines, labels, borders, text, dividers or separate margins around the whole grid.',
    unusedCells ? `Leave the last ${unusedCells} cell(s) empty with only the same chroma background.` : '',
  ].filter(Boolean).join(' ')
}
