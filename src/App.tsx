import { useEffect, useReducer, useState } from 'react'
import {
  AlertCircle,
  Box,
  ChevronRight,
  FileText,
  Fingerprint,
  Hammer,
  ImagePlus,
  LoaderCircle,
  Palette,
  ScanFace,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
} from 'lucide-react'

import { ImageUploadField } from './components/ImageUploadField'
import { GeneratedResultCard, PlaceholderCard } from './components/ResultCards'
import {
  buildCharacterSheetPrompt,
  generateCharacterSheet,
  getCharacterSheetPromptSource,
} from './lib/characterSheet'
import {
  copyResultToClipboard,
  createDataUrl,
  downloadResult,
  fileToBase64,
} from './lib/browser'
import { buildMockResults } from './lib/mockForge'
import {
  buildRecentPrompts,
  loadStoredState,
  persistStoredState,
} from './lib/persistence'
import {
  composePrompt,
  forgeReducer,
  initialState,
  modeDefinitions,
} from './lib/forge'
import type {
  CharacterSheetGenerationMode,
  CharacterSheetReferenceSlot,
  ForgeErrorInfo,
  ForgeMode,
  ForgeResult,
  ForgeStatus,
  ModeDefinition,
  ReferenceAsset,
  ReferenceSlot,
} from './lib/forge'

type ServiceHealth = {
  keyConfigured: boolean
  models: {
    'character-sheet': string
    forge: string
  }
  ok: boolean
}

