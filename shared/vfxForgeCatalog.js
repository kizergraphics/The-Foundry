const unityPipelines = Object.freeze(['urp'])
const vfxExportTargets = Object.freeze(['none', 'particle-system', 'vfx-graph'])
const vfxTextureKinds = Object.freeze(['dissolve-mask', 'flipbook', 'swirl', 'noise'])
const vfxPreviewStrategies = Object.freeze(['flipbook-strip', 'texture-set'])

const defaultVfxEffectLabel = 'Custom Effect'
const defaultVfxExportTarget = 'none'
const defaultVfxFrameCount = 8
const defaultVfxIntensity = 60
const defaultVfxLooping = true
const defaultVfxTextureOutputs = Object.freeze(['flipbook'])

function isUnityPipeline(value) {
  return typeof value === 'string' && unityPipelines.includes(value)
}

function isVfxExportTarget(value) {
  return typeof value === 'string' && vfxExportTargets.includes(value)
}

function isUnitySolution(value) {
  return value === 'particle-system' || value === 'vfx-graph'
}

function isVfxTextureKind(value) {
  return typeof value === 'string' && vfxTextureKinds.includes(value)
}

function isVfxPreviewStrategy(value) {
  return typeof value === 'string' && vfxPreviewStrategies.includes(value)
}

function getVfxTextureLabel(kind) {
  switch (kind) {
    case 'dissolve-mask':
      return 'Dissolve Mask'
    case 'flipbook':
      return 'Flipbook'
    case 'swirl':
      return 'Swirl'
    case 'noise':
      return 'Noise'
    default:
      return 'Texture'
  }
}

function getVfxExportTargetLabel(target) {
  switch (target) {
    case 'particle-system':
      return 'Particle System'
    case 'vfx-graph':
      return 'VFX Graph'
    default:
      return 'None'
  }
}

function formatVfxForgeLabel(value) {
  return String(value)
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function resolveVfxEffectLabel(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : defaultVfxEffectLabel
}

function getDefaultVfxTextureOutputs() {
  return [...defaultVfxTextureOutputs]
}

function resolveVfxPreviewStrategy(textureOutputs) {
  return Array.isArray(textureOutputs) && textureOutputs.includes('flipbook')
    ? 'flipbook-strip'
    : 'texture-set'
}

export {
  defaultVfxEffectLabel,
  defaultVfxExportTarget,
  defaultVfxFrameCount,
  defaultVfxIntensity,
  defaultVfxLooping,
  defaultVfxTextureOutputs,
  formatVfxForgeLabel,
  getDefaultVfxTextureOutputs,
  getVfxExportTargetLabel,
  getVfxTextureLabel,
  isUnityPipeline,
  isUnitySolution,
  isVfxExportTarget,
  isVfxPreviewStrategy,
  isVfxTextureKind,
  resolveVfxEffectLabel,
  resolveVfxPreviewStrategy,
  unityPipelines,
  vfxExportTargets,
  vfxPreviewStrategies,
  vfxTextureKinds,
}
