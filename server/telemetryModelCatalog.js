export const telemetryModelDefinitions = [
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    limits: {
      rpm: 20,
      rpd: 250,
      tpm: 100000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-3-pro'],
    modelMatchers: ['gemini-3-pro-image'],
  },
  {
    category: 'Multi-modal generative models',
    id: 'veo-3-fast-generate',
    label: 'Veo 3 Fast Generate',
    limits: {
      rpm: 2,
      rpd: 10,
      tpm: null,
    },
    metricFamily: 'video',
    modelAliases: ['veo-3.1-fast'],
    modelMatchers: ['veo-3.1-fast-generate', 'veo-3.0-fast-generate'],
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-2',
    label: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    limits: {
      rpm: 100,
      rpd: 1000,
      tpm: 200000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-3-flash'],
    modelMatchers: ['gemini-3.1-flash-image'],
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana',
    label: 'Nano Banana (Gemini 2.5 Flash Preview Image)',
    limits: {
      rpm: 500,
      rpd: 2000,
      tpm: 500000,
    },
    metricFamily: 'generate',
    modelAliases: ['gemini-2.5-flash-image'],
    modelMatchers: ['gemini-2.5-flash-preview-image'],
  },
  {
    category: 'Text-out models',
    id: 'gemini-3-flash-text',
    label: 'Gemini 3 Flash',
    limits: {
      rpm: 1000,
      rpd: 10000,
      tpm: 1000000,
    },
    metricFamily: 'generate',
    modelAliases: [],
    modelMatchers: ['gemini-3.1-flash', 'gemini-3-flash'],
  },
  {
    category: 'Text-out models',
    id: 'gemini-2.5-flash-text',
    label: 'Gemini 2.5 Flash',
    limits: {
      rpm: 1000,
      rpd: 10000,
      tpm: 1000000,
    },
    metricFamily: 'generate',
    modelAliases: [],
    modelMatchers: ['gemini-2.5-flash'],
  },
]

export const telemetryModelIdByAlias = Object.fromEntries(
  telemetryModelDefinitions.flatMap((definition) =>
    definition.modelAliases.map((alias) => [alias, definition.id]),
  ),
)

export const telemetryModelsById = new Map(
  telemetryModelDefinitions.map((definition) => [definition.id, definition]),
)