type ForgeBriefItem = {
  label: string
  value: string
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
  const [hasRestoredState, setHasRestoredState] = useState(false)
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null)
  const activeMode = modeDefinitions[state.activeMode]
  const isCharacterSheetMode = state.activeMode === 'character-sheet'
  const characterReferenceCount = Object.values(
    state.characterSheet.references,
  ).filter(Boolean).length
  const referenceCount = isCharacterSheetMode
    ? characterReferenceCount
    : Object.values(state.references).filter(Boolean).length
  const promptPreview = isCharacterSheetMode
    ? buildCharacterSheetPrompt(state.characterSheet)
    : composePrompt(state)
  const activePromptValue = isCharacterSheetMode
    ? getCharacterSheetPromptSource(state.characterSheet)
    : state.prompt
  const isCharacterSheetReady =
    state.characterSheet.generationMode === 'manifest'
      ? state.characterSheet.manifestPrompt.trim().length > 0
      : characterReferenceCount === 3
  const isReadyForApi = isCharacterSheetMode
    ? isCharacterSheetReady
    : state.prompt.trim().length > 0
  const isForging = status === 'loading'
  const isShowingResults = results.length > 0
  const activeGenerationCount = isCharacterSheetMode ? 1 : state.generationCount
  const reservedOutputs = Array.from(
    { length: isShowingResults ? results.length : activeGenerationCount },
    (_, index) => index,
  )
  const activeModelName =
    serverModel ??
    (isCharacterSheetMode
      ? serviceHealth?.models['character-sheet']
      : serviceHealth?.models.forge) ??
    null
  const briefItems = isCharacterSheetMode
    ? buildCharacterSheetBriefItems(state)
    : [
        {
          label: 'Style Ref',
          value: state.references.style?.name ?? 'Not attached',
        },
        {
          label: 'Subject Ref',
          value: state.references.subject?.name ?? 'Not attached',
        },
      ]

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

  useEffect(() => {
    const storedState = loadStoredState()

    if (storedState) {
      dispatch({ type: 'set-mode', mode: storedState.settings.activeMode })
      dispatch({
        type: 'set-generation-count',
        count: storedState.settings.generationCount,
      })
      dispatch({ type: 'set-prompt', prompt: storedState.settings.prompt })
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
      setRecentPrompts(storedState.recentPrompts)
      setResults(storedState.session?.results ?? [])
      setServerModel(storedState.session?.serverModel ?? null)
      setServerPrompt(storedState.session?.serverPrompt ?? null)
      setLastSavedAt(storedState.session?.savedAt ?? null)
      if (storedState.session?.results?.length) {
        setStatus('success')
        setNotice('Restored the latest forge session from this browser.')
      }
    }

    setHasRestoredState(true)
  }, [])

  useEffect(() => {
    const cancelState = { cancelled: false }

    void refreshHealth(cancelState)

    return () => {
      cancelState.cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasRestoredState) {
      return
    }

    persistStoredState({
      recentPrompts,
      settings: {
        activeMode: state.activeMode,
        characterSheet: {
          consistencyEnabled: state.characterSheet.consistencyEnabled,
          generationMode: state.characterSheet.generationMode,
          manifestPrompt: state.characterSheet.manifestPrompt,
          parentId: state.characterSheet.parentId,
          referencePrompt: state.characterSheet.referencePrompt,
        },
        generationCount: state.generationCount,
        prompt: state.prompt,
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
    state.characterSheet.consistencyEnabled,
    state.characterSheet.generationMode,
    state.characterSheet.manifestPrompt,
    state.characterSheet.parentId,
    state.characterSheet.referencePrompt,
    state.generationCount,
    state.prompt,
  ])

  function finalizeForgeRun(
    nextResults: ForgeResult[],
    nextServerModel: string | null,
    nextServerPrompt: string | null,
    nextNotice: string,
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
    setRecentPrompts(nextRecentPrompts)

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

    setStatus('loading')
    setError(null)
    setNotice(null)
    setResults([])
    setServerPrompt(null)

    try {
      if (isCharacterSheetMode) {
        const payload = await generateCharacterSheet(state.characterSheet)

        finalizeForgeRun(
          payload.results,
          payload.model,
          payload.prompt,
          'Character sheet generated with palette extraction enabled.',
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
          mode: state.activeMode,
          prompt: state.prompt.trim(),
          references,
        }),
      })

      const payload = (await response.json()) as
        | {
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
        | undefined

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
        payload.prompt ?? null,
        `Forge pass completed with ${payload.images.length} candidate outputs.`,
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
    )
  }

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
                promptLoaded={isReadyForApi}
                generationCount={activeGenerationCount}
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
                    {isCharacterSheetMode ? 'Sheet settings' : 'Forge settings'}
                  </h2>
                </div>
              </div>

              <div className="mt-6 space-y-5">
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
                ) : (
                  <>
                    <PromptPanel
                      activeMode={state.activeMode}
                      prompt={state.prompt}
                      recentPrompts={recentPrompts}
                      onChange={(prompt) => dispatch({ type: 'set-prompt', prompt })}
                    />

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

                <button
                  type="button"
                  onClick={() => void handleForge()}
                  disabled={!isReadyForApi || isForging}
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
                        {isForging
                          ? isCharacterSheetMode
                            ? 'BUILDING SHEET'
                            : 'FORGING'
                          : isCharacterSheetMode
                            ? 'BUILD SHEET'
                            : 'FORGE'}
                      </span>
                      <span className="block text-xs text-sky-100/70">
                        {isForging
                          ? isCharacterSheetMode
                            ? 'Sending character sheet request to Gemini'
                            : 'Sending prompt and references to Gemini'
                          : isReadyForApi
                            ? 'Request staged for API execution'
                            : isCharacterSheetMode
                              ? 'Attach all required references or write a manifest'
                              : 'Add a prompt to prepare the request'}
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
                isForging={isForging}
                isReadyForApi={isReadyForApi}
                prompt={serverPrompt ?? promptPreview}
              />

              <div className="flex flex-col gap-4 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
                      Result Grid
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-white">
                      {isCharacterSheetMode
                        ? 'Character sheet output slot'
                        : 'Output slots for the current forge pass'}
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
                    isCharacterSheetMode
                      ? 'grid gap-4'
                      : 'grid gap-4 md:grid-cols-2 2xl:grid-cols-4'
                  }
                >
                  {isShowingResults
                    ? results.map((result, index) => (
                        <GeneratedResultCard
                          key={result.id}
                          index={index}
                          mode={activeMode}
                          result={result}
                          onCopy={handleCopy}
                          onDownload={handleDownload}
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
  generationCount: number
  promptLoaded: boolean
}

function HeaderSummary({
  activeMode,
  promptLoaded,
  generationCount,
}: HeaderSummaryProps) {
  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="flex items-start gap-4">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4 text-sky-300 shadow-[0_16px_30px_rgba(14,165,233,0.12)]">
          <Hammer className="size-6" strokeWidth={1.7} />
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.42em] text-sky-300/70">
            Workspace
          </p>
          <h1 className="mt-3 max-w-5xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl xl:text-[3.75rem] xl:leading-[1.02]">
            The Foundry
          </h1>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Mode" value={activeMode.label} />
        <MetricCard label="Prompt" value={promptLoaded ? 'Loaded' : 'Missing'} />
        <MetricCard label="Batch Count" value={`${generationCount} outputs`} />
      </div>
    </div>
  )
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

type PromptPanelProps = {
  activeMode: ForgeMode
  onChange: (prompt: string) => void
  prompt: string
  recentPrompts: string[]
}

function PromptPanel({
  activeMode,
  prompt,
  onChange,
  recentPrompts,
}: PromptPanelProps) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            Forge Prompt
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            Describe the asset or scene you want generated
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
          placeholder="Ex: Ornate steel longsword with obsidian inlay, readable silhouette, game-ready presentation."
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
  isForging: boolean
  isReadyForApi: boolean
  prompt: string
}

function TopPanel({
  activeMode,
  isForging,
  isReadyForApi,
  prompt,
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
          <MetricCard
            label="Readiness"
            value={isForging ? 'Generating' : isReadyForApi ? 'Prompt ready' : 'Prompt required'}
          />
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
  'texture-lab': 'weathered basalt floor tile with subtle lava seams',
  visualizer: 'battle-worn ranger portrait with layered leather armor',
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
      : activeMode === 'texture-lab'
        ? textureProfiles
        : activeMode === 'visualizer'
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
