export const unityPipelines: readonly ['urp']
export const vfxExportTargets: readonly ['none', 'particle-system', 'vfx-graph']
export const vfxTextureKinds: readonly ['dissolve-mask', 'flipbook', 'swirl', 'noise']
export const vfxPreviewStrategies: readonly ['flipbook-strip', 'texture-set']

export const defaultVfxEffectLabel: 'Custom Effect'
export const defaultVfxExportTarget: 'none'
export const defaultVfxFrameCount: 8
export const defaultVfxIntensity: 60
export const defaultVfxLooping: true
export const defaultVfxTextureOutputs: readonly ['flipbook']

export type UnityPipeline = (typeof unityPipelines)[number]
export type VfxExportTarget = (typeof vfxExportTargets)[number]
export type UnitySolution = Exclude<VfxExportTarget, 'none'>
export type VfxTextureKind = (typeof vfxTextureKinds)[number]
export type VfxPreviewStrategy = (typeof vfxPreviewStrategies)[number]

export type VfxGraphExposedProperty = {
  defaultValue?: number | string
  fileName?: string
  name: string
  type: 'Texture2D' | 'float'
}

export type VfxParticleSystemConfig = {
  blendMode: 'additive'
  bursts: ReadonlyArray<{
    count: number
    time: number
  }>
  colorOverLife: ReadonlyArray<{
    color: string
    time: number
  }>
  emission: {
    rateOverDistance: number
    rateOverTime: number
  }
  frameCount: number
  intensity: number
  lifetime: {
    max: number
    min: number
  }
  looping: boolean
  rendererMode: 'billboard' | 'stretched-billboard'
  size: {
    max: number
    min: number
  }
  velocity: {
    direction: readonly [number, number, number]
    space: 'local'
    speedMax: number
    speedMin: number
  }
}

export type VfxGraphConfig = {
  exposedProperties: ReadonlyArray<VfxGraphExposedProperty>
  frameCount: number
  intensity: number
  looping: boolean
  template: 'urp_vfx_generic'
}

export type VfxMaterialConfig = {
  blendMode: 'additive'
  materialKey: 'urp_particles_unlit_generic'
  shader: 'Universal Render Pipeline/Particles/Unlit'
  textureBindings: ReadonlyArray<{
    fileName: string
    kind: VfxTextureKind
    slot: string
  }>
}

export type VfxRecipeTextureEntry = {
  fileName: string
  kind: VfxTextureKind
  materialSlots: string[]
  mimeType: string
  previewFileName: string
}

export type VfxRecipeManifest = {
  displayName: string
  effectLabel: string
  exportTarget: UnitySolution
  frameCount: number
  importNotes: string[]
  intensity: number
  materialConfig: VfxMaterialConfig
  particleSystemConfig: VfxParticleSystemConfig
  previewStrategy: VfxPreviewStrategy
  prompt: string
  recipeKind: 'generic'
  recipeVersion: '1.0.0'
  textures: VfxRecipeTextureEntry[]
  unityPipeline: UnityPipeline
  vfxGraphConfig: VfxGraphConfig
  looping: boolean
}

export function isUnityPipeline(value: unknown): value is UnityPipeline
export function isVfxExportTarget(value: unknown): value is VfxExportTarget
export function isUnitySolution(value: unknown): value is UnitySolution
export function isVfxTextureKind(value: unknown): value is VfxTextureKind
export function isVfxPreviewStrategy(value: unknown): value is VfxPreviewStrategy
export function getVfxTextureLabel(kind: unknown): string
export function getVfxExportTargetLabel(target: unknown): string
export function formatVfxForgeLabel(value: string): string
export function resolveVfxEffectLabel(value: unknown): string
export function getDefaultVfxTextureOutputs(): VfxTextureKind[]
export function resolveVfxPreviewStrategy(textureOutputs: unknown): VfxPreviewStrategy
