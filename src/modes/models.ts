import type { ForgeMode } from '../../shared/modeCatalog.js'

export const MODEL_LABELS = {
  'browser-uv-engine': 'Built-in UV Engine',
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
  'gemini-3-flash': 'Gemini 3.1 Flash',
  'gemini-3-pro': 'Gemini 3 Pro Image',
  'openai-gpt-image-2': 'OpenAI GPT Image 2',
  'veo-3.1-fast': 'Veo 3 Fast Generate',
} as const

export type ModelId = keyof typeof MODEL_LABELS

export const TELEMETRY_ROW_BY_MODEL_ID: Record<ModelId, string> = {
  'browser-uv-engine': 'browser-uv-engine',
  'gemini-2.5-flash-image': 'nano-banana',
  'gemini-3-flash': 'nano-banana-2',
  'gemini-3-pro': 'nano-banana-pro',
  'openai-gpt-image-2': 'gpt-image-2',
  'veo-3.1-fast': 'veo-3-fast-generate',
}

const smartDefaultModelByMode: Record<ForgeMode, ModelId> = {
  armory: 'openai-gpt-image-2',
  'action-animator': 'veo-3.1-fast',
  'character-sheet': 'openai-gpt-image-2',
  'portrait-studio': 'openai-gpt-image-2',
  'texture-lab': 'openai-gpt-image-2',
  'uv-lab': 'browser-uv-engine',
  'variant-forge': 'openai-gpt-image-2',
  'vfx-forge': 'openai-gpt-image-2',
  visualizer: 'openai-gpt-image-2',
}

const availableModelsByMode: Record<ForgeMode, ModelId[]> = {
  armory: ['openai-gpt-image-2', 'gemini-3-flash', 'gemini-2.5-flash-image'],
  'action-animator': ['veo-3.1-fast'],
  'character-sheet': ['openai-gpt-image-2', 'gemini-3-pro', 'gemini-3-flash'],
  'portrait-studio': ['openai-gpt-image-2', 'gemini-3-pro'],
  'texture-lab': [
    'openai-gpt-image-2',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-flash-image',
  ],
  'uv-lab': ['browser-uv-engine'],
  'variant-forge': [
    'openai-gpt-image-2',
    'gemini-3-flash',
    'gemini-2.5-flash-image',
    'gemini-3-pro',
  ],
  'vfx-forge': ['openai-gpt-image-2', 'gemini-3-flash'],
  visualizer: ['openai-gpt-image-2', 'gemini-3-flash', 'gemini-2.5-flash-image'],
}

export function getActionAnimatorDefaultModel(): ModelId {
  return 'veo-3.1-fast'
}

export function getModeDefaultModel(mode: ForgeMode): ModelId {
  return mode === 'action-animator'
    ? getActionAnimatorDefaultModel()
    : smartDefaultModelByMode[mode]
}

export function getAvailableModelsForMode(mode: ForgeMode): ModelId[] {
  if (mode !== 'action-animator') {
    return availableModelsByMode[mode]
  }

  return ['veo-3.1-fast']
}
