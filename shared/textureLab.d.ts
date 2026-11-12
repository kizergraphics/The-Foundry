export type TextureSettings = {
  factor: 1.5 | 2 | 4
  direction: 'all' | 'left' | 'right' | 'up' | 'down'
  preservation: 'preserve' | 'blend'
  technique: 'creative' | 'faithful'
  variants: 1 | 2 | 3 | 4
}
export type TextureRect = {
  x: number
  y: number
  width: number
  height: number
}
export type TextureOptions = TextureSettings & {
  targetSize: 512 | 1024
  seamlessMode: boolean
  operation: 'expand' | 'region' | 'finish'
  stage: 1 | 2
  seed: number
  sourceWidth?: number
  sourceHeight?: number
  region?: TextureRect
}
export type TextureMetadata = {
  options: TextureOptions
  sourceRect: TextureRect & { band: number; seamBand: number }
  generationSize: number
  exportSize: number
  status: 'expanded' | 'finished' | 'unfinished' | 'intermediate'
  maskMode: string
  usage?: { model: string; tokenCount: number | null } | null
  elapsedMs: number
}
export const textureDefaults: Readonly<TextureSettings>
export function textureSettings(
  value?: Partial<TextureSettings>,
): TextureSettings
export function validateTextureRequest(value: unknown): TextureOptions
export function textureGeometry(
  width: number,
  height: number,
  options: Pick<
    TextureOptions,
    'targetSize' | 'factor' | 'direction' | 'preservation' | 'seamlessMode'
  >,
): TextureMetadata['sourceRect']
export function textureCallCount(
  options: TextureSettings & { seamlessMode: boolean },
): number
