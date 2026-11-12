export const textureDefaults = Object.freeze({
  factor: 2,
  direction: 'all',
  preservation: 'preserve',
  technique: 'creative',
  variants: 1,
})
export function textureSettings(value = {}) {
  const choices = {
    factor: [1.5, 2, 4],
    direction: ['all', 'left', 'right', 'up', 'down'],
    preservation: ['preserve', 'blend'],
    technique: ['creative', 'faithful'],
    variants: [1, 2, 3, 4],
  }
  return Object.fromEntries(
    Object.entries(choices).map(([key, allowed]) => [
      key,
      allowed.includes(value[key]) ? value[key] : textureDefaults[key],
    ]),
  )
}
export function validateTextureRequest(input) {
  if (!input || typeof input !== 'object')
    throw new Error('Texture expansion is required.')
  const settings = textureSettings(input)
  for (const key of Object.keys(settings))
    if (input[key] !== undefined && input[key] !== settings[key])
      throw new Error(`Invalid texture ${key}.`)
  const targetSize = input.targetSize ?? 1024
  if (![512, 1024].includes(targetSize))
    throw new Error('Texture export size must be 512 or 1024.')
  if (
    input.seamlessMode !== undefined &&
    typeof input.seamlessMode !== 'boolean'
  )
    throw new Error('Seamless must be a boolean.')
  const operation = input.operation ?? 'expand'
  if (!['expand', 'region', 'finish'].includes(operation))
    throw new Error('Invalid texture operation.')
  const stage = input.stage ?? 1
  if (![1, 2].includes(stage) || (stage === 2 && settings.factor !== 4))
    throw new Error('Invalid expansion stage.')
  for (const key of ['sourceWidth', 'sourceHeight'])
    if (
      input[key] !== undefined &&
      (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 32768)
    )
      throw new Error(`Invalid ${key}.`)
  if (operation === 'region') {
    const r = input.region
    if (
      !r ||
      !['x', 'y', 'width', 'height'].every((k) => Number.isInteger(r[k])) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width < 1 ||
      r.height < 1 ||
      r.x + r.width > targetSize ||
      r.y + r.height > targetSize
    )
      throw new Error('Select a valid edit rectangle.')
  }
  if (
    input.seed !== undefined &&
    (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4294967295)
  )
    throw new Error('Invalid synthesis seed.')
  return {
    ...settings,
    targetSize,
    seamlessMode: input.seamlessMode ?? false,
    operation,
    stage,
    seed: input.seed ?? 1,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    region: operation === 'region' ? input.region : undefined,
  }
}
export function textureGeometry(width, height, options) {
  const n = options.targetSize
  const longest = Math.round(n / options.factor)
  const w = Math.max(1, Math.round((width / Math.max(width, height)) * longest))
  const h = Math.max(
    1,
    Math.round((height / Math.max(width, height)) * longest),
  )
  const seamBand = Math.max(16, Math.min(64, Math.round(n * 0.04)))
  const margin = options.seamlessMode ? seamBand : 0
  let x = Math.floor((n - w) / 2),
    y = Math.floor((n - h) / 2)
  if (options.direction === 'left') x = n - w - margin
  if (options.direction === 'right') x = margin
  if (options.direction === 'up') y = n - h - margin
  if (options.direction === 'down') y = margin
  const band =
    options.preservation === 'blend'
      ? Math.min(
          Math.floor(Math.min(w, h) / 2),
          Math.max(4, Math.min(32, Math.round(Math.min(w, h) * 0.04))),
        )
      : 0
  return { x, y, width: w, height: h, band, seamBand }
}
export function textureCallCount(options) {
  return options.technique === 'faithful'
    ? 0
    : options.variants *
        ((options.factor === 4 ? 2 : 1) + (options.seamlessMode ? 1 : 0))
}
