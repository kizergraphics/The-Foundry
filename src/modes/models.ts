import type { ActionAnimatorPipeline } from '../lib/forge'
import type { ForgeMode } from '../../shared/modeCatalog.js'

export const MODEL_LABELS = {
  'browser-uv-engine': 'Built-in UV Engine',
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
  'gemini-3-flash': 'Gemini 3.1 Flash',
  'gemini-3-pro': 'Gemini 3 Pro Image',
  'veo-3.1-fast': 'Veo 3 Fast Generate',
} as const

export type ModelId = keyof typeof MODEL_LABELS

export const TELEMETRY_ROW_BY_MODEL_ID: Record<ModelId, string> = {
  'browser-uv-engine': 'browser-uv-engine',
  'gemini-2.5-flash-image': 'nano-banana',
  'gemini-3-flash': 'nano-banana-2',
  'gemini-3-pro': 'nano-banana-pro',
  'veo-3.1-fast': 'veo-3-fast-generate',
}

const smartDefaultModelByMode: Record<ForgeMode, ModelId> = {
  armory: 'gemini-3-flash',
  'action-animator': 'gemini-3-pro',
  'character-sheet': 'gemini-3-pro',
  'portrait-studio': 'gemini-3-pro',
  'texture-lab': 'gemini-3-flash',
  'uv-lab': 'browser-uv-engine',
  'variant-forge': 'gemini-3-flash',
  'vfx-forge': 'gemini-3-flash',
  visualizer: 'gemini-3-flash',
}

const availableModelsByMode: Record<ForgeMode, ModelId[]> = {
  armory: ['gemini-3-flash', 'gemini-2.5-flash-image'],
  'action-animator': ['gemini-3-pro', 'gemini-2.5-flash-image', 'veo-3.1-fast'],
  'character-sheet': ['gemini-3-pro', 'gemini-3-flash'],
  'portrait-studio': ['gemini-3-pro'],
  'texture-lab': ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-flash-image'],
  'uv-lab': ['browser-uv-engine'],
  'variant-forge': ['gemini-3-flash', 'gemini-2.5-flash-image', 'gemini-3-pro'],
  'vfx-forge': ['gemini-3-flash'],
  visualizer: ['gemini-3-flash', 'gemini-2.5-flash-image'],
}

export function getActionAnimatorDefaultModel(
  pipeline: ActionAnimatorPipeline,
): ModelId {
  return pipeline === 'veo-video' ? 'veo-3.1-fast' : 'gemini-3-pro'
}

export function getModeDefaultModel(
  mode: ForgeMode,
  actionAnimatorPipeline: ActionAnimatorPipeline,
): ModelId {
  return mode === 'action-animator'
    ? getActionAnimatorDefaultModel(actionAnimatorPipeline)
    : smartDefaultModelByMode[mode]
}

export function getAvailableModelsForMode(
  mode: ForgeMode,
  actionAnimatorPipeline: ActionAnimatorPipeline,
): ModelId[] {
  if (mode !== 'action-animator') {
    return availableModelsByMode[mode]
  }

  return actionAnimatorPipeline === 'veo-video'
    ? ['veo-3.1-fast']
    : ['gemini-3-pro', 'gemini-2.5-flash-image']
}
