import { useEffect, useReducer, useState } from 'react'
import {
  AlertCircle,
  Box,
  ChevronRight,
  Download,
  FileText,
  Fingerprint,
  Gem,
  Hammer,
  ImagePlus,
  LoaderCircle,
  Palette,
  Play,
  ScanFace,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
} from 'lucide-react'

import { ImageUploadField } from './components/ImageUploadField'
import { GeneratedResultCard, PlaceholderCard } from './components/ResultCards'
import {
  actionAnimatorActionOptions,
  buildActionAnimatorPrompt,
  generateActionAnimator,
} from './lib/actionAnimator'
import {
  buildCharacterSheetPrompt,
  generateCharacterSheet,
  getCharacterSheetPromptSource,
} from './lib/characterSheet'
import {
  buildTextureSeamRepairInput,
  buildTextureExpansionInput,
  copyResultToClipboard,
  createDataUrl,
  dataUrlToFile,
  downloadDataUrl,
  downloadResult,
  fileToBase64,
  sliceSpriteSheetFramesByContent,
  slicePortraitStudioFaces,
  sliceSpriteSheetFrames,
} from './lib/browser'
import { buildMockResults } from './lib/mockForge'
import {
  buildRecentPrompts,
  loadStoredState,
  persistStoredState,
} from './lib/persistence'
import {
  forgeReducer,
  initialState,
  modeDefinitions,
} from './lib/forge'
import type {
  ActionAnimatorActionType,
  CharacterSheetGenerationMode,
  CharacterSheetReferenceSlot,
  ForgeErrorInfo,
  ForgeMode,
  ForgeResult,
  ForgeStatus,
  LootLevelerRarity,
  ModeDefinition,
  ReferenceAsset,
  ReferenceSlot,
  TextureExpansionTargetSize,
  TextureLabWorkflow,
} from './lib/forge'

type ServiceHealth = {
  availableModels?: Record<string, string[]>
  keyConfigured: boolean
  models: Record<string, string>
  ok: boolean
}

type ForgeBriefItem = {
  label: string
  value: string
}

type TelemetryMetric = {
  current: number | null
  limit: number | null
  ratio: number | null
}

type TelemetryRow = {
  category: string
  chartPoints: number[]
  id: string
  label: string
  lastRequestAt: string | null
  metrics: {
    rpm: TelemetryMetric
    rpd: TelemetryMetric
    tpm?: TelemetryMetric | null
  }
}

type TelemetrySnapshot = {
  error?: {
    code?: string
    details?: unknown
    message?: string
  }
  generatedAt: string
  rows: TelemetryRow[]
  source?: string
  timeZone: string
}

type ForgeApiResponse = {
  error?:
    | string
    | {
        code?: string
        details?: string[]
        message?: string
        retryAfterSeconds?: number
        title?: string
      }
  images?: Array<{
    data: string
    id: string
    mimeType: string
    text?: string
  }>
  model?: string
  prompt?: string
}

type TextureLabRunContext = {
  prompt: string
  seamlessMode: boolean
  styleText: string
  workflow: 'expand' | 'generate'
}

const portraitStudioExpressionLabels = [
  'neutral',
  'angry',
  'sad',
  'joy',
  'surprised',
] as const

type TelemetryWindowState = {
  sessionMaxByModel: Record<string, number>
  startedAt: number
}

const telemetryWindowStorageKey = 'kizer-forge-telemetry-window'
const telemetryWindowDurationMs = 24 * 60 * 60 * 1000
const MODEL_LABELS = {
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-3-pro': 'Gemini 3 Pro',
  'veo-3.1-fast': 'Veo 3.1 Fast',
}
type ModelId = keyof typeof MODEL_LABELS

const TELEMETRY_ROW_BY_MODEL_ID: Record<ModelId, string> = {
  'gemini-2.5-flash-image': 'nano-banana',
  'gemini-3-flash': 'nano-banana-2',
  'gemini-3-pro': 'nano-banana-pro',
  'veo-3.1-fast': 'veo-3-fast-generate',
}
const telemetryRefreshIntervalMs = 10000

const smartDefaultModelByMode: Record<ForgeMode, ModelId> = {
  armory: 'gemini-3-flash',
  'action-animator': 'veo-3.1-fast',
  'character-sheet': 'gemini-3-pro',
  'loot-leveler': 'gemini-3-pro',
  'portrait-studio': 'gemini-3-pro',
  'texture-lab': 'gemini-3-flash',
  'vfx-forge': 'gemini-3-flash',
  visualizer: 'gemini-3-flash',
}

const availableModelsByMode: Record<ForgeMode, ModelId[]> = {
  armory: ['gemini-3-flash', 'gemini-2.5-flash-image'],
  'action-animator': ['veo-3.1-fast'],
  'character-sheet': ['gemini-3-pro', 'gemini-3-flash'],
  'loot-leveler': ['gemini-3-pro'],
  'portrait-studio': ['gemini-3-pro'],
  'texture-lab': ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-flash-image'],
  'vfx-forge': ['gemini-3-flash'],
  visualizer: ['gemini-3-flash', 'gemini-2.5-flash-image'],
}

const defaultTextureExpansionPrompt =
  'Generatively expand this texture. Use the central pattern as a reference to fill the outer edges with a matching, seamless, high-resolution material. Maintain identical grain, lighting, and color.'

function loadTelemetryWindowState(now = Date.now()): TelemetryWindowState {
  if (typeof window === 'undefined') {
    return {
      sessionMaxByModel: {},
      startedAt: now,
    }
  }

  try {
    const rawState = window.localStorage.getItem(telemetryWindowStorageKey)

    if (!rawState) {
      return {
        sessionMaxByModel: {},
        startedAt: now,
      }
    }

    const parsedState = JSON.parse(rawState) as Partial<TelemetryWindowState>
    const startedAt =
      typeof parsedState.startedAt === 'number' && Number.isFinite(parsedState.startedAt)
        ? parsedState.startedAt
        : now
    const sessionMaxByModel =
      parsedState.sessionMaxByModel &&
      typeof parsedState.sessionMaxByModel === 'object'
        ? Object.fromEntries(
            Object.entries(parsedState.sessionMaxByModel).filter(
              ([modelName, value]) =>
                typeof modelName === 'string' &&
                modelName.trim().length > 0 &&
                typeof value === 'number' &&
                Number.isFinite(value) &&
                value >= 0,
            ),
          )
        : {}

    if (now - startedAt >= telemetryWindowDurationMs) {
      return {
        sessionMaxByModel: {},
        startedAt: now,
      }
    }

    return {
      sessionMaxByModel,
      startedAt,
    }
  } catch {
    return {
      sessionMaxByModel: {},
      startedAt: now,
    }
  }
}

function persistTelemetryWindowState(state: TelemetryWindowState) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(telemetryWindowStorageKey, JSON.stringify(state))
}

