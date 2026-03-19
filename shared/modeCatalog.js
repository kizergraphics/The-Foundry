const allForgeModes = Object.freeze([
  'armory',
  'action-animator',
  'variant-forge',
  'portrait-studio',
  'texture-lab',
  'uv-lab',
  'vfx-forge',
  'visualizer',
  'character-sheet',
])

const forgeApiModes = Object.freeze([
  'armory',
  'portrait-studio',
  'texture-lab',
  'variant-forge',
  'vfx-forge',
  'visualizer',
])

const specialApiModes = Object.freeze([
  'action-animator',
  'character-sheet',
])

const localWorkflowModes = Object.freeze([
  'uv-lab',
])

const modeExecutionKindByMode = Object.freeze({
  armory: 'forge-api',
  'action-animator': 'special-api',
  'character-sheet': 'special-api',
  'portrait-studio': 'forge-api',
  'texture-lab': 'forge-api',
  'uv-lab': 'local-workflow',
  'variant-forge': 'forge-api',
  'vfx-forge': 'forge-api',
  visualizer: 'forge-api',
})

function isForgeMode(value) {
  return typeof value === 'string' && allForgeModes.includes(value)
}

function getModeExecutionKind(mode) {
  return isForgeMode(mode) ? modeExecutionKindByMode[mode] : null
}

function isForgeApiMode(mode) {
  return isForgeMode(mode) && modeExecutionKindByMode[mode] === 'forge-api'
}

function isSpecialApiMode(mode) {
  return isForgeMode(mode) && modeExecutionKindByMode[mode] === 'special-api'
}

function isLocalWorkflowMode(mode) {
  return isForgeMode(mode) && modeExecutionKindByMode[mode] === 'local-workflow'
}

export {
  allForgeModes,
  forgeApiModes,
  getModeExecutionKind,
  isForgeApiMode,
  isForgeMode,
  isLocalWorkflowMode,
  isSpecialApiMode,
  localWorkflowModes,
  modeExecutionKindByMode,
  specialApiModes,
}
