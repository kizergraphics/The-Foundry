import type { ForgeMode } from '../../shared/modeCatalog.js'
import type { ActionAnimatorPipeline } from '../lib/forge'

export const MODEL_LABELS = {
  'browser-uv-engine': 'Built-in UV Engine',
  'gemini-3-flash': 'Gemini 3.1 Flash Image',
  'gemini-3-flash-lite': 'Gemini 3.1 Flash Lite Image',
  'gemini-3-pro': 'Gemini 3 Pro Image',
  'openai-gpt-image-2': 'OpenAI GPT Image 2',
  'veo-3.1-fast': 'Veo 3 Fast Generate',
} as const

export type ModelId = keyof typeof MODEL_LABELS

export const TELEMETRY_ROW_BY_MODEL_ID: Record<ModelId, string> = {
  'browser-uv-engine': 'browser-uv-engine',
  'gemini-3-flash': 'nano-banana-2',
  'gemini-3-flash-lite': 'nano-banana-2-lite',
  'gemini-3-pro': 'nano-banana-pro',
  'openai-gpt-image-2': 'gpt-image-2',
  'veo-3.1-fast': 'veo-3-fast-generate',
}

const smartDefaultModelByMode: Record<ForgeMode, ModelId> = {
  armory: 'openai-gpt-image-2',
  'action-animator': 'openai-gpt-image-2',
  'character-sheet': 'openai-gpt-image-2',
  'portrait-studio': 'openai-gpt-image-2',
  'texture-lab': 'openai-gpt-image-2',
  'uv-lab': 'browser-uv-engine',
  'variant-forge': 'openai-gpt-image-2',
  'vfx-forge': 'openai-gpt-image-2',
  visualizer: 'openai-gpt-image-2',
}

const availableModelsByMode: Record<ForgeMode, ModelId[]> = {
  armory: ['openai-gpt-image-2', 'gemini-3-flash', 'gemini-3-flash-lite'],
  'action-animator': [
    'openai-gpt-image-2',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-flash-lite',
  ],
  'character-sheet': ['openai-gpt-image-2', 'gemini-3-pro', 'gemini-3-flash'],
  'portrait-studio': ['openai-gpt-image-2', 'gemini-3-pro'],
  'texture-lab': [
    'openai-gpt-image-2',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-flash-lite',
  ],
  'uv-lab': ['browser-uv-engine'],
  'variant-forge': [
    'openai-gpt-image-2',
    'gemini-3-flash',
    'gemini-3-flash-lite',
    'gemini-3-pro',
  ],
  'vfx-forge': ['openai-gpt-image-2', 'gemini-3-flash'],
  visualizer: ['openai-gpt-image-2', 'gemini-3-flash', 'gemini-3-flash-lite'],
}

export function getActionAnimatorDefaultModel(
  pipeline: ActionAnimatorPipeline = 'veo-video',
): ModelId {
  return pipeline === 'veo-video' ? 'veo-3.1-fast' : 'openai-gpt-image-2'
}

export function getModeDefaultModel(
  mode: ForgeMode,
  options?: {
    actionAnimatorPipeline?: ActionAnimatorPipeline
  },
): ModelId {
  return mode === 'action-animator'
    ? getActionAnimatorDefaultModel(options?.actionAnimatorPipeline)
    : smartDefaultModelByMode[mode]
}

export function getAvailableModelsForMode(
  mode: ForgeMode,
  options?: {
    actionAnimatorPipeline?: ActionAnimatorPipeline
  },
): ModelId[] {
  if (mode !== 'action-animator') {
    return availableModelsByMode[mode]
  }

  return options?.actionAnimatorPipeline === 'veo-video'
    ? ['veo-3.1-fast']
    : availableModelsByMode[mode]
}
