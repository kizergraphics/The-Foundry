import { MODEL_LABELS } from '../shared/modelLabels.js'

export const telemetryModelDefinitions = [
  {
    category: 'Multi-modal generative models',
    id: 'gpt-image-2',
    label: MODEL_LABELS['openai-gpt-image-2'],
    limits: {
      rpm: null,
      rpd: null,
      tpm: null,
    },
    metricFamily: 'generate',
    modelAliases: ['openai-gpt-image-2'],
    modelMatchers: ['gpt-image-2'],
    provider: 'openai',
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-pro',
    label: MODEL_LABELS['gemini-3-pro'],
    limits: {
      rpm: 20,
      rpd: 250,
      tpm: 100000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-3-pro'],
    modelMatchers: ['gemini-3-pro-image'],
    provider: 'google',
  },
  {
    category: 'Multi-modal generative models',
    id: 'gemini-omni-1.2-flash',
    label: MODEL_LABELS['gemini-omni-1.2-flash'],
    limits: {
      rpm: 8,
      rpd: 40,
      tpm: null,
    },
    metricFamily: 'video',
    modelAliases: ['gemini-omni-1.2-flash'],
    modelMatchers: ['gemini-omni-1.2-flash'],
    provider: 'google',
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-2.1',
    label: MODEL_LABELS['gemini-nano-banana-2.1'],
    limits: {
      rpm: null,
      rpd: null,
      tpm: null,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-nano-banana-2.1'],
    modelMatchers: ['gemini-nano-banana-2.1'],
    provider: 'google',
  },
  {
    category: 'Multi-modal generative models',
    id: 'veo-3-fast-generate',
    label: 'Veo 3 Fast Generate',
    historical: true,
    limits: {
      rpm: 2,
      rpd: 10,
      tpm: null,
    },
    metricFamily: 'video',
    modelAliases: ['veo-3.1-fast'],
    modelMatchers: ['veo-3.1-fast-generate', 'veo-3.0-fast-generate'],
    provider: 'google',
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-2',
    label: MODEL_LABELS['gemini-3-flash'],
    limits: {
      rpm: 100,
      rpd: 1000,
      tpm: 200000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-3-flash'],
    modelMatchers: ['gemini-3.1-flash-image'],
    provider: 'google',
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-2-lite',
    label: MODEL_LABELS['gemini-3-flash-lite'],
    limits: {
      rpm: 500,
      rpd: 2000,
      tpm: 500000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-3-flash-lite'],
    modelMatchers: ['gemini-3.1-flash-lite-image'],
    provider: 'google',
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana',
    label: 'Nano Banana (Gemini 2.5 Flash Image, legacy)',
    historical: true,
    limits: {
      rpm: 500,
      rpd: 2000,
      tpm: 500000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-2.5-flash-image'],
    modelMatchers: ['gemini-2.5-flash-image'],
    provider: 'google',
  },
  {
    category: 'Text-out models',
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    limits: {
      rpm: null,
      rpd: null,
      tpm: null,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-3.5-flash-lite'],
    modelMatchers: ['gemini-3.5-flash-lite'],
    provider: 'google',
  },
  {
    category: 'Text-out models',
    id: 'gemini-3-flash-text',
    label: 'Gemini 3 Flash',
    historical: true,
    limits: {
      rpm: 1000,
      rpd: 10000,
      tpm: 1000000,
    },
    metricFamily: 'generate',
    modelAliases: [],
    modelMatchers: ['gemini-3.1-flash', 'gemini-3-flash'],
    provider: 'google',
  },
  {
    category: 'Text-out models',
    id: 'gemini-2.5-flash-text',
    label: 'Gemini 2.5 Flash',
    historical: true,
    limits: {
      rpm: 1000,
      rpd: 10000,
      tpm: 1000000,
    },
    metricFamily: 'generate',
    modelAliases: [],
    modelMatchers: ['gemini-2.5-flash'],
    provider: 'google',
  },
]

export const activeTelemetryModelDefinitions = telemetryModelDefinitions.filter(
  (definition) => !definition.historical,
)

export const telemetryModelIdByAlias = Object.fromEntries(
  telemetryModelDefinitions.flatMap((definition) =>
    definition.modelAliases.map((alias) => [alias, definition.id]),
  ),
)

export const telemetryModelsById = new Map(
  telemetryModelDefinitions.map((definition) => [definition.id, definition]),
)
