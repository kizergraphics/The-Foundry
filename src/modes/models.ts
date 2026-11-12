import type { ForgeMode } from '../../shared/modeCatalog.js'
import { MODEL_LABELS } from '../../shared/modelLabels.js'
import type { ActionAnimatorPipeline } from '../lib/forge'

export { MODEL_LABELS }

export type ModelId = keyof typeof MODEL_LABELS

// Standard Gemini API output rates in USD.
// https://ai.google.dev/gemini-api/docs/pricing
export const GEMINI_MODEL_PRICES: Partial<
  Record<ModelId, { rate: string; tier?: string; higherResolutions?: string }>
> = {
  'gemini-nano-banana-2.1': {
    rate: '$0.0336 / 1K image',
    tier: 'Lowest at 1K',
    higherResolutions: '$0.0504 at 2K · $0.113 at 4K',
  },
  'gemini-3-flash-lite': {
    rate: '$0.0336 / 1K image',
    tier: 'Lowest at 1K',
  },
  'gemini-3-flash': {
    rate: '$0.067 / 1K image',
    higherResolutions: '$0.101 at 2K · $0.151 at 4K',
  },
  'gemini-3-pro': {
    rate: '$0.134 / 1K image',
    tier: 'Highest at 1K',
    higherResolutions: '$0.134 at 2K · $0.240 at 4K',
  },
  'gemini-omni-1.2-flash': {
    rate: '≈ $0.07 / sec at 720p',
  },
}

export const TELEMETRY_ROW_BY_MODEL_ID: Record<ModelId, string> = {
  'browser-uv-engine': 'browser-uv-engine',
  'gemini-nano-banana-2.1': 'nano-banana-2.1',
  'gemini-3-flash': 'nano-banana-2',
  'gemini-3-flash-lite': 'nano-banana-2-lite',
  'gemini-3-pro': 'nano-banana-pro',
  'openai-gpt-image-2': 'gpt-image-2',
  'gemini-omni-1.2-flash': 'gemini-omni-1.2-flash',
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
  armory: ['openai-gpt-image-2', 'gemini-nano-banana-2.1', 'gemini-3-flash', 'gemini-3-flash-lite'],
  'action-animator': [
    'openai-gpt-image-2',
    'gemini-nano-banana-2.1',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-flash-lite',
  ],
  'character-sheet': ['openai-gpt-image-2', 'gemini-nano-banana-2.1', 'gemini-3-pro', 'gemini-3-flash'],
  'portrait-studio': ['openai-gpt-image-2', 'gemini-nano-banana-2.1', 'gemini-3-pro'],
  'texture-lab': [
    'openai-gpt-image-2',
    'gemini-nano-banana-2.1',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-flash-lite',
  ],
  'uv-lab': ['browser-uv-engine'],
  'variant-forge': [
    'openai-gpt-image-2',
    'gemini-nano-banana-2.1',
    'gemini-3-flash',
    'gemini-3-flash-lite',
    'gemini-3-pro',
  ],
  'vfx-forge': ['openai-gpt-image-2', 'gemini-nano-banana-2.1', 'gemini-3-flash'],
  visualizer: ['openai-gpt-image-2', 'gemini-nano-banana-2.1', 'gemini-3-flash', 'gemini-3-flash-lite'],
}

export function getActionAnimatorDefaultModel(
  pipeline: ActionAnimatorPipeline = 'veo-video',
): ModelId {
  return pipeline === 'veo-video' ? 'gemini-omni-1.2-flash' : 'openai-gpt-image-2'
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
    ? ['gemini-omni-1.2-flash']
    : availableModelsByMode[mode]
}