function App() {
  const [state, dispatch] = useReducer(forgeReducer, initialState)
  const [status, setStatus] = useState<ForgeStatus>('idle')
  const [results, setResults] = useState<ForgeResult[]>([])
  const [error, setError] = useState<ForgeErrorInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [serverPrompt, setServerPrompt] = useState<string | null>(null)
  const [serverModel, setServerModel] = useState<string | null>(null)
  const [recentPrompts, setRecentPrompts] = useState<string[]>([])
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [lastCharacterSheetResult, setLastCharacterSheetResult] =
    useState<ForgeResult | null>(null)
  const [lastResultMode, setLastResultMode] = useState<ForgeMode | null>(null)
  const [repairingResultId, setRepairingResultId] = useState<string | null>(null)
  const [hasRestoredState, setHasRestoredState] = useState(false)
  const [lastTextureLabRun, setLastTextureLabRun] =
    useState<TextureLabRunContext | null>(null)
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null)
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot | null>(
    null,
  )
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [modelOverridesByMode, setModelOverridesByMode] = useState<
    Partial<Record<ForgeMode, ModelId>>
  >({})
  const [styleInputByMode, setStyleInputByMode] = useState<
    Partial<Record<ForgeMode, string>>
  >({})
  const [activeModel, setActiveModel] = useState<ModelId>(
    smartDefaultModelByMode[initialState.activeMode],
  )
  const [sessionCountsByModel, setSessionCountsByModel] = useState<
    Record<string, number>
  >({})
  const [sessionMaxByModel, setSessionMaxByModel] = useState(
    () => loadTelemetryWindowState().sessionMaxByModel,
  )
  const activeMode = modeDefinitions[state.activeMode]
  const isActionAnimatorMode = state.activeMode === 'action-animator'
  const isCharacterSheetMode = state.activeMode === 'character-sheet'
  const isLootLevelerMode = state.activeMode === 'loot-leveler'
  const isPortraitStudioMode = state.activeMode === 'portrait-studio'
  const isTextureLabMode = state.activeMode === 'texture-lab'
  const isTextureExpansionMode =
    isTextureLabMode && state.textureLab.workflow === 'expand'
  const isTextureGenerateMode =
    isTextureLabMode && state.textureLab.workflow === 'generate'
  const isVfxForgeMode = state.activeMode === 'vfx-forge'
  const characterReferenceCount = Object.values(
    state.characterSheet.references,
  ).filter(Boolean).length
  const standardReferenceCount = Object.values(state.references).filter(Boolean).length
  const referenceCount = isCharacterSheetMode
    ? characterReferenceCount
    : isActionAnimatorMode
      ? Number(Boolean(state.actionAnimator.characterImage))
      : isLootLevelerMode
        ? Number(Boolean(state.lootLeveler.baseAsset))
        : isPortraitStudioMode
          ? Number(Boolean(state.portraitStudio.heroImage))
          : isTextureExpansionMode
            ? Number(Boolean(state.textureLab.expansionSource))
            : isVfxForgeMode
              ? 0
              : standardReferenceCount
  const activeStyleInput = styleInputByMode[state.activeMode] ?? ''
  const promptPreview = isCharacterSheetMode
    ? buildCharacterSheetPrompt(state.characterSheet)
    : isActionAnimatorMode
      ? buildActionAnimatorPrompt(state.actionAnimator)
      : isLootLevelerMode
        ? buildLootLevelerPromptPreview(state.lootLeveler.rarity)
        : isPortraitStudioMode
          ? buildPortraitStudioPromptPreview(state.portraitStudio.prompt)
          : isTextureExpansionMode
            ? state.prompt.trim() || defaultTextureExpansionPrompt
            : isTextureGenerateMode && state.textureLab.seamlessMode
              ? buildSeamlessPromptPreview(state.prompt, activeStyleInput)
              : isVfxForgeMode
                ? buildVfxForgePromptPreview(
                    state.vfxForge.projectileType,
                    state.vfxForge.intensity,
                    state.vfxForge.frameCount,
                    state.vfxForge.prompt,
                  )
                : state.prompt.trim() || modeDefinitions[state.activeMode].instruction
  const activePromptValue = isCharacterSheetMode
    ? getCharacterSheetPromptSource(state.characterSheet)
    : isActionAnimatorMode
      ? state.actionAnimator.actionType === 'custom'
        ? state.actionAnimator.customActionPrompt
        : buildActionAnimatorPrompt(state.actionAnimator)
      : isLootLevelerMode
        ? buildLootLevelerPromptPreview(state.lootLeveler.rarity)
        : isPortraitStudioMode
          ? state.portraitStudio.prompt
          : isVfxForgeMode
            ? buildVfxForgePromptPreview(
                state.vfxForge.projectileType,
                state.vfxForge.intensity,
                state.vfxForge.frameCount,
                state.vfxForge.prompt,
              )
            : state.prompt
  const isCharacterSheetReady =
    state.characterSheet.generationMode === 'manifest'
      ? state.characterSheet.manifestPrompt.trim().length > 0
      : characterReferenceCount === 3
  const isReadyForApi = isCharacterSheetMode
    ? isCharacterSheetReady
    : isActionAnimatorMode
      ? Boolean(state.actionAnimator.characterImage) &&
        (state.actionAnimator.actionType !== 'custom' ||
          state.actionAnimator.customActionPrompt.trim().length > 0)
      : isLootLevelerMode
        ? Boolean(state.lootLeveler.baseAsset)
        : isPortraitStudioMode
          ? Boolean(state.portraitStudio.heroImage)
          : isTextureExpansionMode
            ? Boolean(state.textureLab.expansionSource)
            : isVfxForgeMode
              ? state.vfxForge.projectileType.trim().length > 0
              : state.prompt.trim().length > 0
  const isForging = status === 'loading'
  const isShowingResults = results.length > 0
  const isSingleResultMode =
    isActionAnimatorMode ||
    isCharacterSheetMode ||
    isLootLevelerMode ||
    isPortraitStudioMode ||
    isTextureExpansionMode ||
    isVfxForgeMode
  const activeGenerationCount =
    isSingleResultMode ? 1 : state.generationCount
  const reservedOutputs = Array.from(
    { length: isShowingResults ? results.length : activeGenerationCount },
    (_, index) => index,
  )
  const effectiveModel = isTextureExpansionMode ? 'gemini-3-pro' : activeModel
  const activeModelName = serverModel ?? effectiveModel
  const briefItems = isCharacterSheetMode
    ? buildCharacterSheetBriefItems(state)
    : isActionAnimatorMode
      ? buildActionAnimatorBriefItems(state)
      : isLootLevelerMode
        ? buildLootLevelerBriefItems(state)
        : isPortraitStudioMode
          ? buildPortraitStudioBriefItems(state)
          : isTextureExpansionMode
            ? buildTextureExpansionBriefItems(state)
            : isVfxForgeMode
              ? buildVfxForgeBriefItems(state)
              : [
                  {
                    label: 'Style Ref',
                    value: state.references.style?.name ?? 'Not attached',
                  },
                  {
                    label: 'Subject Ref',
                    value: state.references.subject?.name ?? 'Not attached',
                  },
                  ...(isTextureGenerateMode
                    ? [
                        {
                          label: 'Seamless',
                          value: state.textureLab.seamlessMode ? 'Enabled' : 'Disabled',
                        },
                      ]
                    : []),
                ]
  const modeAvailableModels = availableModelsByMode[state.activeMode]
  const selectedModelSupported = modeAvailableModels.includes(activeModel)
  const selectedTelemetryModel = effectiveModel
  const highlightedTelemetryRowId =
    TELEMETRY_ROW_BY_MODEL_ID[selectedTelemetryModel ?? activeModel] ?? null
  const telemetryModelKey = selectedTelemetryModel ?? 'all-models'
  const currentSessionCount = sessionCountsByModel[telemetryModelKey] ?? 0
  const sessionMax = sessionMaxByModel[telemetryModelKey] ?? 0

  async function refreshHealth(cancelState?: { cancelled: boolean }) {
    await fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Health check failed.')
        }

        return (await response.json()) as ServiceHealth
      })
      .then((payload) => {
        if (!cancelState?.cancelled) {
          setServiceHealth(payload)
        }
      })
      .catch(() => {
        if (!cancelState?.cancelled) {
          setServiceHealth(null)
        }
      })
  }

  async function refreshTelemetry(cancelState?: { cancelled: boolean }) {
    await fetch('/api/usage/telemetry')
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | {
                error?: {
                  message?: string
                }
              }
            | null
          throw new Error(payload?.error?.message || 'Telemetry endpoint failed.')
        }

        return (await response.json()) as TelemetrySnapshot
      })
      .then((payload) => {
        if (!cancelState?.cancelled) {
          setTelemetrySnapshot(payload)
          setTelemetryError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelState?.cancelled) {
          setTelemetrySnapshot(null)
          setTelemetryError(
            error instanceof Error ? error.message : 'Telemetry is unavailable right now.',
          )
        }
      })
  }

  useEffect(() => {
    const storedState = loadStoredState()

    if (storedState) {
      dispatch({ type: 'set-mode', mode: storedState.settings.activeMode })
      dispatch({
        type: 'set-action-animator-action',
        actionType: storedState.settings.actionAnimator.actionType,
      })
      dispatch({
        type: 'set-action-animator-custom-prompt',
        prompt: storedState.settings.actionAnimator.customActionPrompt,
      })
      dispatch({
        type: 'set-action-animator-frame-count',
        frameCount: storedState.settings.actionAnimator.frameCount,
      })
      dispatch({
        type: 'set-action-animator-fps',
        fps: storedState.settings.actionAnimator.fps,
      })
      dispatch({
        type: 'set-generation-count',
        count: storedState.settings.generationCount,
      })
      dispatch({
        type: 'set-loot-leveler-rarity',
        rarity: storedState.settings.lootLeveler.rarity,
      })
      dispatch({
        type: 'set-portrait-studio-prompt',
        prompt: storedState.settings.portraitStudio.prompt,
      })
      dispatch({ type: 'set-prompt', prompt: storedState.settings.prompt })
      dispatch({
        type: 'set-vfx-intensity',
        intensity: storedState.settings.vfxForge.intensity,
      })
      dispatch({
        type: 'set-vfx-frame-count',
        frameCount: storedState.settings.vfxForge.frameCount,
      })
      dispatch({
        type: 'set-vfx-prompt',
        prompt: storedState.settings.vfxForge.prompt,
      })
      dispatch({
        type: 'set-vfx-projectile-type',
        projectileType: storedState.settings.vfxForge.projectileType,
      })
      dispatch({
        type: 'set-character-sheet-mode',
        mode: storedState.settings.characterSheet.generationMode,
      })
      dispatch({
        type: 'set-character-sheet-manifest',
        prompt: storedState.settings.characterSheet.manifestPrompt,
      })
      dispatch({
        type: 'set-character-sheet-reference-prompt',
        prompt: storedState.settings.characterSheet.referencePrompt,
      })
      dispatch({
        type: 'set-character-sheet-consistency',
        enabled: storedState.settings.characterSheet.consistencyEnabled,
      })
      dispatch({
        type: 'set-character-sheet-parent-id',
        parentId: storedState.settings.characterSheet.parentId,
      })
      dispatch({
        type: 'set-texture-lab-workflow',
        workflow: storedState.settings.textureLab.workflow,
      })
      dispatch({
        type: 'set-texture-expansion-target-size',
        size: storedState.settings.textureLab.expansionTargetSize,
      })
      dispatch({
        type: 'set-texture-lab-seamless-mode',
        enabled: storedState.settings.textureLab.seamlessMode,
      })
      setRecentPrompts(storedState.recentPrompts)
      setResults(storedState.session?.results ?? [])
      setServerModel(storedState.session?.serverModel ?? null)
      setServerPrompt(storedState.session?.serverPrompt ?? null)
      setLastSavedAt(storedState.session?.savedAt ?? null)
      if (storedState.session?.results?.length) {
        setLastResultMode(storedState.settings.activeMode)
        if (storedState.settings.activeMode === 'character-sheet') {
          setLastCharacterSheetResult(storedState.session.results[0] ?? null)
        }
        setStatus('success')
        setNotice('Restored the latest forge session from this browser.')
      }
    }

    setHasRestoredState(true)
  }, [])

  useEffect(() => {
    const cancelState = { cancelled: false }
    const intervalId = window.setInterval(() => {
      void refreshTelemetry(cancelState)
    }, telemetryRefreshIntervalMs)

    void refreshHealth(cancelState)
    void refreshTelemetry(cancelState)

    return () => {
      cancelState.cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const modeDefault = smartDefaultModelByMode[state.activeMode]
    const modeOverride = modelOverridesByMode[state.activeMode]
    const nextModel =
      modeOverride && availableModelsByMode[state.activeMode].includes(modeOverride)
        ? modeOverride
        : modeDefault

    setActiveModel(nextModel)
  }, [modelOverridesByMode, state.activeMode])

  function registerSuccessfulApiCall(modelName?: string | null) {
    const telemetryKey =
      typeof modelName === 'string' && modelName.trim().length > 0
        ? modelName
        : 'all-models'

    setSessionCountsByModel((previousCounts) => {
      const nextCount = (previousCounts[telemetryKey] ?? 0) + 1
      const now = Date.now()
      const previousWindowState = loadTelemetryWindowState(now)
      const nextWindowState =
        now - previousWindowState.startedAt >= telemetryWindowDurationMs
          ? {
              sessionMaxByModel: {
                [telemetryKey]: nextCount,
              },
              startedAt: now,
            }
          : {
              ...previousWindowState,
              sessionMaxByModel: {
                ...previousWindowState.sessionMaxByModel,
                [telemetryKey]: Math.max(
                  previousWindowState.sessionMaxByModel[telemetryKey] ?? 0,
                  nextCount,
                ),
              },
            }

      persistTelemetryWindowState(nextWindowState)
      setSessionMaxByModel(nextWindowState.sessionMaxByModel)

      return {
        ...previousCounts,
        [telemetryKey]: nextCount,
      }
    })

    void refreshTelemetry()
  }

  function handleModelSelect(nextModel: ModelId) {
    if (!availableModelsByMode[state.activeMode].includes(nextModel)) {
      setError({
        code: 'model_unsupported',
        message:
          `The selected model ${MODEL_LABELS[nextModel]} is not available for ${activeMode.label}.`,
        title: 'Model Not Supported For This Tab',
      })
      return
    }

    setActiveModel(nextModel)
    setError(null)
    setModelOverridesByMode((previousOverrides) => ({
      ...previousOverrides,
      [state.activeMode]: nextModel,
    }))
    setNotice(
      `Model override set to ${MODEL_LABELS[nextModel]} for ${activeMode.label}.`,
    )
    void refreshTelemetry()
  }

  function handleStyleInputChange(nextValue: string) {
    setStyleInputByMode((previousState) => ({
      ...previousState,
      [state.activeMode]: nextValue,
    }))
  }

  useEffect(() => {
    if (!hasRestoredState) {
      return
    }

    persistStoredState({
      recentPrompts,
      settings: {
        activeMode: state.activeMode,
        actionAnimator: {
          actionType: state.actionAnimator.actionType,
          customActionPrompt: state.actionAnimator.customActionPrompt,
          frameCount: state.actionAnimator.frameCount,
          fps: state.actionAnimator.fps,
        },
        characterSheet: {
          consistencyEnabled: state.characterSheet.consistencyEnabled,
          generationMode: state.characterSheet.generationMode,
          manifestPrompt: state.characterSheet.manifestPrompt,
          parentId: state.characterSheet.parentId,
          referencePrompt: state.characterSheet.referencePrompt,
        },
        generationCount: state.generationCount,
        lootLeveler: {
          rarity: state.lootLeveler.rarity,
        },
        portraitStudio: {
          prompt: state.portraitStudio.prompt,
        },
        prompt: state.prompt,
        textureLab: {
          expansionTargetSize: state.textureLab.expansionTargetSize,
          seamlessMode: state.textureLab.seamlessMode,
          workflow: state.textureLab.workflow,
        },
        vfxForge: {
          frameCount: state.vfxForge.frameCount,
          intensity: state.vfxForge.intensity,
          prompt: state.vfxForge.prompt,
          projectileType: state.vfxForge.projectileType,
        },
      },
      session:
        results.length > 0
          ? {
              results,
              serverModel,
              serverPrompt,
              savedAt: lastSavedAt ?? new Date().toISOString(),
            }
          : null,
    })
  }, [
    hasRestoredState,
    lastSavedAt,
    recentPrompts,
    results,
    serverModel,
    serverPrompt,
    state.activeMode,
    state.actionAnimator.actionType,
    state.actionAnimator.customActionPrompt,
    state.actionAnimator.frameCount,
    state.actionAnimator.fps,
    state.characterSheet.consistencyEnabled,
    state.characterSheet.generationMode,
    state.characterSheet.manifestPrompt,
    state.characterSheet.parentId,
    state.characterSheet.referencePrompt,
    state.generationCount,
    state.lootLeveler.rarity,
    state.portraitStudio.prompt,
    state.prompt,
    state.textureLab.expansionTargetSize,
    state.textureLab.seamlessMode,
    state.textureLab.workflow,
    state.vfxForge.frameCount,
    state.vfxForge.intensity,
    state.vfxForge.prompt,
    state.vfxForge.projectileType,
  ])

  function finalizeForgeRun(
    nextResults: ForgeResult[],
    nextServerModel: string | null,
    nextServerPrompt: string | null,
    nextNotice: string,
    options?: {
      runContext?: TextureLabRunContext | null
      telemetryModel?: string | null
      trackTelemetry?: boolean
    },
  ) {
    const savedAt = new Date().toISOString()
    const nextRecentPrompts = buildRecentPrompts(activePromptValue, recentPrompts)

    setResults(nextResults)
    setServerModel(nextServerModel)
    setServerPrompt(nextServerPrompt)
    setStatus('success')
    setError(null)
    setNotice(nextNotice)
    setLastSavedAt(savedAt)
    setLastResultMode(state.activeMode)
    setRecentPrompts(nextRecentPrompts)
    setRepairingResultId(null)

    if (options?.runContext !== undefined) {
      setLastTextureLabRun(options.runContext)
    }

    if (options?.trackTelemetry) {
      registerSuccessfulApiCall(options.telemetryModel ?? nextServerModel)
    }

    if (isCharacterSheetMode) {
      setLastCharacterSheetResult(nextResults[0] ?? null)
    }

    if (isCharacterSheetMode && state.characterSheet.consistencyEnabled) {
      dispatch({
        type: 'set-character-sheet-parent-id',
        parentId: nextResults[0]?.id ?? null,
      })
    }
  }

  async function handleForge() {
    if (!isReadyForApi || isForging) {
      return
    }

    if (!selectedModelSupported) {
      setStatus('error')
      setError({
        code: 'model_unsupported',
        details: [
          `Available models for ${activeMode.label}: ${modeAvailableModels
            .map((model) => MODEL_LABELS[model])
            .join(', ')}`,
        ],
        message:
          `The selected model ${MODEL_LABELS[activeModel]} does not support this tab's workflow.`,
        title: 'Model Not Supported For This Tab',
      })
      return
    }

    setStatus('loading')
    setError(null)
    setNotice(null)
    setResults([])
    setServerPrompt(null)

    try {
      if (isActionAnimatorMode) {
        const payload = await generateActionAnimator({
          modelId: activeModel,
          state: state.actionAnimator,
        })

        finalizeForgeRun(
          payload.results,
          payload.model,
          payload.prompt ?? promptPreview,
          'Action Animator returned a sprite-sheet-ready motion strip.',
          {
            runContext: null,
            telemetryModel: payload.model,
            trackTelemetry: true,
          },
        )
        return
      }

      if (isCharacterSheetMode) {
        const payload = await generateCharacterSheet({
          modelId: activeModel,
          state: state.characterSheet,
          styleId: activeStyleInput.trim() || 'studio-default',
        })

        finalizeForgeRun(
          payload.results,
          payload.model,
          activePromptValue.trim(),
          'Character sheet generated with palette extraction enabled.',
          {
            runContext: null,
            telemetryModel: payload.model,
            trackTelemetry: true,
          },
        )
        return
      }

      if (isLootLevelerMode) {
        const baseAsset = state.lootLeveler.baseAsset

        if (!baseAsset) {
          throw new Error('Attach a base asset before running Loot Leveler.')
        }

        const response = await fetch('/api/forge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            generationCount: 1,
            mode: 'loot-leveler',
            modelId: activeModel,
            prompt: '',
            rarity: state.lootLeveler.rarity,
            references: [
              {
                data: await fileToBase64(baseAsset.file),
                mimeType: baseAsset.mimeType,
                name: baseAsset.name,
                slot: 'subject',
              },
            ],
            styleText: activeStyleInput.trim(),
          }),
        })

        const payload = (await response.json()) as ForgeApiResponse | undefined

        if (!response.ok || !payload?.images?.length) {
          throw toForgeError(payload?.error)
        }

        finalizeForgeRun(
          payload.images.map((image) => ({
            dataUrl: createDataUrl(image.data, image.mimeType),
            id: image.id,
            mimeType: image.mimeType,
            text: image.text,
          })),
          payload.model ?? null,
          payload.prompt ?? promptPreview,
          `Loot Leveler created a ${formatRarityLabel(state.lootLeveler.rarity)} variant.`,
          {
            runContext: null,
            telemetryModel: payload.model,
            trackTelemetry: true,
          },
        )
        return
      }

      if (isPortraitStudioMode) {
        const heroImage = state.portraitStudio.heroImage

        if (!heroImage) {
          throw new Error('Attach a hero image before running Portrait Studio.')
        }

        const response = await fetch('/api/forge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            generationCount: 1,
            mode: 'portrait-studio',
            modelId: activeModel,
            prompt: state.portraitStudio.prompt.trim(),
            references: [
              {
                data: await fileToBase64(heroImage.file),
                mimeType: heroImage.mimeType,
                name: heroImage.name,
                slot: 'subject',
              },
            ],
            styleText: activeStyleInput.trim(),
          }),
        })

        const payload = (await response.json()) as ForgeApiResponse | undefined

        if (!response.ok || !payload?.images?.length) {
          throw toForgeError(payload?.error)
        }

        finalizeForgeRun(
          payload.images.map((image) => ({
            dataUrl: createDataUrl(image.data, image.mimeType),
            id: image.id,
            mimeType: image.mimeType,
            text: image.text,
          })),
          payload.model ?? null,
          payload.prompt ?? promptPreview,
          'Portrait Studio generated a five-expression contact sheet.',
          {
            runContext: null,
            telemetryModel: payload.model,
            trackTelemetry: true,
          },
        )
        return
      }

      if (isTextureExpansionMode) {
        const sourceAsset = state.textureLab.expansionSource

        if (!sourceAsset) {
          throw new Error('Attach a source texture before starting an expansion pass.')
        }

        const [expansionCanvas, sourceBase64] = await Promise.all([
          buildTextureExpansionInput(sourceAsset.file, {
            targetSize: state.textureLab.expansionTargetSize,
          }),
          fileToBase64(sourceAsset.file),
        ])

        const response = await fetch('/api/forge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            generationCount: 1,
            mode: state.activeMode,
            modelId: activeModel,
            prompt: state.prompt.trim(),
            styleText: activeStyleInput.trim(),
            textureExpansion: {
              canvasImage: {
                data: expansionCanvas.base64,
                mimeType: expansionCanvas.mimeType,
                name: `expanded-canvas-${sourceAsset.name}`,
              },
              sourceCoverage: expansionCanvas.sourceCoverage,
              sourceHeight: expansionCanvas.sourceHeight,
              sourceImage: {
                data: sourceBase64,
                mimeType: sourceAsset.mimeType,
                name: sourceAsset.name,
              },
              sourceWidth: expansionCanvas.sourceWidth,
              targetSize: expansionCanvas.targetSize,
            },
            workflow: 'expand-texture',
          }),
        })

        const payload = (await response.json()) as ForgeApiResponse | undefined

        if (!response.ok || !payload?.images?.length) {
          throw toForgeError(payload?.error)
        }

        finalizeForgeRun(
          payload.images.map((image) => ({
            dataUrl: createDataUrl(image.data, image.mimeType),
            id: image.id,
            mimeType: image.mimeType,
            text: image.text,
          })),
          payload.model ?? null,
          payload.prompt ?? promptPreview,
          'Texture expansion completed with a centered outpaint pass.',
          {
            runContext: {
              prompt: state.prompt.trim(),
              seamlessMode: state.textureLab.seamlessMode,
              styleText: activeStyleInput.trim(),
              workflow: 'expand',
            },
            telemetryModel: payload.model,
            trackTelemetry: true,
          },
        )
        return
      }

      if (isVfxForgeMode) {
        const response = await fetch('/api/forge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            generationCount: 1,
            frameCount: state.vfxForge.frameCount,
            intensity: state.vfxForge.intensity,
            mode: 'vfx-forge',
            modelId: activeModel,
            projectileType: state.vfxForge.projectileType.trim(),
            prompt: state.vfxForge.prompt.trim(),
            styleText: activeStyleInput.trim(),
          }),
        })

        const payload = (await response.json()) as ForgeApiResponse | undefined

        if (!response.ok || !payload?.images?.length) {
          throw toForgeError(payload?.error)
        }

        finalizeForgeRun(
          payload.images.map((image) => ({
            dataUrl: createDataUrl(image.data, image.mimeType),
            id: image.id,
            mimeType: image.mimeType,
            text: image.text,
          })),
          payload.model ?? null,
          payload.prompt ?? promptPreview,
          'VFX Forge generated an additive-ready projectile strip.',
          {
            runContext: null,
            telemetryModel: payload.model,
            trackTelemetry: true,
          },
        )
        return
      }

      const references = await Promise.all(
        Object.entries(state.references)
          .filter(
            (entry): entry is [ReferenceSlot, ReferenceAsset] => Boolean(entry[1]),
          )
          .map(async ([slot, asset]) => ({
            data: await fileToBase64(asset.file),
            mimeType: asset.mimeType,
            name: asset.name,
            slot,
        })),
      )

      const response = await fetch('/api/forge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generationCount: state.generationCount,
          modelId: activeModel,
          mode: state.activeMode,
          prompt: state.prompt.trim(),
          references,
          seamlessMode: isTextureGenerateMode && state.textureLab.seamlessMode,
          styleText: activeStyleInput.trim(),
        }),
      })

      const payload = (await response.json()) as ForgeApiResponse | undefined

      if (!response.ok || !payload?.images?.length) {
        throw toForgeError(payload?.error)
      }

      finalizeForgeRun(
        payload.images.map((image) => ({
          dataUrl: createDataUrl(image.data, image.mimeType),
          id: image.id,
          mimeType: image.mimeType,
          text: image.text,
        })),
        payload.model ?? null,
        activePromptValue.trim(),
        `Forge pass completed with ${payload.images.length} candidate outputs.`,
        {
          runContext: isTextureLabMode
            ? {
                prompt: state.prompt.trim(),
                seamlessMode: state.textureLab.seamlessMode,
                styleText: activeStyleInput.trim(),
                workflow: 'generate',
              }
            : null,
          telemetryModel: payload.model,
          trackTelemetry: true,
        },
      )
    } catch (requestError) {
      setStatus('error')
      setError(toForgeError(requestError))
    }
  }

  async function handleCopy(result: ForgeResult) {
    try {
      await copyResultToClipboard(result)
      setNotice('Image copied to the clipboard.')
    } catch (copyError) {
      setError(toForgeError(copyError, 'Clipboard Action Failed'))
    }
  }

  function handleDownload(result: ForgeResult, index: number) {
    const extension = result.mimeType.includes('svg')
      ? 'svg'
      : result.mimeType.includes('png')
        ? 'png'
        : 'jpg'
    downloadResult(result, `kizer-forge-${state.activeMode}-${index + 1}.${extension}`)
    setNotice(`Downloaded candidate ${index + 1}.`)
  }

  async function handleDownloadPortraitFaces(result: ForgeResult, index: number) {
    try {
      const faceDataUrls = await slicePortraitStudioFaces(result.dataUrl)

      faceDataUrls.forEach((dataUrl, faceIndex) => {
        const expressionLabel =
          portraitStudioExpressionLabels[faceIndex] ?? `face-${faceIndex + 1}`

        window.setTimeout(() => {
          downloadDataUrl(
            dataUrl,
            `kizer-forge-portrait-studio-${index + 1}-${expressionLabel}.png`,
          )
        }, faceIndex * 120)
      })

      setNotice(`Queued ${faceDataUrls.length} portrait face downloads.`)
    } catch (downloadError) {
      setError(toForgeError(downloadError, 'Portrait Face Download Failed'))
    }
  }

  async function handleDownloadVfxFrames(result: ForgeResult, index: number) {
    try {
      const frameDataUrls = await sliceSpriteSheetFramesByContent(
        result.dataUrl,
        {
          expectedCount: state.vfxForge.frameCount,
        },
      )
      const projectileSlug = slugifyFileSegment(
        state.vfxForge.projectileType,
        'projectile',
      )

      frameDataUrls.forEach((dataUrl, frameIndex) => {
        window.setTimeout(() => {
          downloadDataUrl(
            dataUrl,
            `kizer-forge-vfx-forge-${index + 1}-${projectileSlug}-frame-${String(frameIndex + 1).padStart(2, '0')}.png`,
          )
        }, frameIndex * 120)
      })

      setNotice(`Queued ${frameDataUrls.length} VFX frame downloads.`)
    } catch (downloadError) {
      setError(toForgeError(downloadError, 'VFX Frame Download Failed'))
    }
  }

  async function hydrateLatestCharacterSheetInto(
    action:
      | { type: 'set-action-animator-image' }
      | { type: 'set-portrait-studio-image' },
  ) {
    if (!lastCharacterSheetResult) {
      setError({
        message: 'Generate a character sheet first or attach an image manually.',
        title: 'Character Sheet Source Missing',
      })
      return
    }

    try {
      const file = await dataUrlToFile(
        lastCharacterSheetResult.dataUrl,
        'character-sheet-reference.png',
      )

      dispatch({
        ...action,
        asset: {
          file,
          mimeType: file.type || lastCharacterSheetResult.mimeType,
          name: file.name,
          sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
        },
      })
      setNotice('Loaded the latest character sheet result into the active tab.')
    } catch (assetError) {
      setError(toForgeError(assetError, 'Failed To Reuse Character Sheet'))
    }
  }

  async function handleRepairSeams(result: ForgeResult) {
    const repairContext = lastTextureLabRun

    if (!repairContext || repairContext.workflow !== 'generate' || !repairContext.seamlessMode) {
      setError({
        message: 'Seam repair is only available for seamless Texture Lab generation results.',
        title: 'Seam Repair Unavailable',
      })
      return
    }

    setRepairingResultId(result.id)
    setError(null)
    setNotice('Preparing offset seam repair pass.')

    try {
      const sourceBlob = await fetch(result.dataUrl).then((response) => response.blob())
      const repairInput = await buildTextureSeamRepairInput(sourceBlob)
      const response = await fetch('/api/forge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'texture-lab',
          modelId: 'gemini-3-pro',
          prompt: repairContext.prompt,
          seamRepair: {
            offsetImage: {
              data: repairInput.offsetBase64,
              mimeType: repairInput.mimeType,
            },
            originalImage: {
              data: repairInput.originalBase64,
              mimeType: repairInput.mimeType,
            },
            sourceHeight: repairInput.sourceHeight,
            sourceWidth: repairInput.sourceWidth,
          },
          styleText: repairContext.styleText,
          workflow: 'repair-seams',
        }),
      })

      const payload = (await response.json()) as ForgeApiResponse | undefined

      if (!response.ok || !payload?.images?.length) {
        throw toForgeError(payload?.error)
      }

      const repairedImage = payload.images[0]
      const nextResult: ForgeResult = {
        dataUrl: createDataUrl(repairedImage.data, repairedImage.mimeType),
        id: `${result.id}-repaired`,
        mimeType: repairedImage.mimeType,
        text: repairedImage.text,
      }

      setResults((previousResults) =>
        previousResults.map((entry) => (entry.id === result.id ? nextResult : entry)),
      )
      setServerModel(payload.model ?? serverModel)
      setServerPrompt(payload.prompt ?? serverPrompt)
      setStatus('success')
      setNotice('Seam repair pass completed for the selected texture.')
      setLastSavedAt(new Date().toISOString())
      setLastResultMode('texture-lab')
      registerSuccessfulApiCall(payload.model ?? 'gemini-3-pro')
    } catch (repairError) {
      setError(toForgeError(repairError, 'Seam Repair Failed'))
    } finally {
      setRepairingResultId(null)
    }
  }

  function handleMockForge() {
    const mockResults = buildMockResults({
      count: activeGenerationCount,
      mode: state.activeMode,
      prompt: activePromptValue || promptPreview,
    })

    finalizeForgeRun(
      mockResults,
      'mock-local-preview',
      promptPreview,
      isCharacterSheetMode
        ? 'Showing local mock character-sheet results so you can keep iterating on layout, palette, and review flow.'
        : 'Showing local mock results so you can continue product work without live Gemini quota.',
      {
        runContext: isTextureLabMode
          ? {
              prompt: state.prompt.trim(),
              seamlessMode: state.textureLab.seamlessMode,
              styleText: activeStyleInput.trim(),
              workflow: isTextureExpansionMode ? 'expand' : 'generate',
            }
          : null,
      },
    )
  }

  const headerInputLabel = isTextureExpansionMode
    ? 'Source'
    : isActionAnimatorMode || isLootLevelerMode || isPortraitStudioMode
      ? 'Image'
      : isVfxForgeMode
        ? 'Config'
        : 'Prompt'
  const controlPanelTitle = isCharacterSheetMode
    ? 'Sheet settings'
    : isActionAnimatorMode
      ? 'Animator settings'
      : isLootLevelerMode
        ? 'Leveler settings'
        : isPortraitStudioMode
          ? 'Portrait settings'
          : isVfxForgeMode
            ? 'VFX settings'
            : 'Forge settings'
  const primaryActionLabel = isForging
    ? isActionAnimatorMode
      ? 'ANIMATING'
      : isCharacterSheetMode
        ? 'BUILDING SHEET'
        : isLootLevelerMode
          ? 'LEVELING LOOT'
          : isPortraitStudioMode
            ? 'BUILDING PORTRAITS'
            : isTextureExpansionMode
              ? 'EXPANDING TEXTURE'
              : isVfxForgeMode
                ? 'FORGING VFX'
                : 'FORGING'
    : isActionAnimatorMode
      ? 'ANIMATE'
      : isCharacterSheetMode
        ? 'BUILD SHEET'
        : isLootLevelerMode
          ? 'LEVEL LOOT'
          : isPortraitStudioMode
            ? 'BUILD PORTRAITS'
            : isTextureExpansionMode
              ? 'EXPAND TEXTURE'
              : isVfxForgeMode
                ? 'FORGE VFX'
                : 'FORGE'
  const primaryActionDescription = isForging
    ? isActionAnimatorMode
      ? 'Sending character image to Veo and building a spritesheet'
      : isCharacterSheetMode
        ? 'Sending character sheet request to Gemini'
        : isLootLevelerMode
          ? 'Applying rarity upgrade pass to the base asset'
          : isPortraitStudioMode
            ? 'Generating a locked five-expression portrait sheet'
            : isTextureExpansionMode
              ? 'Sending centered outpaint canvas to Gemini 3 Pro'
              : isVfxForgeMode
                ? `Generating a ${state.vfxForge.frameCount}-frame projectile spritesheet`
                : 'Sending prompt and references to Gemini'
    : !selectedModelSupported
      ? 'Selected model is not supported for this tab'
      : isReadyForApi
        ? isActionAnimatorMode
          ? 'Character image staged for Veo animation'
          : isLootLevelerMode
            ? 'Base asset staged for rarity upgrade'
              : isPortraitStudioMode
                ? 'Hero image staged for expression pack generation'
                : isTextureExpansionMode
                  ? 'Centered source canvas staged for outpaint execution'
                  : isVfxForgeMode
                    ? `Projectile sheet request staged for ${state.vfxForge.frameCount} frames`
                    : 'Request staged for API execution'
        : isCharacterSheetMode
          ? 'Attach all required references or write a manifest'
          : isActionAnimatorMode
            ? 'Attach a character image and choose an action'
            : isLootLevelerMode
              ? 'Attach a base asset to begin rarity leveling'
              : isPortraitStudioMode
                ? 'Attach a hero portrait or reuse the latest character sheet'
                : isTextureExpansionMode
                  ? 'Attach a source texture to prepare the expansion pass'
                  : isVfxForgeMode
                    ? 'Enter a projectile type to prepare the VFX spritesheet request'
                    : 'Add a prompt to prepare the request'
  const readinessLabel = isForging
    ? isTextureExpansionMode
      ? 'Source processing'
      : isActionAnimatorMode
        ? 'Animating'
        : 'Generating'
    : isReadyForApi
      ? isTextureExpansionMode
        ? 'Source ready'
        : isActionAnimatorMode
          ? 'Animation ready'
          : isVfxForgeMode
            ? 'Config ready'
            : 'Prompt ready'
      : isTextureExpansionMode
        ? 'Source required'
        : isActionAnimatorMode || isLootLevelerMode || isPortraitStudioMode
          ? 'Image required'
          : isVfxForgeMode
            ? 'Config required'
            : 'Prompt required'
  const resultGridTitle = isCharacterSheetMode
    ? 'Character sheet output slot'
    : isActionAnimatorMode
      ? 'Action Animator sprite sheet'
      : isLootLevelerMode
        ? 'Loot Leveler output slot'
        : isPortraitStudioMode
          ? 'Portrait Studio contact sheet'
          : isVfxForgeMode
            ? 'VFX Forge spritesheet output'
            : 'Output slots for the current forge pass'

  return (
    <div className="min-h-screen bg-[var(--surface-0)] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[-12%] size-[36rem] rounded-full bg-sky-500/8 blur-[140px]" />
        <div className="absolute bottom-[-18%] right-[-8%] size-[34rem] rounded-full bg-cyan-400/6 blur-[160px]" />
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-[1720px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <div className="flex flex-1 flex-col overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] shadow-[0_40px_140px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <header className="border-b border-white/10 px-5 py-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6">
              <HeaderSummary
                activeMode={activeMode}
                currentSessionCount={currentSessionCount}
                generationCount={activeGenerationCount}
                highlightedTelemetryRowId={highlightedTelemetryRowId}
                inputLabel={headerInputLabel}
                promptLoaded={isReadyForApi}
                sessionMax={sessionMax}
                telemetryError={telemetryError}
                telemetrySnapshot={telemetrySnapshot}
              />
              <nav className="flex flex-wrap gap-3">
                {(Object.entries(modeDefinitions) as [ForgeMode, ModeDefinition][]).map(
                  ([modeKey, mode]) => {
                    const TabIcon = mode.icon
                    const isActive = state.activeMode === modeKey

                    return (
                      <button
                        key={modeKey}
                        type="button"
                        onClick={() => dispatch({ type: 'set-mode', mode: modeKey })}
                        className={`inline-flex min-w-[13rem] items-center gap-3 rounded-full border px-4 py-3 text-left transition duration-200 ${
                          isActive
                            ? 'border-sky-300/35 bg-sky-400/12 text-white shadow-[0_10px_30px_rgba(56,189,248,0.14)]'
                            : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.055] hover:text-zinc-200'
                        }`}
                      >
                        <span
                          className={`rounded-full border p-2 ${
                            isActive
                              ? 'border-sky-300/30 bg-sky-300/12 text-sky-200'
                              : 'border-white/10 bg-black/20 text-zinc-400'
                          }`}
                        >
                          <TabIcon className="size-4" strokeWidth={1.8} />
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{mode.label}</span>
                          <span className="block font-mono text-[10px] uppercase tracking-[0.28em] opacity-70">
                            {mode.eyebrow}
                          </span>
                        </span>
                      </button>
                    )
                  },
                )}
              </nav>
            </div>
          </header>

          <div className="grid flex-1 gap-5 p-4 lg:grid-cols-[400px_minmax(0,1fr)] lg:p-6">
            <aside className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-[18px] border border-white/10 bg-black/20 p-3 text-zinc-200">
                  <SlidersHorizontal className="size-5" strokeWidth={1.7} />
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                    Control Panel
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {controlPanelTitle}
                  </h2>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                <ModelSelector
                  activeModel={activeModel}
                  availableModels={modeAvailableModels}
                  onSelect={handleModelSelect}
                />

                {!(isActionAnimatorMode ||
                  isLootLevelerMode ||
                  isPortraitStudioMode ||
                  isVfxForgeMode) ? (
                  <StyleInputPanel
                    value={activeStyleInput}
                    onChange={handleStyleInputChange}
                  />
                ) : null}

                {!selectedModelSupported ? (
                  <div className="rounded-[20px] border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    {MODEL_LABELS[activeModel]} is not supported in {activeMode.label}.
                    Choose one of the available models to continue.
                  </div>
                ) : null}

                {isCharacterSheetMode ? (
                  <CharacterSheetPanel
                    generationMode={state.characterSheet.generationMode}
                    manifestPrompt={state.characterSheet.manifestPrompt}
                    parentId={state.characterSheet.parentId}
                    recentPrompts={recentPrompts}
                    referencePrompt={state.characterSheet.referencePrompt}
                    references={state.characterSheet.references}
                    consistencyEnabled={state.characterSheet.consistencyEnabled}
                    onConsistencyChange={(enabled) =>
                      dispatch({
                        type: 'set-character-sheet-consistency',
                        enabled,
                      })
                    }
                    onGenerationModeChange={(mode) =>
                      dispatch({ type: 'set-character-sheet-mode', mode })
                    }
                    onManifestChange={(prompt) =>
                      dispatch({ type: 'set-character-sheet-manifest', prompt })
                    }
                    onReferenceChange={(slot, asset) =>
                      dispatch({
                        type: 'set-character-sheet-reference',
                        slot,
                        asset,
                      })
                    }
                    onReferencePromptChange={(prompt) =>
                      dispatch({
                        type: 'set-character-sheet-reference-prompt',
                        prompt,
                      })
                    }
                  />
                ) : isActionAnimatorMode ? (
                  <ActionAnimatorPanel
                    actionType={state.actionAnimator.actionType}
                    asset={state.actionAnimator.characterImage}
                    canUseLatestCharacterSheet={Boolean(lastCharacterSheetResult)}
                    customActionPrompt={state.actionAnimator.customActionPrompt}
                    frameCount={state.actionAnimator.frameCount}
                    fps={state.actionAnimator.fps}
                    spriteSheetDataUrl={
                      lastResultMode === 'action-animator' ? results[0]?.dataUrl ?? null : null
                    }
                    onActionTypeChange={(actionType) =>
                      dispatch({ type: 'set-action-animator-action', actionType })
                    }
                    onCustomActionPromptChange={(prompt) =>
                      dispatch({
                        type: 'set-action-animator-custom-prompt',
                        prompt,
                      })
                    }
                    onFileSelect={(asset) =>
                      dispatch({ type: 'set-action-animator-image', asset })
                    }
                    onFrameCountChange={(frameCount) =>
                      dispatch({ type: 'set-action-animator-frame-count', frameCount })
                    }
                    onFpsChange={(fps) =>
                      dispatch({ type: 'set-action-animator-fps', fps })
                    }
                    onUseLatestCharacterSheet={() =>
                      void hydrateLatestCharacterSheetInto({
                        type: 'set-action-animator-image',
                      })
                    }
                  />
                ) : isLootLevelerMode ? (
                  <LootLevelerPanel
                    asset={state.lootLeveler.baseAsset}
                    rarity={state.lootLeveler.rarity}
                    onFileSelect={(asset) =>
                      dispatch({ type: 'set-loot-leveler-asset', asset })
                    }
                    onRarityChange={(rarity) =>
                      dispatch({ type: 'set-loot-leveler-rarity', rarity })
                    }
                  />
                ) : isPortraitStudioMode ? (
                  <>
                    <PortraitStudioPanel
                      asset={state.portraitStudio.heroImage}
                      canUseLatestCharacterSheet={Boolean(lastCharacterSheetResult)}
                      onFileSelect={(asset) =>
                        dispatch({ type: 'set-portrait-studio-image', asset })
                      }
                      onUseLatestCharacterSheet={() =>
                        void hydrateLatestCharacterSheetInto({
                          type: 'set-portrait-studio-image',
                        })
                      }
                    />
                    <PromptPanel
                      activeMode={state.activeMode}
                      description="Optional. Describe the portrait pack you want while keeping the uploaded identity locked."
                      placeholder="Ex: scarred veteran ranger, leather mantle, stern heroic mood, semi-real painted game portrait."
                      prompt={state.portraitStudio.prompt}
                      recentPrompts={recentPrompts}
                      title="Portrait Direction"
                      onChange={(prompt) =>
                        dispatch({ type: 'set-portrait-studio-prompt', prompt })
                      }
                    />
                  </>
                ) : isVfxForgeMode ? (
                  <VfxForgePanel
                    frameCount={state.vfxForge.frameCount}
                    intensity={state.vfxForge.intensity}
                    onFrameCountChange={(frameCount) =>
                      dispatch({ type: 'set-vfx-frame-count', frameCount })
                    }
                    projectileType={state.vfxForge.projectileType}
                    onIntensityChange={(intensity) =>
                      dispatch({ type: 'set-vfx-intensity', intensity })
                    }
                    onPromptChange={(prompt) =>
                      dispatch({ type: 'set-vfx-prompt', prompt })
                    }
                    onProjectileTypeChange={(projectileType) =>
                      dispatch({ type: 'set-vfx-projectile-type', projectileType })
                    }
                    prompt={state.vfxForge.prompt}
                  />
                ) : (
                  <>
                    {isTextureLabMode ? (
                      <TextureLabWorkflowPanel
                        expansionTargetSize={state.textureLab.expansionTargetSize}
                        onSeamlessModeChange={(enabled) =>
                          dispatch({
                            type: 'set-texture-lab-seamless-mode',
                            enabled,
                          })
                        }
                        onTargetSizeChange={(size) =>
                          dispatch({ type: 'set-texture-expansion-target-size', size })
                        }
                        onWorkflowChange={(workflow) =>
                          dispatch({ type: 'set-texture-lab-workflow', workflow })
                        }
                        seamlessMode={state.textureLab.seamlessMode}
                        workflow={state.textureLab.workflow}
                      />
                    ) : null}

                    <PromptPanel
                      activeMode={state.activeMode}
                      description={
                        isTextureExpansionMode
                          ? 'Optional material notes. The centered source texture drives the expansion pass even if this field is blank.'
                          : isTextureGenerateMode && state.textureLab.seamlessMode
                            ? 'Describe the material. Seamless Mode converts this into a tile-safe semantic tiling prompt.'
                          : 'Describe the asset or scene you want generated'
                      }
                      placeholder={
                        isTextureExpansionMode
                          ? 'Ex: weathered brick with subtle mortar variation and dry, neutral lighting.'
                          : undefined
                      }
                      prompt={state.prompt}
                      recentPrompts={recentPrompts}
                      title={
                        isTextureExpansionMode ? 'Expansion Notes' : 'Forge Prompt'
                      }
                      onChange={(prompt) => dispatch({ type: 'set-prompt', prompt })}
                    />

                    {isTextureExpansionMode ? (
                      <TextureExpansionPanel
                        asset={state.textureLab.expansionSource}
                        targetSize={state.textureLab.expansionTargetSize}
                        onFileSelect={(asset) =>
                          dispatch({ type: 'set-texture-expansion-source', asset })
                        }
                      />
                    ) : (
                      <>
                        <ImageUploadField
                          label="Style Reference"
                          helper="Controls line weight, finish, palette, and rendering language."
                          asset={state.references.style}
                          icon={Palette}
                          onFileSelect={(asset) =>
                            dispatch({ type: 'set-reference', slot: 'style', asset })
                          }
                        />

                        <ImageUploadField
                          label="Subject / Content Reference"
                          helper="Anchors silhouette, item identity, and the specific form to generate."
                          asset={state.references.subject}
                          icon={Box}
                          onFileSelect={(asset) =>
                            dispatch({ type: 'set-reference', slot: 'subject', asset })
                          }
                        />

                        <BatchPanel
                          generationCount={state.generationCount}
                          onSelect={(count) =>
                            dispatch({ type: 'set-generation-count', count })
                          }
                        />
                      </>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void handleForge()}
                  disabled={
                    !isReadyForApi ||
                    isForging ||
                    !selectedModelSupported
                  }
                  className="inline-flex w-full items-center justify-between rounded-[24px] border border-sky-300/20 bg-[linear-gradient(135deg,rgba(56,189,248,0.2),rgba(10,14,20,0.92))] px-5 py-4 text-left shadow-[0_0_0_1px_rgba(125,211,252,0.08),0_22px_60px_rgba(14,165,233,0.18)] transition duration-200 hover:border-sky-200/30 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.12),0_28px_80px_rgba(14,165,233,0.24)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-sky-300/20 disabled:hover:shadow-[0_0_0_1px_rgba(125,211,252,0.08),0_22px_60px_rgba(14,165,233,0.18)]"
                >
                  <span className="flex items-center gap-3">
                    <span className="rounded-full border border-sky-200/20 bg-sky-300/12 p-2 text-sky-100">
                      {isForging ? (
                        <LoaderCircle className="size-4 animate-spin" strokeWidth={1.9} />
                      ) : (
                        <Sparkles className="size-4" strokeWidth={1.9} />
                      )}
                    </span>
                    <span>
                      <span className="block text-sm font-medium tracking-[0.18em] text-sky-50">
                        {primaryActionLabel}
                      </span>
                      <span className="block text-xs text-sky-100/70">
                        {primaryActionDescription}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="size-5 text-sky-100/80" strokeWidth={1.9} />
                </button>
              </div>
            </aside>

            <section className="flex min-w-0 flex-col gap-5">
              <TopPanel
                activeMode={activeMode}
                prompt={activePromptValue.trim() || promptPreview}
                readinessLabel={readinessLabel}
              />

              <div className="flex flex-col gap-4 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                      Result Grid
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-white">
                      {resultGridTitle}
                    </h2>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-zinc-300">
                    <ImagePlus className="size-4" strokeWidth={1.8} />
                    {activeModelName
                      ? `${activeModelName} response stream`
                      : 'Ready for Gemini execution'}
                  </div>
                </div>

                {error ? (
                  <ErrorPanel
                    error={error}
                    onUseMock={error.code === 'quota_exceeded' ? handleMockForge : undefined}
                    onRetry={isReadyForApi && !isForging ? () => void handleForge() : undefined}
                  />
                ) : null}

                {notice ? (
                  <div className="rounded-[22px] border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    {notice}
                  </div>
                ) : null}

                <ForgeBrief
                  activeMode={activeMode}
                  activeModelName={activeModelName}
                  detailItems={briefItems}
                  generationCount={activeGenerationCount}
                  isForging={isForging}
                  isReadyForApi={isReadyForApi}
                  isShowingResults={isShowingResults}
                  lastSavedAt={lastSavedAt}
                  onRefreshHealth={() => void refreshHealth()}
                  prompt={activePromptValue.trim()}
                  referenceCount={referenceCount}
                  resultsCount={results.length}
                  serviceHealth={serviceHealth}
                  consistencyMessage={
                    isCharacterSheetMode && state.characterSheet.consistencyEnabled
                      ? state.characterSheet.parentId
                        ? `Consistency token staged locally: ${state.characterSheet.parentId}.`
                        : 'Consistency is enabled. The next successful sheet will stage a reusable token locally.'
                      : null
                  }
                />

                <div
                  className={
                    isSingleResultMode
                      ? 'grid gap-4'
                      : 'grid gap-4 md:grid-cols-2 2xl:grid-cols-4'
                  }
                >
                  {isShowingResults
                    ? results.map((result, index) => (
                        <GeneratedResultCard
                          key={result.id}
                          canRepairSeams={
                            isTextureLabMode &&
                            lastTextureLabRun?.seamlessMode === true &&
                            lastTextureLabRun.workflow === 'generate'
                          }
                          extraActionLabel={
                            isPortraitStudioMode
                              ? 'Download Faces'
                              : isVfxForgeMode
                                ? 'Download Frames'
                                : undefined
                          }
                          index={index}
                          isRepairing={repairingResultId === result.id}
                          mode={activeMode}
                          result={result}
                          onCopy={handleCopy}
                          onDownload={handleDownload}
                          onExtraAction={
                            isPortraitStudioMode
                              ? handleDownloadPortraitFaces
                              : isVfxForgeMode
                                ? handleDownloadVfxFrames
                              : undefined
                          }
                          onRepairSeams={handleRepairSeams}
                          showTilePreview={
                            isTextureLabMode &&
                            lastTextureLabRun?.seamlessMode === true
                          }
                        />
                      ))
                    : reservedOutputs.map((index) => (
                        <PlaceholderCard
                          key={index}
                          index={index}
                          mode={activeMode}
                          state={isForging ? 'loading' : 'idle'}
                        />
                      ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

type HeaderSummaryProps = {
  activeMode: ModeDefinition
  currentSessionCount: number
  generationCount: number
  highlightedTelemetryRowId: string | null
  inputLabel: string
  promptLoaded: boolean
  sessionMax: number
  telemetryError: string | null
  telemetrySnapshot: TelemetrySnapshot | null
}

function HeaderSummary({
  activeMode,
  currentSessionCount,
  generationCount,
  highlightedTelemetryRowId,
  inputLabel,
  promptLoaded,
  sessionMax,
  telemetryError,
  telemetrySnapshot,
}: HeaderSummaryProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] xl:items-start">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4 text-sky-300 shadow-[0_16px_30px_rgba(14,165,233,0.12)]">
          <div className="flex items-start gap-4">
            <Hammer className="size-6" strokeWidth={1.7} />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.42em] text-sky-300/70">
                Workspace
              </p>
              <h1 className="mt-3 max-w-5xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl xl:text-[3.75rem] xl:leading-[1.02]">
                The Foundry
              </h1>
            </div>
          </div>
        </div>
        <TelemetryStatusCard
          currentSessionCount={currentSessionCount}
          sessionMax={sessionMax}
          telemetryError={telemetryError}
          telemetrySnapshot={telemetrySnapshot}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Mode" value={activeMode.label} />
        <MetricCard label={inputLabel} value={promptLoaded ? 'Loaded' : 'Missing'} />
        <MetricCard label="Batch Count" value={`${generationCount} outputs`} />
      </div>

      <TelemetryTableCard
        highlightedTelemetryRowId={highlightedTelemetryRowId}
        telemetryError={telemetryError}
        telemetrySnapshot={telemetrySnapshot}
      />
    </div>
  )
}

type TelemetryStatusCardProps = {
  currentSessionCount: number
  sessionMax: number
  telemetryError: string | null
  telemetrySnapshot: TelemetrySnapshot | null
}

function TelemetryStatusCard({
  currentSessionCount,
  sessionMax,
  telemetryError,
  telemetrySnapshot,
}: TelemetryStatusCardProps) {
  return (
    <section className="self-start rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,9,12,0.88),rgba(7,9,12,0.96))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            Live Telemetry
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            Auto-refreshing model usage against the limits from your AI Studio snapshot.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-300">
          {telemetrySnapshot
            ? telemetrySnapshot.source === 'google-cloud-monitoring'
              ? `Google ${new Date(telemetrySnapshot.generatedAt).toLocaleTimeString()}`
              : `Updated ${new Date(telemetrySnapshot.generatedAt).toLocaleTimeString()}`
            : telemetryError
              ? 'Google blocked'
              : 'Telemetry offline'}
        </span>
      </div>

      {telemetryError ? (
        <div className="mt-4 whitespace-pre-line rounded-[16px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          {telemetryError}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs lg:grid-cols-3">
        <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="font-mono uppercase tracking-[0.2em] text-zinc-500">Session</p>
          <p className="mt-1 text-zinc-100">{currentSessionCount} req</p>
        </div>
        <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="font-mono uppercase tracking-[0.2em] text-zinc-500">24h Peak</p>
          <p className="mt-1 text-zinc-100">
            {sessionMax} req
          </p>
        </div>
        <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="font-mono uppercase tracking-[0.2em] text-zinc-500">Source</p>
          <p className="mt-1 text-zinc-100">
            {telemetrySnapshot?.source === 'google-cloud-monitoring'
              ? 'Google'
              : telemetrySnapshot
                ? 'Local'
                : 'Unavailable'}
          </p>
        </div>
      </div>
    </section>
  )
}

type TelemetryTableCardProps = {
  highlightedTelemetryRowId: string | null
  telemetryError: string | null
  telemetrySnapshot: TelemetrySnapshot | null
}

function TelemetryTableCard({
  highlightedTelemetryRowId,
  telemetryError,
  telemetrySnapshot,
}: TelemetryTableCardProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(4,8,12,0.88),rgba(3,6,9,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-5">
      <div className="flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            Model Limits
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Requests per minute and per day update live
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            RPM and RPD numbers shift from green to red as usage climbs. TPM uses live
            token totals when Gemini returns usage metadata.
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          {telemetrySnapshot
            ? telemetrySnapshot.source === 'google-cloud-monitoring'
              ? `Google refresh ${new Date(telemetrySnapshot.generatedAt).toLocaleTimeString()}`
              : `Local refresh ${new Date(telemetrySnapshot.generatedAt).toLocaleTimeString()}`
            : 'Waiting for telemetry'}
        </p>
      </div>

      {telemetryError ? (
        <div className="mt-4 whitespace-pre-line rounded-[18px] border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          Google telemetry is configured but not returning quota data. {telemetryError}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[1120px]">
          <div className="grid grid-cols-[minmax(260px,1.3fr)_minmax(220px,0.9fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_88px] gap-4 px-3 pb-3 text-[11px] font-medium uppercase tracking-[0.28em] text-zinc-500">
            <span>Model</span>
            <span>Category</span>
            <span>RPM</span>
            <span>TPM</span>
            <span>RPD</span>
            <span className="text-right">Charts</span>
          </div>

          <div className="space-y-2">
            {telemetrySnapshot?.rows.map((row) => {
              const isHighlighted = row.id === highlightedTelemetryRowId

              return (
                <div
                  key={row.id}
                  className={`grid grid-cols-[minmax(260px,1.3fr)_minmax(220px,0.9fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_88px] gap-4 rounded-[22px] border px-3 py-3 transition ${
                    isHighlighted
                      ? 'border-sky-300/25 bg-sky-400/[0.08] shadow-[0_12px_30px_rgba(56,189,248,0.08)]'
                      : 'border-white/8 bg-white/[0.02]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium text-zinc-100">{row.label}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {row.lastRequestAt
                        ? `Last request ${new Date(row.lastRequestAt).toLocaleTimeString()}`
                        : 'No requests recorded yet'}
                    </p>
                  </div>
                  <div className="flex items-center text-sm text-zinc-400">{row.category}</div>
                  <TelemetryMetricCell metric={row.metrics.rpm} />
                  <TelemetryMetricCell metric={row.metrics.tpm} />
                  <TelemetryMetricCell metric={row.metrics.rpd} />
                  <div className="flex items-center justify-end">
                    <TelemetryMiniChart
                      accentRatio={
                        Math.max(row.metrics.rpm.ratio ?? 0, row.metrics.rpd.ratio ?? 0)
                      }
                      points={row.chartPoints}
                    />
                  </div>
                </div>
              )
            })}

            {!telemetrySnapshot ? (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-zinc-500">
                Live telemetry is unavailable right now.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function TelemetryMetricCell({ metric }: { metric?: TelemetryMetric | null }) {
  if (!metric) {
    return <div className="flex items-center text-sm font-medium text-zinc-500">N/A</div>
  }

  if (
    typeof metric.current !== 'number' ||
    typeof metric.limit !== 'number' ||
    typeof metric.ratio !== 'number'
  ) {
    return <div className="flex items-center text-sm font-medium text-zinc-500">N/A</div>
  }

  const accentColor = buildTelemetryAccentColor(metric.ratio)
  const barWidth =
    metric.current > 0 ? Math.max(metric.ratio * 100, 8) : Math.max(metric.ratio * 100, 0)

  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-[5.5rem] overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            backgroundColor: accentColor,
            width: `${Math.min(barWidth, 100)}%`,
          }}
        />
      </div>
      <span
        className="min-w-[98px] text-right text-sm font-semibold tabular-nums"
        style={{ color: accentColor }}
      >
        {formatTelemetryMetricValue(metric.current)} / {formatTelemetryMetricValue(metric.limit)}
      </span>
    </div>
  )
}

function TelemetryMiniChart({
  accentRatio,
  points,
}: {
  accentRatio: number
  points: number[]
}) {
  const peak = Math.max(...points, 1)
  const accentColor = buildTelemetryAccentColor(accentRatio)

  return (
    <div className="flex h-9 items-end gap-1 rounded-full border border-white/8 bg-black/20 px-2 py-1">
      {points.map((point, index) => (
        <span
          key={`${index}-${point}`}
          className="w-1.5 rounded-full transition-all duration-300"
          style={{
            backgroundColor: accentColor,
            height: `${Math.max((point / peak) * 100, point > 0 ? 24 : 12)}%`,
            opacity: point > 0 ? 1 : 0.22,
          }}
        />
      ))}
    </div>
  )
}

function buildTelemetryAccentColor(ratio: number) {
  const clampedRatio = Math.max(0, Math.min(ratio, 1))
  const hue = 120 - clampedRatio * 120
  return `hsl(${hue} 82% 60%)`
}

function formatTelemetryMetricValue(value: number) {
  if (value >= 1000000) {
    return `${trimTrailingZeros((value / 1000000).toFixed(value < 10000000 ? 2 : 1))}M`
  }

  if (value >= 1000) {
    const fractionDigits = value < 10000 ? 2 : value < 100000 ? 1 : 0
    return `${trimTrailingZeros((value / 1000).toFixed(fractionDigits))}K`
  }

  return value.toLocaleString()
}

function trimTrailingZeros(value: string) {
  return value.replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')
}

type MetricCardProps = {
  label: string
  value: string
}

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  )
}

type ModelSelectorProps = {
  activeModel: ModelId
  availableModels: ModelId[]
  onSelect: (model: ModelId) => void
}

function ModelSelector({
  activeModel,
  availableModels,
  onSelect,
}: ModelSelectorProps) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          Model Override
        </p>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-400">
          Smart Default + Manual
        </span>
      </div>
      <div className="mt-3 inline-flex w-full gap-2 rounded-full border border-white/10 bg-white/[0.02] p-1.5">
        {availableModels.map((model) => {
          const isActive = activeModel === model

          return (
            <button
              key={model}
              type="button"
              onClick={() => onSelect(model)}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-medium transition ${
                isActive
                  ? 'border border-sky-300/35 bg-sky-400/14 text-sky-100'
                  : 'border border-transparent text-zinc-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              {MODEL_LABELS[model]}
            </button>
          )
        })}
      </div>
    </section>
  )
}

type StyleInputPanelProps = {
  onChange: (value: string) => void
  value: string
}

function StyleInputPanel({ value, onChange }: StyleInputPanelProps) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          Style Input
        </p>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-400">
          AI Orchestrated
        </span>
      </div>
      <div className="mt-3 space-y-2 rounded-[14px] border border-white/10 bg-white/[0.03] p-3">
        <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          Describe visual style
        </label>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ex: painterly dark fantasy with baroque ornament and heavy brush texture"
          className="w-full rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35"
        />
        <p className="text-xs text-zinc-400">
          This is injected into an AI-built best-practice prompt at request time.
        </p>
      </div>
    </section>
  )
}

type TextureLabWorkflowPanelProps = {
  expansionTargetSize: TextureExpansionTargetSize
  onSeamlessModeChange: (enabled: boolean) => void
  onTargetSizeChange: (size: TextureExpansionTargetSize) => void
  onWorkflowChange: (workflow: TextureLabWorkflow) => void
  seamlessMode: boolean
  workflow: TextureLabWorkflow
}

function TextureLabWorkflowPanel({
  expansionTargetSize,
  onSeamlessModeChange,
  onTargetSizeChange,
  onWorkflowChange,
  seamlessMode,
  workflow,
}: TextureLabWorkflowPanelProps) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            Texture Workflow
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            Switch between fresh texture generation and outpaint expansion.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400">
          Texture Lab
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ModeToggleButton
          icon={Sparkles}
          isActive={workflow === 'generate'}
          label="Generate"
          onClick={() => onWorkflowChange('generate')}
        />
        <ModeToggleButton
          icon={ImagePlus}
          isActive={workflow === 'expand'}
          label="Expand"
          onClick={() => onWorkflowChange('expand')}
        />
      </div>

      <button
        type="button"
        onClick={() => onSeamlessModeChange(!seamlessMode)}
        className={`mt-4 flex w-full items-center justify-between rounded-[20px] border px-4 py-3 text-left transition ${
          seamlessMode
            ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-50'
            : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05]'
        }`}
      >
        <span>
          <span className="block text-sm font-medium">Seamless Mode</span>
          <span className="mt-1 block text-xs leading-5 text-current/70">
            Adds tile-safe texture tags, shows a 3x3 repeat preview, and enables seam repair.
          </span>
        </span>
        <span className="rounded-full border border-current/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.28em]">
          {seamlessMode ? 'On' : 'Off'}
        </span>
      </button>

      {workflow === 'expand' ? (
        <div className="mt-4 rounded-[22px] border border-emerald-300/20 bg-emerald-500/10 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-100/70">
            Expansion Strategy
          </p>
          <p className="mt-2 text-sm leading-6 text-emerald-50">
            The source texture is centered on a larger transparent canvas, then Gemini
            fills the outer space while keeping the final map tile-safe. This workflow
            routes through Gemini 3 Pro for the edit pass.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[1024, 2048].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() =>
                  onTargetSizeChange(size as TextureExpansionTargetSize)
                }
                className={`rounded-[18px] border px-3 py-3 text-left transition ${
                  expansionTargetSize === size
                    ? 'border-emerald-300/35 bg-emerald-400/12 text-emerald-50'
                    : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                <span className="block text-sm font-medium">{size} px canvas</span>
                <span className="mt-1 block text-xs leading-5 text-current/70">
                  Center the source in the inner 50% and outpaint the remaining area.
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

type TextureExpansionPanelProps = {
  asset: ReferenceAsset | null
  onFileSelect: (asset: ReferenceAsset | null) => void
  targetSize: TextureExpansionTargetSize
}

function TextureExpansionPanel({
  asset,
  onFileSelect,
  targetSize,
}: TextureExpansionPanelProps) {
  return (
    <section className="space-y-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <ImageUploadField
        label="Source Texture"
        helper="Required. This image is centered on a larger transparent canvas before Gemini expands the surrounding material."
        asset={asset}
        icon={ImagePlus}
        isRequired
        onFileSelect={onFileSelect}
      />

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          Outpaint Notes
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
          <li>The source is shrunk into the center 25% of the canvas area.</li>
          <li>Gemini receives both the centered canvas and the original texture as reference.</li>
          <li>New edges are instructed to match opposite sides so the expanded result still tiles cleanly.</li>
          <li>Target canvas: {targetSize} x {targetSize}.</li>
        </ul>
      </div>
    </section>
  )
}

type PromptPanelProps = {
  activeMode: ForgeMode
  description?: string
  onChange: (prompt: string) => void
  placeholder?: string
  prompt: string
  recentPrompts: string[]
  title?: string
}

function PromptPanel({
  activeMode,
  description = 'Describe the asset or scene you want generated',
  placeholder = 'Ex: Ornate steel longsword with obsidian inlay, readable silhouette, game-ready presentation.',
  prompt,
  onChange,
  recentPrompts,
  title = 'Forge Prompt',
}: PromptPanelProps) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            {title}
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            {description}
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400">
          {prompt.trim().length} chars
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <textarea
          value={prompt}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={6}
          className="w-full resize-none rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35 focus:bg-white/[0.05]"
        />

        <PromptActionButtons
          activeMode={activeMode}
          prompt={prompt}
          onChange={onChange}
        />

        <RecentPromptChips recentPrompts={recentPrompts} onSelect={onChange} />
      </div>
    </section>
  )
}

type CharacterSheetPanelProps = {
  consistencyEnabled: boolean
  generationMode: CharacterSheetGenerationMode
  manifestPrompt: string
  onConsistencyChange: (enabled: boolean) => void
  onGenerationModeChange: (mode: CharacterSheetGenerationMode) => void
  onManifestChange: (prompt: string) => void
  onReferenceChange: (
    slot: CharacterSheetReferenceSlot,
    asset: ReferenceAsset | null,
  ) => void
  onReferencePromptChange: (prompt: string) => void
  parentId: string | null
  recentPrompts: string[]
  referencePrompt: string
  references: Record<CharacterSheetReferenceSlot, ReferenceAsset | null>
}

function CharacterSheetPanel({
  consistencyEnabled,
  generationMode,
  manifestPrompt,
  onConsistencyChange,
  onGenerationModeChange,
  onManifestChange,
  onReferenceChange,
  onReferencePromptChange,
  parentId,
  recentPrompts,
  referencePrompt,
  references,
}: CharacterSheetPanelProps) {
  const activePrompt = generationMode === 'manifest' ? manifestPrompt : referencePrompt
  const handlePromptChange =
    generationMode === 'manifest' ? onManifestChange : onReferencePromptChange

  return (
    <section className="space-y-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            Character Sheet
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            Switch between guided references and a full written manifest
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400">
          {activePrompt.trim().length} chars
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ModeToggleButton
          icon={Sparkles}
          isActive={generationMode === 'reference'}
          label="Reference"
          onClick={() => onGenerationModeChange('reference')}
        />
        <ModeToggleButton
          icon={FileText}
          isActive={generationMode === 'manifest'}
          label="Manifest"
          onClick={() => onGenerationModeChange('manifest')}
        />
      </div>

      <button
        type="button"
        onClick={() => onConsistencyChange(!consistencyEnabled)}
        className={`flex w-full items-center justify-between rounded-[20px] border px-4 py-3 text-left transition ${
          consistencyEnabled
            ? 'border-rose-300/30 bg-rose-400/10 text-rose-50'
            : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05]'
        }`}
      >
        <span className="flex items-center gap-3">
          <span
            className={`rounded-full border p-2 ${
              consistencyEnabled
                ? 'border-rose-200/20 bg-rose-300/12 text-rose-100'
                : 'border-white/10 bg-black/20 text-zinc-400'
            }`}
          >
            <Fingerprint className="size-4" strokeWidth={1.8} />
          </span>
          <span>
            <span className="block text-sm font-medium">Seed / Consistency</span>
            <span className="block text-xs text-current/70">
              {parentId
                ? `Local token staged: ${parentId}`
                : 'Stage the latest successful sheet token for the next request'}
            </span>
          </span>
        </span>
        <span className="rounded-full border border-current/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.28em]">
          {consistencyEnabled ? 'On' : 'Off'}
        </span>
      </button>

      {generationMode === 'reference' ? (
        <div className="space-y-4">
          <ImageUploadField
            label="Face"
            helper="Subject identity reference. Keeps face shape and primary identity locked."
            asset={references.face}
            icon={ScanFace}
            isRequired
            onFileSelect={(asset) => onReferenceChange('face', asset)}
          />
          <ImageUploadField
            label="Outfit"
            helper="Subject outfit or armor reference. Preserves clothing construction across views."
            asset={references.outfit}
            icon={Shirt}
            isRequired
            onFileSelect={(asset) => onReferenceChange('outfit', asset)}
          />
          <ImageUploadField
            label="Art Style"
            helper="Style reference. Controls line weight, cel shading, and coloring language."
            asset={references['art-style']}
            icon={SwatchBook}
            isRequired
            onFileSelect={(asset) => onReferenceChange('art-style', asset)}
          />

          <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Sheet Direction
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Optional text notes for attitude, body type, accessories, or extra callouts.
            </p>
            <textarea
              value={referencePrompt}
              onChange={(event) => onReferencePromptChange(event.target.value)}
              placeholder="Ex: frontier ranger, calm expression, layered utility belt, travel-worn boots, asymmetrical shoulder cape."
              rows={5}
              className="mt-4 w-full resize-none rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35 focus:bg-black/30"
            />
          </div>
        </div>
      ) : (
        <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            Character Manifest
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Write the full character brief. This becomes the primary instruction payload.
          </p>
          <textarea
            value={manifestPrompt}
            onChange={(event) => onManifestChange(event.target.value)}
            placeholder="Ex: Tall desert scout with a weathered half-cloak, segmented leather armor, sun-bleached wraps, utility charms, sharp nose bridge, and calm watchful expression."
            rows={9}
            className="mt-4 w-full resize-none rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35 focus:bg-black/30"
          />
        </div>
      )}

      <PromptActionButtons
        activeMode="character-sheet"
        prompt={activePrompt}
        onChange={handlePromptChange}
      />

      <RecentPromptChips recentPrompts={recentPrompts} onSelect={handlePromptChange} />
    </section>
  )
}

type ActionAnimatorPanelProps = {
  actionType: ActionAnimatorActionType
  asset: ReferenceAsset | null
  canUseLatestCharacterSheet: boolean
  customActionPrompt: string
  frameCount: number
  fps: number
  onActionTypeChange: (actionType: ActionAnimatorActionType) => void
  onCustomActionPromptChange: (prompt: string) => void
  onFileSelect: (asset: ReferenceAsset | null) => void
  onFrameCountChange: (frameCount: number) => void
  onFpsChange: (fps: number) => void
  onUseLatestCharacterSheet: () => void
  spriteSheetDataUrl: string | null
}

function ActionAnimatorPanel({
  actionType,
  asset,
  canUseLatestCharacterSheet,
  customActionPrompt,
  frameCount,
  fps,
  onActionTypeChange,
  onCustomActionPromptChange,
  onFileSelect,
  onFrameCountChange,
  onFpsChange,
  onUseLatestCharacterSheet,
  spriteSheetDataUrl,
}: ActionAnimatorPanelProps) {
  const [frames, setFrames] = useState<string[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const animationSlug = actionType === 'custom' ? 'custom' : actionType

  useEffect(() => {
    let cancelled = false

    if (!spriteSheetDataUrl) {
      return () => {
        cancelled = true
      }
    }

    void sliceSpriteSheetFrames(spriteSheetDataUrl, frameCount)
      .then((nextFrames) => {
        if (!cancelled) {
          setFrames(nextFrames)
          setPreviewIndex(0)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFrames([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [frameCount, spriteSheetDataUrl])

  useEffect(() => {
    const activeFrames = spriteSheetDataUrl ? frames : []

    if (!isPlaying || activeFrames.length <= 1) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setPreviewIndex((previousIndex) => (previousIndex + 1) % activeFrames.length)
    }, Math.max(33, Math.round(1000 / Math.max(1, fps))))

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fps, frames, isPlaying, spriteSheetDataUrl])

  const activeFrames = spriteSheetDataUrl ? frames : []
  const frameSlots = activeFrames.length
    ? activeFrames.map((frame) => ({ dataUrl: frame, ready: true }))
    : Array.from({ length: frameCount }, () => ({ dataUrl: null, ready: false }))
  const currentFrame = activeFrames[previewIndex] ?? null

  function handleFrameDownload(frameDataUrl: string, frameIndex: number) {
    downloadDataUrl(
      frameDataUrl,
      `kizer-forge-action-animator-${animationSlug}-frame-${String(frameIndex + 1).padStart(2, '0')}.png`,
    )
  }

  function handleDownloadAllFrames() {
    activeFrames.forEach((frameDataUrl, frameIndex) => {
      window.setTimeout(() => {
        handleFrameDownload(frameDataUrl, frameIndex)
      }, frameIndex * 120)
    })
  }

  return (
    <section className="space-y-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            Action Animator
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            Turn a locked character image into a spritesheet-ready motion strip.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400">
          {frameCount} frames / {fps} fps
        </div>
      </div>

      <ImageUploadField
        label="Character Image"
        helper="Upload a character render or sheet. This image is sent to Veo as the animation source."
        asset={asset}
        icon={ImagePlus}
        isRequired
        onFileSelect={onFileSelect}
      />

      <button
        type="button"
        disabled={!canUseLatestCharacterSheet}
        onClick={onUseLatestCharacterSheet}
        className="w-full rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Use Latest Character Sheet Result
      </button>

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          Action Type
        </label>
        <select
          value={actionType}
          onChange={(event) =>
            onActionTypeChange(event.target.value as ActionAnimatorActionType)
          }
          className="mt-3 w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-100 outline-none transition focus:border-sky-300/35"
        >
          {actionAnimatorActionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <textarea
          value={customActionPrompt}
          onChange={(event) => onCustomActionPromptChange(event.target.value)}
          placeholder={
            actionType === 'custom'
              ? 'Describe the exact motion cycle to animate.'
              : 'Optional guidance. Ex: heavier footfalls, stronger anticipation, aggressive lean, slower recovery.'
          }
          rows={4}
          className="mt-4 w-full resize-none rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35"
        />
        <p className="mt-3 text-xs leading-6 text-zinc-500">
          {actionType === 'custom'
            ? 'Required for Custom. Describe the motion cycle you want generated.'
            : 'Optional. Add notes to guide this preset action without replacing it.'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Frame Count
            </p>
            <span className="text-xs text-zinc-400">{frameCount}</span>
          </div>
          <input
            type="range"
            min={4}
            max={30}
            step={1}
            value={frameCount}
            onChange={(event) => onFrameCountChange(Number(event.target.value))}
            className="mt-4 w-full cursor-pointer accent-sky-400"
          />
        </div>

        <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Playback FPS
            </p>
            <span className="text-xs text-zinc-400">{fps}</span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={fps}
            onChange={(event) => onFpsChange(Number(event.target.value))}
            className="mt-4 w-full cursor-pointer accent-sky-400"
          />
          <p className="mt-3 text-xs leading-6 text-zinc-500">
            Controls the target animation timing and live preview speed.
          </p>
        </div>
      </div>

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Frame Strip
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              The returned spritesheet is sliced locally into preview frames. Use the tile download icons for full-size single PNG frames.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[20rem] lg:justify-end">
            <button
              type="button"
              disabled={!frames.length}
              onClick={() => setIsPlaying((currentValue) => !currentValue)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-100 transition hover:border-white/20 hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="size-4" strokeWidth={1.7} />
              {isPlaying ? 'Pause Preview' : 'Play Animation'}
            </button>
            <button
              type="button"
              disabled={!frames.length}
              onClick={handleDownloadAllFrames}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-100 transition hover:border-white/20 hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="size-4" strokeWidth={1.7} />
              Download All Frames
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {frameSlots.map((frame, index) => (
              <div
                key={`${index}-${frame.dataUrl ?? 'empty'}`}
                className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
              >
                {frame.dataUrl ? (
                  <>
                    <img
                      src={frame.dataUrl}
                      alt={`Animation frame ${index + 1}`}
                      className="h-full w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => handleFrameDownload(frame.dataUrl, index)}
                      className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full border border-black/30 bg-black/65 text-white transition hover:bg-black/80"
                      aria-label={`Download frame ${index + 1}`}
                    >
                      <Download className="size-3" strokeWidth={1.9} />
                    </button>
                    <span className="absolute bottom-1.5 left-1.5 rounded-full border border-black/30 bg-black/55 px-1.5 py-0.5 text-[10px] text-zinc-200">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-zinc-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-[20px] border border-white/10 bg-black/25 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            Live Preview
          </p>
          <div className="mt-3 flex aspect-square items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-black/30">
            {currentFrame ? (
              <img
                src={currentFrame}
                alt="Current animation frame preview"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-sm text-zinc-500">No frames generated yet</span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

type LootLevelerPanelProps = {
  asset: ReferenceAsset | null
  onFileSelect: (asset: ReferenceAsset | null) => void
  onRarityChange: (rarity: LootLevelerRarity) => void
  rarity: LootLevelerRarity
}

function LootLevelerPanel({
  asset,
  onFileSelect,
  onRarityChange,
  rarity,
}: LootLevelerPanelProps) {
  const rarityDescriptions: Record<LootLevelerRarity, string> = {
    common: 'Preserve the clean baseline asset without adding rarity effects.',
    rare: 'Minor engravings, subtle shine, and restrained premium detail.',
    epic: 'Glow treatment, material shift, and bold premium accents.',
    legendary: 'Elemental aura language, floating shards, and dramatic VFX.',
  }

  return (
    <section className="space-y-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <ImageUploadField
        label="Base Asset"
        helper="Upload the common or baseline item to evolve through rarity tiers."
        asset={asset}
        icon={Gem}
        isRequired
        onFileSelect={onFileSelect}
      />

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          Rarity Selector
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(['common', 'rare', 'epic', 'legendary'] as LootLevelerRarity[]).map(
            (option) => (
              <button
                key={option}
                type="button"
                onClick={() => onRarityChange(option)}
                className={`rounded-[18px] border px-3 py-3 text-left transition ${
                  rarity === option
                    ? 'border-amber-300/35 bg-amber-400/12 text-amber-50'
                    : 'border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:bg-black/30'
                }`}
              >
                <span className="block text-sm font-medium">
                  {formatRarityLabel(option)}
                </span>
                <span className="mt-1 block text-xs leading-5 text-current/70">
                  {rarityDescriptions[option]}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
    </section>
  )
}

type PortraitStudioPanelProps = {
  asset: ReferenceAsset | null
  canUseLatestCharacterSheet: boolean
  onFileSelect: (asset: ReferenceAsset | null) => void
  onUseLatestCharacterSheet: () => void
}

function PortraitStudioPanel({
  asset,
  canUseLatestCharacterSheet,
  onFileSelect,
  onUseLatestCharacterSheet,
}: PortraitStudioPanelProps) {
  return (
    <section className="space-y-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <ImageUploadField
        label="Hero Image"
        helper="Use a close-up hero portrait. Portrait Studio locks this identity across all expressions."
        asset={asset}
        icon={ScanFace}
        isRequired
        onFileSelect={onFileSelect}
      />

      <button
        type="button"
        disabled={!canUseLatestCharacterSheet}
        onClick={onUseLatestCharacterSheet}
        className="w-full rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Use Latest Character Sheet Result
      </button>

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-zinc-300">
        Portrait Studio generates a 3x2 contact sheet with five locked expressions:
        Neutral, Angry, Sad, Joy, and Surprised.
      </div>
    </section>
  )
}

type VfxForgePanelProps = {
  frameCount: number
  intensity: number
  onFrameCountChange: (frameCount: number) => void
  onIntensityChange: (intensity: number) => void
  onPromptChange: (prompt: string) => void
  onProjectileTypeChange: (projectileType: string) => void
  prompt: string
  projectileType: string
}

function VfxForgePanel({
  frameCount,
  intensity,
  onFrameCountChange,
  onIntensityChange,
  onPromptChange,
  onProjectileTypeChange,
  prompt,
  projectileType,
}: VfxForgePanelProps) {
  return (
    <section className="space-y-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          Projectile Type
        </label>
        <input
          type="text"
          value={projectileType}
          onChange={(event) => onProjectileTypeChange(event.target.value)}
          placeholder="Ex: Fireball, Plasma Lance, Frost Bolt"
          className="mt-3 w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35"
        />
      </div>

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          Behavior Steering
        </label>
        <p className="mt-2 text-sm text-zinc-400">
          Optional guidance for timing, arc shape, bursts, trail behavior, charge-up, or dissipation.
        </p>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Ex: slow charge-up, tight corkscrew trail, bright core at frame 5, then embers breaking apart by the final frame."
          rows={5}
          className="mt-4 w-full resize-none rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-sky-300/35 focus:bg-black/30"
        />
      </div>

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            Frames
          </p>
          <span className="text-xs text-zinc-400">{frameCount}</span>
        </div>
        <input
          type="range"
          min={4}
          max={30}
          step={1}
          value={frameCount}
          onChange={(event) => onFrameCountChange(Number(event.target.value))}
          className="mt-4 w-full cursor-pointer accent-sky-400"
        />
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Controls the width of the returned horizontal strip. Higher counts give smoother timing but wider sheets.
        </p>
      </div>

      <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            Intensity
          </p>
          <span className="text-xs text-zinc-400">{intensity}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={intensity}
          onChange={(event) => onIntensityChange(Number(event.target.value))}
          className="mt-4 w-full cursor-pointer accent-sky-400"
        />
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Output is constrained to a {frameCount}-frame horizontal strip on a pure black background for additive blending.
        </p>
      </div>
    </section>
  )
}

type ModeToggleButtonProps = {
  icon: typeof Sparkles
  isActive: boolean
  label: string
  onClick: () => void
}

function ModeToggleButton({
  icon: Icon,
  isActive,
  label,
  onClick,
}: ModeToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition ${
        isActive
          ? 'border-sky-300/30 bg-sky-400/12 text-white'
          : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.05] hover:text-zinc-200'
      }`}
    >
      <span
        className={`rounded-full border p-2 ${
          isActive
            ? 'border-sky-300/30 bg-sky-300/12 text-sky-200'
            : 'border-white/10 bg-black/20 text-zinc-400'
        }`}
      >
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}

type PromptActionButtonsProps = {
  activeMode: ForgeMode
  onChange: (prompt: string) => void
  prompt: string
}

function PromptActionButtons({
  activeMode,
  prompt,
  onChange,
}: PromptActionButtonsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange(enhancePrompt(prompt, activeMode))}
        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
      >
        <span className="block text-sm font-medium text-zinc-100">Enhance Prompt</span>
        <span className="mt-1 block text-xs leading-5 text-zinc-400">
          Tighten the current idea into a cleaner, more production-ready request.
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange(remixPrompt(prompt, activeMode))}
        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
      >
        <span className="block text-sm font-medium text-zinc-100">Remix Current</span>
        <span className="mt-1 block text-xs leading-5 text-zinc-400">
          Rewrite the same concept with a different presentation, mood, or materials.
        </span>
      </button>
    </div>
  )
}

type RecentPromptChipsProps = {
  onSelect: (prompt: string) => void
  recentPrompts: string[]
}

function RecentPromptChips({
  onSelect,
  recentPrompts,
}: RecentPromptChipsProps) {
  if (!recentPrompts.length) {
    return null
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
        Recent Prompts
      </p>
      <div className="flex flex-wrap gap-2">
        {recentPrompts.map((recentPrompt) => (
          <button
            key={recentPrompt}
            type="button"
            onClick={() => onSelect(recentPrompt)}
            className="max-w-full rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.04]"
          >
            <span className="block max-w-[15rem] truncate">{recentPrompt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

type BatchPanelProps = {
  generationCount: number
  onSelect: (count: number) => void
}

function BatchPanel({ generationCount, onSelect }: BatchPanelProps) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            Generation Count
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            {generationCount} candidate outputs
          </p>
        </div>
        <div className="rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 font-mono text-xs text-sky-200">
          1-4
        </div>
      </div>

      <div className="mt-5">
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={generationCount}
          onChange={(event) => onSelect(Number(event.target.value))}
          className="w-full cursor-pointer accent-sky-400"
        />
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onSelect(count)}
              className={`rounded-full border px-0 py-2 text-sm transition ${
                generationCount === count
                  ? 'border-sky-300/35 bg-sky-400/12 text-sky-100'
                  : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

type TopPanelProps = {
  activeMode: ModeDefinition
  prompt: string
  readinessLabel: string
}

function TopPanel({
  activeMode,
  prompt,
  readinessLabel,
}: TopPanelProps) {
  const ModeIcon = activeMode.icon

  return (
    <div
      className={`rounded-[30px] border border-white/10 bg-gradient-to-br ${activeMode.surfaceClassName} p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6`}
    >
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-400">
            <ModeIcon className="size-3.5" strokeWidth={1.8} />
            {activeMode.eyebrow}
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-[2rem]">
            {activeMode.label} prompt profile
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
            {activeMode.description}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label="Focus" value={activeMode.focus} />
          <MetricCard label="Readiness" value={readinessLabel} />
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-white/10 bg-black/20 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          Composed request preview
        </p>
        <p className="mt-3 font-mono text-sm leading-7 text-zinc-200">{prompt}</p>
      </div>
    </div>
  )
}

type ForgeBriefProps = {
  activeMode: ModeDefinition
  activeModelName: string | null
  consistencyMessage: string | null
  detailItems: ForgeBriefItem[]
  generationCount: number
  isForging: boolean
  isReadyForApi: boolean
  isShowingResults: boolean
  lastSavedAt: string | null
  onRefreshHealth: () => void
  prompt: string
  referenceCount: number
  resultsCount: number
  serviceHealth: ServiceHealth | null
}

function ForgeBrief({
  activeMode,
  activeModelName,
  consistencyMessage,
  detailItems,
  generationCount,
  isForging,
  isReadyForApi,
  isShowingResults,
  lastSavedAt,
  onRefreshHealth,
  prompt,
  referenceCount,
  resultsCount,
  serviceHealth,
}: ForgeBriefProps) {
  const description = isForging
    ? `The current prompt and ${referenceCount} reference ${
        referenceCount === 1 ? 'image' : 'images'
      } are being processed for ${generationCount} candidate ${
        generationCount === 1 ? 'output' : 'outputs'
      } in ${activeMode.label}.`
    : isShowingResults
      ? `The last forge pass returned ${resultsCount} candidate ${
          resultsCount === 1 ? 'image' : 'images'
        } for ${activeMode.label}.`
      : isReadyForApi
        ? `This pass will use the current prompt, ${referenceCount} reference ${
            referenceCount === 1 ? 'image' : 'images'
          }, and request ${generationCount} candidate ${
            generationCount === 1 ? 'output' : 'outputs'
          } in ${activeMode.label}.`
        : 'The forge route is wired, but the request is incomplete until you enter a prompt or complete the active sheet inputs.'

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
      <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          Forge Brief
        </p>
        <p className="mt-4 text-sm leading-7 text-zinc-300">{description}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 sm:col-span-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
              Prompt
            </p>
            <p className="mt-2 text-sm text-zinc-100">
              {prompt || 'No prompt entered yet'}
            </p>
          </div>
          {detailItems.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} />
          ))}
          {consistencyMessage ? (
            <div className="rounded-[22px] border border-rose-300/20 bg-rose-400/10 px-4 py-3 sm:col-span-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-rose-100/70">
                Consistency
              </p>
              <p className="mt-2 text-sm text-rose-50">{consistencyMessage}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          Gemini Status
        </p>
        <ul className="mt-4 space-y-3">
          <li className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
            Server route: {serviceHealth?.ok ? 'online' : 'status unavailable'}.
            {activeModelName ? ` Model: ${activeModelName}.` : ''}
          </li>
          <li className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
            API key: {serviceHealth?.keyConfigured ? 'configured on server.' : 'not detected on server.'}
          </li>
          <li className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
            If live Gemini is blocked, use mock forge outputs to keep iterating on layout, downloads, palette extraction, and review flow.
          </li>
          <li className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
            Last saved session: {lastSavedAt ? new Date(lastSavedAt).toLocaleString() : 'none yet'}.
          </li>
          <li className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
            Troubleshooting:{' '}
            <a
              href="https://ai.google.dev/gemini-api/docs/rate-limits"
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline decoration-sky-300/40 underline-offset-4"
            >
              rate limits
            </a>{' '}
            and{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline decoration-sky-300/40 underline-offset-4"
            >
              API key settings
            </a>
            .
          </li>
        </ul>
        <button
          type="button"
          onClick={onRefreshHealth}
          className="mt-4 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05]"
        >
          Refresh Gemini Status
        </button>
      </div>
    </div>
  )
}

type RawForgeError =
  | ForgeErrorInfo
  | Error
  | {
      code?: string
      details?: string[]
      message?: string
      retryAfterSeconds?: number
      title?: string
    }
  | string
  | unknown
  | null
  | undefined

function buildCharacterSheetBriefItems(
  state: typeof initialState,
): ForgeBriefItem[] {
  return [
    {
      label: 'Face Ref',
      value: state.characterSheet.references.face?.name ?? 'Not attached',
    },
    {
      label: 'Outfit Ref',
      value: state.characterSheet.references.outfit?.name ?? 'Not attached',
    },
    {
      label: 'Style Ref',
      value: state.characterSheet.references['art-style']?.name ?? 'Not attached',
    },
    {
      label: 'Mode',
      value:
        state.characterSheet.generationMode === 'manifest'
          ? 'Manifest'
          : 'Reference',
    },
  ]
}

function buildActionAnimatorBriefItems(
  state: typeof initialState,
): ForgeBriefItem[] {
  return [
    {
      label: 'Source',
      value: state.actionAnimator.characterImage?.name ?? 'Not attached',
    },
    {
      label: 'Action',
      value:
        state.actionAnimator.actionType === 'custom'
          ? state.actionAnimator.customActionPrompt.trim() || 'Custom'
          : state.actionAnimator.actionType,
    },
    {
      label: 'Frames',
      value: String(state.actionAnimator.frameCount),
    },
    {
      label: 'FPS',
      value: String(state.actionAnimator.fps),
    },
  ]
}

function buildLootLevelerBriefItems(
  state: typeof initialState,
): ForgeBriefItem[] {
  return [
    {
      label: 'Base Asset',
      value: state.lootLeveler.baseAsset?.name ?? 'Not attached',
    },
    {
      label: 'Rarity',
      value: formatRarityLabel(state.lootLeveler.rarity),
    },
  ]
}

function buildPortraitStudioBriefItems(
  state: typeof initialState,
): ForgeBriefItem[] {
  return [
    {
      label: 'Hero Image',
      value: state.portraitStudio.heroImage?.name ?? 'Not attached',
    },
    {
      label: 'Direction',
      value: state.portraitStudio.prompt.trim() || 'Default expression pack',
    },
    {
      label: 'Expressions',
      value: '5 locked portraits',
    },
  ]
}

function buildTextureExpansionBriefItems(
  state: typeof initialState,
): ForgeBriefItem[] {
  return [
    {
      label: 'Workflow',
      value: 'Expand Texture',
    },
    {
      label: 'Source',
      value: state.textureLab.expansionSource?.name ?? 'Not attached',
    },
    {
      label: 'Canvas',
      value: `${state.textureLab.expansionTargetSize} px`,
    },
  ]
}

function buildVfxForgeBriefItems(
  state: typeof initialState,
): ForgeBriefItem[] {
  return [
    {
      label: 'Projectile',
      value: state.vfxForge.projectileType.trim() || 'Not set',
    },
    {
      label: 'Direction',
      value: state.vfxForge.prompt.trim() || 'Default timing',
    },
    {
      label: 'Intensity',
      value: `${state.vfxForge.intensity}/100`,
    },
    {
      label: 'Layout',
      value: `${state.vfxForge.frameCount} x 1 strip`,
    },
  ]
}

function buildLootLevelerPromptPreview(rarity: LootLevelerRarity) {
  return [
    'Maintain the silhouette and core geometry of the input image.',
    `Apply ${formatRarityLabel(rarity)} visual upgrades while keeping the weapon type identical.`,
  ].join(' ')
}

function buildPortraitStudioPromptPreview(prompt: string) {
  const normalizedPrompt = prompt.trim()

  return [
    'Generate a 3 column by 2 row portrait sheet.',
    'Keep the facial structure, hair, and eye color 100% identical while shifting only expression.',
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function buildSeamlessPromptPreview(prompt: string, styleText: string) {
  const subject = prompt.trim() || 'weathered stone floor tile'
  const styleSegment = styleText.trim() ? styleText.trim() : 'neutral production texture'

  return (
    `Create a seamless repeating pattern of ${subject}. ` +
    'Ensure smooth transitions at the edges for flawless tiling. ' +
    `Style: ${styleSegment}, high resolution, perfectly tileable horizontal and vertical edges, balanced composition.`
  )
}

function buildVfxForgePromptPreview(
  projectileType: string,
  intensity: number,
  frameCount: number,
  prompt: string,
) {
  const normalizedProjectileType = projectileType.trim() || 'Fireball'
  const normalizedPrompt = prompt.trim()

  return [
    'Generate a 2D projectile spritesheet.',
    `Projectile: ${normalizedProjectileType}.`,
    `Intensity: ${Math.max(0, Math.min(100, Math.round(intensity)))}/100.`,
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
    `Background: pure #000000 black. Layout: ${Math.max(4, Math.min(30, Math.round(frameCount)))} frames in one horizontal row.`,
  ]
    .filter(Boolean)
    .join(' ')
}

function formatRarityLabel(rarity: LootLevelerRarity) {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1)
}

function slugifyFileSegment(value: string, fallback: string) {
  const normalizedValue = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalizedValue || fallback
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  return items.length > 0 ? items : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function enhancePrompt(prompt: string, activeMode: ForgeMode) {
  const concept = extractPromptConcept(prompt, activeMode)
  const archetype = detectPromptArchetype(concept, activeMode)

  return buildPromptVariant({
    activeMode,
    archetype,
    concept,
    variant: 'enhance',
  })
}

function remixPrompt(prompt: string, activeMode: ForgeMode) {
  const concept = extractPromptConcept(prompt, activeMode)
  const archetype = detectPromptArchetype(concept, activeMode)

  return buildPromptVariant({
    activeMode,
    archetype,
    concept,
    variant: 'remix',
  })
}

const starterPromptByMode: Record<ForgeMode, string> = {
  armory: 'forged steel warhammer with a readable silhouette',
  'action-animator': 'side-profile walk cycle for a 2D game sprite',
  'texture-lab': 'weathered basalt floor tile with subtle lava seams',
  'loot-leveler': 'legendary upgrade pass for a sword while keeping the silhouette identical',
  'portrait-studio': 'hero portrait expression sheet with locked identity',
  visualizer: 'battle-worn ranger portrait with layered leather armor',
  'vfx-forge': 'fireball projectile spritesheet with soft glowing edges',
  'character-sheet':
    'frontier ranger with layered leather armor and a weathered half-cloak',
}

function extractPromptConcept(prompt: string, activeMode: ForgeMode) {
  const trimmedPrompt = prompt
    .trim()
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')

  if (!trimmedPrompt) {
    return starterPromptByMode[activeMode]
  }

  const primarySegment = trimmedPrompt
    .split(/[,\n]/)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0)

  return primarySegment || starterPromptByMode[activeMode]
}

function pickTemplate<T>(templates: T[]): T {
  return templates[Math.floor(Math.random() * templates.length)]
}

type PromptVariant = 'enhance' | 'remix'
type PromptArchetype =
  | 'blade'
  | 'axe'
  | 'hammer'
  | 'shield'
  | 'ranged'
  | 'armor'
  | 'potion'
  | 'stone'
  | 'wood'
  | 'metal'
  | 'fabric'
  | 'terrain'
  | 'character'
  | 'environment'
  | 'creature'
  | 'prop'
  | 'adventurer'
  | 'soldier'
  | 'mage'
  | 'rogue'
  | 'general'

type PromptBuilderArgs = {
  activeMode: ForgeMode
  archetype: PromptArchetype
  concept: string
  variant: PromptVariant
}

const archetypeKeywordMap: Record<
  ForgeMode,
  Array<{ archetype: PromptArchetype; keywords: string[] }>
> = {
  armory: [
    { archetype: 'axe', keywords: ['axe', 'hatchet', 'battleaxe', 'greataxe', 'tomahawk'] },
    {
      archetype: 'blade',
      keywords: ['sword', 'blade', 'dagger', 'katana', 'saber', 'knife', 'longsword'],
    },
    { archetype: 'hammer', keywords: ['hammer', 'mace', 'maul', 'club', 'warhammer'] },
    { archetype: 'shield', keywords: ['shield', 'buckler', 'tower shield'] },
    {
      archetype: 'ranged',
      keywords: ['bow', 'crossbow', 'rifle', 'gun', 'pistol', 'staff', 'wand'],
    },
    {
      archetype: 'armor',
      keywords: [
        'armor',
        'helmet',
        'helm',
        'gauntlet',
        'greaves',
        'pauldron',
        'breastplate',
      ],
    },
    { archetype: 'potion', keywords: ['potion', 'bottle', 'flask', 'vial'] },
  ],
  'texture-lab': [
    { archetype: 'stone', keywords: ['stone', 'rock', 'basalt', 'granite', 'brick', 'masonry'] },
    { archetype: 'wood', keywords: ['wood', 'timber', 'plank', 'oak', 'bark'] },
    { archetype: 'metal', keywords: ['metal', 'steel', 'iron', 'bronze', 'copper', 'gold'] },
    { archetype: 'fabric', keywords: ['fabric', 'cloth', 'silk', 'canvas', 'leather', 'woven'] },
    {
      archetype: 'terrain',
      keywords: ['lava', 'sand', 'dirt', 'mud', 'snow', 'grass', 'ground', 'floor', 'tile'],
    },
  ],
  'action-animator': [
    {
      archetype: 'character',
      keywords: ['walk', 'run', 'attack', 'jump', 'idle', 'sprite', 'animation'],
    },
  ],
  'loot-leveler': [
    {
      archetype: 'blade',
      keywords: ['sword', 'blade', 'katana', 'dagger', 'axe', 'weapon', 'shield'],
    },
  ],
  'portrait-studio': [
    {
      archetype: 'character',
      keywords: ['portrait', 'expression', 'hero', 'face', 'emotion'],
    },
  ],
  visualizer: [
    {
      archetype: 'character',
      keywords: ['character', 'portrait', 'hero', 'warrior', 'mage', 'ranger', 'knight'],
    },
    {
      archetype: 'environment',
      keywords: ['environment', 'scene', 'landscape', 'city', 'hall', 'temple', 'forest'],
    },
    { archetype: 'creature', keywords: ['dragon', 'creature', 'monster', 'beast', 'wolf', 'bird'] },
    { archetype: 'prop', keywords: ['vehicle', 'ship', 'artifact', 'prop', 'relic', 'device'] },
  ],
  'character-sheet': [
    {
      archetype: 'adventurer',
      keywords: ['ranger', 'scout', 'traveler', 'hunter', 'explorer', 'adventurer'],
    },
    {
      archetype: 'soldier',
      keywords: ['knight', 'soldier', 'guard', 'paladin', 'mercenary', 'warrior'],
    },
    {
      archetype: 'mage',
      keywords: ['mage', 'wizard', 'sorcerer', 'witch', 'warlock', 'scholar'],
    },
    {
      archetype: 'rogue',
      keywords: ['rogue', 'assassin', 'thief', 'smuggler', 'duelist', 'spy'],
    },
    {
      archetype: 'character',
      keywords: ['character', 'hero', 'villain', 'pilot', 'nomad', 'leader'],
    },
  ],
  'vfx-forge': [
    {
      archetype: 'prop',
      keywords: ['fireball', 'plasma', 'bolt', 'projectile', 'magic', 'vfx'],
    },
  ],
}

const emptyProfile = { detail: [], enhance: [], remix: [] }

const armoryProfiles: Record<
  PromptArchetype,
  { detail: string[]; enhance: string[]; remix: string[] }
> = {
  blade: {
    detail: ['refined guard design', 'disciplined edge geometry', 'layered forged steel finish'],
    enhance: ['hero prop presentation', 'precise silhouette control', 'clean fantasy craftsmanship'],
    remix: ['alternate blade profile', 'different hilt treatment', 'fresh ornamental language'],
  },
  axe: {
    detail: ['bold head shape', 'weighted cutting profile', 'sturdy haft construction'],
    enhance: ['brutal readability', 'impact-focused proportions', 'strong material breakup'],
    remix: ['broader axe head', 'hooked silhouette accents', 'different wood-and-metal balance'],
  },
  hammer: {
    detail: ['dense striking head', 'reinforced grip structure', 'heavy mass distribution'],
    enhance: ['clear power read', 'thick silhouette logic', 'battle-ready construction'],
    remix: ['spiked striking surfaces', 'ceremonial face engraving', 'alternate counterweight design'],
  },
  shield: {
    detail: ['clean defensive profile', 'layered rim construction', 'readable emblem placement'],
    enhance: ['front-facing presentation', 'strong center motif', 'durable material layering'],
    remix: ['different crest language', 'new edge reinforcement pattern', 'alternate battle-wear treatment'],
  },
  ranged: {
    detail: ['functional grip spacing', 'clear tension points', 'readable mechanical details'],
    enhance: ['balanced long-form silhouette', 'precise secondary shapes', 'clean usability cues'],
    remix: ['different stock or limb shape', 'new trim language', 'alternate material emphasis'],
  },
  armor: {
    detail: ['layered protection shapes', 'functional fastening details', 'clear plate segmentation'],
    enhance: ['wearable construction logic', 'strong form hierarchy', 'premium crafted finish'],
    remix: ['different trim pattern', 'alternate protective layering', 'fresh ceremonial accents'],
  },
  potion: {
    detail: ['distinct bottle silhouette', 'readable stopper design', 'controlled liquid color story'],
    enhance: ['clean alchemy prop read', 'glass-and-metal contrast', 'collectible game-ready polish'],
    remix: ['new bottle proportions', 'different cap treatment', 'alternate magical finish'],
  },
  general: {
    detail: ['clean material breakup', 'readable secondary shapes', 'balanced visual weight'],
    enhance: ['strong prop presentation', 'clear silhouette', 'game-ready finish'],
    remix: ['alternate profile', 'fresh ornamentation', 'different wear pattern'],
  },
  stone: emptyProfile,
  wood: emptyProfile,
  metal: emptyProfile,
  fabric: emptyProfile,
  terrain: emptyProfile,
  character: emptyProfile,
  environment: emptyProfile,
  creature: emptyProfile,
  prop: emptyProfile,
  adventurer: emptyProfile,
  soldier: emptyProfile,
  mage: emptyProfile,
  rogue: emptyProfile,
}

const textureProfiles: Record<
  PromptArchetype,
  { detail: string[]; enhance: string[]; remix: string[] }
> = {
  stone: {
    detail: ['natural fracture rhythm', 'mineral variation', 'chiseled edge wear'],
    enhance: ['seamless repeat control', 'stable surface values', 'clear roughness breakup'],
    remix: ['wetter surface variation', 'different crack density', 'alternate erosion pattern'],
  },
  wood: {
    detail: ['grain direction clarity', 'fiber breakup', 'board-to-board variation'],
    enhance: ['tile-safe pattern flow', 'believable wear', 'clean surface readability'],
    remix: ['aged timber treatment', 'different stain temperature', 'alternate scratch rhythm'],
  },
  metal: {
    detail: ['panel seams', 'controlled oxidation', 'machined surface breakup'],
    enhance: ['readable specular structure', 'clean industrial repeat', 'balanced wear pattern'],
    remix: ['brushed finish variation', 'different corrosion spread', 'alternate plated treatment'],
  },
  fabric: {
    detail: ['weave definition', 'compression and stretch rhythm', 'subtle seam logic'],
    enhance: ['clean textile readability', 'repeat-safe folds', 'controlled value range'],
    remix: ['heavier weave treatment', 'different fiber softness', 'alternate stitched detail'],
  },
  terrain: {
    detail: ['ground breakup hierarchy', 'surface debris rhythm', 'clear depth layering'],
    enhance: ['top-down tile readability', 'repeat-safe composition', 'environment-ready contrast'],
    remix: ['different moisture level', 'alternate debris density', 'new color temperature shift'],
  },
  general: {
    detail: ['clean repeat rhythm', 'material identity clarity', 'balanced micro detail'],
    enhance: ['seamless tiling', 'production texture readability', 'stable value control'],
    remix: ['alternate wear pattern', 'different tonal balance', 'fresh surface variation'],
  },
  blade: emptyProfile,
  axe: emptyProfile,
  hammer: emptyProfile,
  shield: emptyProfile,
  ranged: emptyProfile,
  armor: emptyProfile,
  potion: emptyProfile,
  character: emptyProfile,
  environment: emptyProfile,
  creature: emptyProfile,
  prop: emptyProfile,
  adventurer: emptyProfile,
  soldier: emptyProfile,
  mage: emptyProfile,
  rogue: emptyProfile,
}

const visualizerProfiles: Record<
  PromptArchetype,
  { detail: string[]; enhance: string[]; remix: string[] }
> = {
  character: {
    detail: ['clear facial storytelling', 'layered costume materials', 'strong pose language'],
    enhance: ['cinematic portrait framing', 'premium lighting design', 'clean focal hierarchy'],
    remix: ['different emotional read', 'alternate lens mood', 'fresh costume emphasis'],
  },
  environment: {
    detail: ['deep spatial layering', 'architectural read', 'controlled atmospheric depth'],
    enhance: ['cinematic environment composition', 'clear focal path', 'premium world-building finish'],
    remix: ['different time-of-day lighting', 'alternate weather mood', 'fresh environmental storytelling'],
  },
  creature: {
    detail: ['clear anatomy read', 'layered surface materials', 'strong silhouette separation'],
    enhance: ['hero creature presentation', 'dramatic lighting control', 'high-impact visual storytelling'],
    remix: ['different temperament', 'alternate habitat influence', 'fresh lighting drama'],
  },
  prop: {
    detail: ['premium product framing', 'clear scale cues', 'intentional material hierarchy'],
    enhance: ['editorial visual development shot', 'clean presentation', 'high-end concept render finish'],
    remix: ['different camera treatment', 'alternate mood lighting', 'fresh display context'],
  },
  general: {
    detail: ['clear focal hierarchy', 'layered material rendering', 'intentional composition'],
    enhance: ['cinematic presentation', 'strong mood control', 'concept-art polish'],
    remix: ['different atmosphere', 'alternate lighting strategy', 'fresh dramatic read'],
  },
  blade: emptyProfile,
  axe: emptyProfile,
  hammer: emptyProfile,
  shield: emptyProfile,
  ranged: emptyProfile,
  armor: emptyProfile,
  potion: emptyProfile,
  stone: emptyProfile,
  wood: emptyProfile,
  metal: emptyProfile,
  fabric: emptyProfile,
  terrain: emptyProfile,
  adventurer: emptyProfile,
  soldier: emptyProfile,
  mage: emptyProfile,
  rogue: emptyProfile,
}

const characterSheetProfiles: Record<
  PromptArchetype,
  { detail: string[]; enhance: string[]; remix: string[] }
> = {
  adventurer: {
    detail: ['clear utility layering', 'travel-worn accessories', 'strong silhouette breakup'],
    enhance: ['turnaround-ready costume logic', 'readable material hierarchy', 'front profile rear consistency'],
    remix: ['different expedition kit', 'new asymmetrical layering', 'alternate weathering treatment'],
  },
  soldier: {
    detail: ['disciplined armor segmentation', 'clear insignia placement', 'combat-ready structure'],
    enhance: ['uniform consistency across all views', 'clean heroic read', 'strong protection hierarchy'],
    remix: ['different unit trim', 'alternate armor layering', 'fresh ceremonial detailing'],
  },
  mage: {
    detail: ['distinct robe layering', 'arcane accessory language', 'focused facial identity'],
    enhance: ['clean spellcaster silhouette', 'consistent ornamental motifs', 'sheet-ready costume breakdown'],
    remix: ['different fabric weighting', 'new talisman language', 'alternate magical accent story'],
  },
  rogue: {
    detail: ['streamlined mobility layers', 'concealed gear placement', 'sharp attitude read'],
    enhance: ['clean stealth silhouette', 'consistent garment tension', 'turnaround-friendly detail rhythm'],
    remix: ['different covert kit', 'alternate hood and collar treatment', 'fresh trim language'],
  },
  character: {
    detail: ['clear face structure', 'layered outfit materials', 'stable proportion language'],
    enhance: ['professional turnaround presentation', 'consistent line weight', 'production-ready sheet clarity'],
    remix: ['different costume emphasis', 'alternate accessory set', 'fresh stance attitude'],
  },
  general: {
    detail: ['clear identity read', 'stable outfit construction', 'clean turnaround silhouette'],
    enhance: ['production-ready character sheet', 'consistent pose translation', 'line-art friendly structure'],
    remix: ['different costume balance', 'alternate silhouette accents', 'fresh visual storytelling details'],
  },
  blade: emptyProfile,
  axe: emptyProfile,
  hammer: emptyProfile,
  shield: emptyProfile,
  ranged: emptyProfile,
  armor: emptyProfile,
  potion: emptyProfile,
  stone: emptyProfile,
  wood: emptyProfile,
  metal: emptyProfile,
  fabric: emptyProfile,
  terrain: emptyProfile,
  environment: emptyProfile,
  creature: emptyProfile,
  prop: emptyProfile,
}

function detectPromptArchetype(
  concept: string,
  activeMode: ForgeMode,
): PromptArchetype {
  const normalized = concept.toLowerCase()
  const match = archetypeKeywordMap[activeMode].find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword)),
  )

  return match?.archetype ?? 'general'
}

function buildPromptVariant({
  activeMode,
  archetype,
  concept,
  variant,
}: PromptBuilderArgs) {
  const profilesByMode =
    activeMode === 'armory'
      ? armoryProfiles
      : activeMode === 'loot-leveler'
        ? armoryProfiles
        : activeMode === 'texture-lab'
          ? textureProfiles
        : activeMode === 'action-animator' || activeMode === 'portrait-studio'
          ? visualizerProfiles
          : activeMode === 'visualizer'
            ? visualizerProfiles
          : activeMode === 'vfx-forge'
            ? visualizerProfiles
            : characterSheetProfiles

  const profile = profilesByMode[archetype] ?? profilesByMode.general
  const selectedDetails = pickDistinct(profile.detail, 2)
  const selectedVariantTraits = pickDistinct(
    variant === 'enhance' ? profile.enhance : profile.remix,
    2,
  )
  const modeEnding = pickTemplate(modeEndings[activeMode][variant])

  return [concept, ...selectedDetails, ...selectedVariantTraits, modeEnding].join(', ')
}

const modeEndings: Record<ForgeMode, Record<PromptVariant, string[]>> = {
  armory: {
    enhance: [
      'high-clarity hero prop presentation',
      'game-ready asset design',
      'clean armory showcase',
    ],
    remix: [
      'alternate armory variant',
      'fresh fantasy prop direction',
      'new forged presentation pass',
    ],
  },
  'action-animator': {
    enhance: [
      'clear side-profile motion read',
      'feet locked to a stable ground plane',
      'loop-safe sprite timing',
    ],
    remix: [
      'alternate action timing',
      'different motion energy',
      'fresh animation pass',
    ],
  },
  'texture-lab': {
    enhance: [
      'seamless top-down texture pass',
      'production-ready tile material',
      'repeat-safe environment texture',
    ],
    remix: [
      'alternate seamless material pass',
      'new surface treatment variation',
      'fresh environment texture direction',
    ],
  },
  'loot-leveler': {
    enhance: [
      'rarity upgrade pass',
      'silhouette-preserving enhancement',
      'premium material accents',
    ],
    remix: [
      'different rarity treatment',
      'alternate material finish',
      'fresh loot pass',
    ],
  },
  'portrait-studio': {
    enhance: [
      'expression-sheet consistency',
      'locked facial structure',
      'contact-sheet presentation',
    ],
    remix: [
      'different emotional emphasis',
      'alternate portrait mood',
      'fresh expression lineup',
    ],
  },
  visualizer: {
    enhance: [
      'cinematic concept-art presentation',
      'premium visual-development render',
      'high-end storytelling frame',
    ],
    remix: [
      'alternate cinematic mood pass',
      'fresh visual-development direction',
      'new atmospheric story beat',
    ],
  },
  'vfx-forge': {
    enhance: [
      'additive-friendly black background',
      'soft glowing particle edges',
      'clear frame-to-frame effect timing',
    ],
    remix: [
      'alternate projectile evolution',
      'different energy breakup',
      'fresh VFX pass',
    ],
  },
  'character-sheet': {
    enhance: [
      'professional turnaround sheet',
      'front profile rear alignment on gray studio background',
      'thick line art and cel-shaded clarity',
    ],
    remix: [
      'alternate turnaround direction',
      'fresh costume and silhouette pass',
      'new character sheet styling variation',
    ],
  },
}

function pickDistinct(values: string[], count: number) {
  const pool = [...values]
  const results: string[] = []

  while (pool.length > 0 && results.length < count) {
    const index = Math.floor(Math.random() * pool.length)
    results.push(pool[index])
    pool.splice(index, 1)
  }

  return results
}

function toForgeError(
  rawError: RawForgeError,
  fallbackTitle = 'Forge Request Failed',
): ForgeErrorInfo {
  if (rawError && typeof rawError === 'object') {
    const errorRecord = rawError as Record<string, unknown>
    const message = readString(errorRecord.message)
    const title = readString(errorRecord.title)

    if (message && title) {
      return {
        code: readString(errorRecord.code),
        details: readStringArray(errorRecord.details),
        message,
        retryAfterSeconds: readNumber(errorRecord.retryAfterSeconds),
        title,
      }
    }

    if (message) {
      return {
        code: readString(errorRecord.code),
        details: readStringArray(errorRecord.details),
        message,
        retryAfterSeconds: readNumber(errorRecord.retryAfterSeconds),
        title: title ?? fallbackTitle,
      }
    }
  }

  if (rawError instanceof Error) {
    return {
      message: rawError.message,
      title: fallbackTitle,
    }
  }

  if (typeof rawError === 'string' && rawError.trim()) {
    return {
      message: rawError,
      title: fallbackTitle,
    }
  }

  return {
    message: 'The forge request failed unexpectedly.',
    title: fallbackTitle,
  }
}

type ErrorPanelProps = {
  error: ForgeErrorInfo
  onRetry?: () => void
  onUseMock?: () => void
}

function ErrorPanel({ error, onRetry, onUseMock }: ErrorPanelProps) {
  return (
    <div className="rounded-[22px] border border-rose-300/20 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-rose-50">{error.title}</p>
          <p className="mt-1 leading-6 text-rose-100/90">{error.message}</p>
          {typeof error.retryAfterSeconds === 'number' ? (
            <p className="mt-2 font-mono text-xs uppercase tracking-[0.24em] text-rose-100/70">
              Retry hint: about {error.retryAfterSeconds}s
            </p>
          ) : null}
          {error.details?.length ? (
            <ul className="mt-3 space-y-2 text-rose-100/80">
              {error.details.map((detail) => (
                <li
                  key={detail}
                  className="rounded-[16px] border border-rose-200/10 bg-black/10 px-3 py-2"
                >
                  {detail}
                </li>
              ))}
            </ul>
          ) : null}
          {onRetry || onUseMock ? (
            <div className="mt-4 flex flex-wrap gap-3">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-full border border-rose-100/20 bg-black/10 px-4 py-2 text-sm text-rose-50 transition hover:border-rose-100/35 hover:bg-black/20"
                >
                  Retry Request
                </button>
              ) : null}
              {onUseMock ? (
                <button
                  type="button"
                  onClick={onUseMock}
                  className="rounded-full border border-rose-100/20 bg-black/10 px-4 py-2 text-sm text-rose-50 transition hover:border-rose-100/35 hover:bg-black/20"
                >
                  Use Mock Results Instead
                </button>
              ) : null}
              <a
                href="https://ai.google.dev/gemini-api/docs/rate-limits"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-rose-100/20 px-4 py-2 text-sm text-rose-100/90 transition hover:border-rose-100/35 hover:bg-black/10"
              >
                Open Gemini Quota Docs
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default App
