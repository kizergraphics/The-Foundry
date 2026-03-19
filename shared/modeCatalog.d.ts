export const allForgeModes: readonly [
  'armory',
  'action-animator',
  'variant-forge',
  'portrait-studio',
  'texture-lab',
  'uv-lab',
  'vfx-forge',
  'visualizer',
  'character-sheet',
]

export type ForgeMode = (typeof allForgeModes)[number]
export type ModeExecutionKind = 'forge-api' | 'special-api' | 'local-workflow'

export const forgeApiModes: readonly ForgeMode[]
export const specialApiModes: readonly ForgeMode[]
export const localWorkflowModes: readonly ForgeMode[]

export const modeExecutionKindByMode: Readonly<Record<ForgeMode, ModeExecutionKind>>

export function isForgeMode(value: unknown): value is ForgeMode
export function getModeExecutionKind(mode: unknown): ModeExecutionKind | null
export function isForgeApiMode(mode: unknown): mode is ForgeMode
export function isSpecialApiMode(mode: unknown): mode is ForgeMode
export function isLocalWorkflowMode(mode: unknown): mode is ForgeMode
