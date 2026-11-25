export type MapName = 'albedo' | 'normal' | 'height' | 'roughness' | 'metallic' | 'ao'
export const MAP_NAMES: MapName[] = ['albedo', 'normal', 'height', 'roughness', 'metallic', 'ao']
export interface PbrSettings {
  resolution: number; brightness: number; saturation: number; heightContrast: number
  invertHeight: boolean; normalStrength: number; normalConvention: 'OpenGL' | 'DirectX'
  roughness: number; roughnessDetail: number; metallic: number; aoStrength: number
}
export const DEFAULT_PBR_SETTINGS: PbrSettings = {
  resolution: 512, brightness: 1, saturation: 1, heightContrast: 1, invertHeight: false,
  normalStrength: 3, normalConvention: 'OpenGL', roughness: .65, roughnessDetail: .25, metallic: 0, aoStrength: .6,
}
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export type MaterialMaps = Record<MapName, Pixels>
const clamp = (n: number) => Math.min(1, Math.max(0, n))
const gray = (data: Uint8ClampedArray, i: number, v: number) => {
  data[i] = data[i + 1] = data[i + 2] = Math.round(clamp(v) * 255); data[i + 3] = 255
}
export function materialDimensions(width: number, height: number, limit: number) {
  if (![width, height, limit].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid image dimensions')
  const scale = Math.min(1, Math.min(2048, limit) / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
/** Deterministic artistic estimates, NOT physically recovered material properties. */
export async function deriveMaterial(input: Pixels, settings: PbrSettings, replacements: Partial<MaterialMaps> = {}, signal?: AbortSignal): Promise<MaterialMaps> {
  const { width: w, height: h } = input
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 2048 || h > 2048 || input.data.length !== w * h * 4) throw new Error('Material input must be valid RGBA at most 2048 pixels per side')
  for (const replacement of Object.values(replacements)) if (replacement && (replacement.width !== w || replacement.height !== h || replacement.data.length !== w * h * 4)) throw new Error('Replacement map dimensions must match')
  const maps = Object.fromEntries(MAP_NAMES.map(name => [name, { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }])) as MaterialMaps
  const heights = new Float32Array(w * h)
  const pause = async (row: number) => { if (row % 32 === 0) { signal?.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted() } }
  for (let y = 0; y < h; y++) {
    await pause(y)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4
      const luminance = (input.data[i] * .2126 + input.data[i + 1] * .7152 + input.data[i + 2] * .0722) / 255
      for (let c = 0; c < 3; c++) maps.albedo.data[i + c] = Math.round(clamp((luminance + (input.data[i + c] / 255 - luminance) * settings.saturation) * settings.brightness) * 255)
      maps.albedo.data[i + 3] = input.data[i + 3]
      let height = clamp((luminance - .5) * settings.heightContrast + .5)
      if (settings.invertHeight) height = 1 - height
      if (replacements.height) height = replacements.height.data[i] / 255
      heights[p] = height
      gray(maps.height.data, i, height)
    }
  }
  const sample = (x: number, y: number) => heights[((y + h) % h) * w + ((x + w) % w)]
  for (let y = 0; y < h; y++) {
    await pause(y)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, height = sample(x, y)
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * settings.normalStrength
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * settings.normalStrength
      const length = Math.hypot(dx, dy, 1)
      maps.normal.data[i] = Math.round((-dx / length * .5 + .5) * 255)
      maps.normal.data[i + 1] = Math.round((dy / length * (settings.normalConvention === 'DirectX' ? -.5 : .5) + .5) * 255)
      maps.normal.data[i + 2] = Math.round((1 / length * .5 + .5) * 255); maps.normal.data[i + 3] = 255
      gray(maps.roughness.data, i, settings.roughness + (.5 - height) * settings.roughnessDetail)
      gray(maps.metallic.data, i, settings.metallic)
      const average = (sample(x - 1, y) + sample(x + 1, y) + sample(x, y - 1) + sample(x, y + 1)) / 4
      gray(maps.ao.data, i, 1 - Math.max(0, average - height) * settings.aoStrength * 4)
    }
  }
  signal?.throwIfAborted()
  return { ...maps, ...replacements }
}
export function packMaterial(maps: MaterialMaps, format: 'orm' | 'unity-mask' | 'unity-metallic'): Pixels {
  const { width, height } = maps.albedo
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = format === 'orm' ? maps.ao.data[i] : maps.metallic.data[i]
    data[i + 1] = format === 'orm' ? maps.roughness.data[i] : format === 'unity-mask' ? maps.ao.data[i] : 0
    data[i + 2] = format === 'orm' ? maps.metallic.data[i] : format === 'unity-mask' ? 255 : 0
    data[i + 3] = format === 'orm' ? 255 : 255 - maps.roughness.data[i]
  }
  return { width, height, data }
}
export function pixelsCanvas(pixels: Pixels) {
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable')
  const data = context.createImageData(pixels.width, pixels.height); data.data.set(pixels.data); context.putImageData(data, 0, 0)
  return canvas
}
export async function pixelsPng(pixels: Pixels): Promise<Blob> {
  return new Promise((resolve, reject) => pixelsCanvas(pixels).toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
}
export async function loadMaterialImage(source: string, limit: number, dimensions?: { width: number; height: number }): Promise<Pixels> {
  const image = new Image(); image.crossOrigin = 'anonymous'; image.src = source
  await image.decode()
  const { width, height } = dimensions ?? materialDimensions(image.naturalWidth, image.naturalHeight, limit)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, width, height)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}
