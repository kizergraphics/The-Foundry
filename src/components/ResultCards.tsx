import { useEffect, useState } from 'react'
import {
  Clock3,
  Copy,
  Download,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

import { PaletteDisplay } from './PaletteDisplay'
import { buildTiledPreviewDataUrl } from '../lib/browser'
import type { ForgeResult, ModeDefinition } from '../lib/forge'

type PlaceholderCardProps = {
  index: number
  mode: ModeDefinition
  state: 'idle' | 'loading'
}

type GeneratedResultCardProps = {
  canRepairSeams?: boolean
  index: number
  isRepairing?: boolean
  mode: ModeDefinition
  onCopy: (result: ForgeResult) => Promise<void>
  onDownload: (result: ForgeResult, index: number) => void
  onRepairSeams?: (result: ForgeResult) => void | Promise<void>
  result: ForgeResult
  showTilePreview?: boolean
}

export function PlaceholderCard({ index, mode, state }: PlaceholderCardProps) {
  const ModeIcon = mode.icon
  const isLoading = state === 'loading'

  return (
    <article className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Output {String(index + 1).padStart(2, '0')}
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-200">{mode.label} slot reserved</p>
        </div>
        <div className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-400">
          {isLoading ? 'Forging' : 'Queued'}
        </div>
      </div>

      <div
        className={`mt-4 ${mode.previewAspectClassName} rounded-[22px] border border-dashed border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,rgba(12,14,18,0.98),rgba(7,8,10,0.98))] p-5 ${
          isLoading ? 'animate-pulse' : ''
        }`}
      >
        <div className="flex h-full flex-col justify-between rounded-[18px] border border-white/[0.06] bg-white/[0.025] p-5">
          <div className="flex items-center justify-between text-zinc-500">
            {isLoading ? (
              <LoaderCircle className="size-4 animate-spin" strokeWidth={1.7} />
            ) : (
              <Sparkles className="size-4" strokeWidth={1.7} />
            )}
            <Clock3 className="size-4" strokeWidth={1.7} />
          </div>
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full border border-white/10 bg-white/[0.04] p-5 text-zinc-300 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_36px_rgba(0,0,0,0.22)]">
                <ModeIcon className="size-7" strokeWidth={1.5} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-white/[0.08]" />
              <div className="h-2 w-4/5 rounded-full bg-white/[0.06]" />
              <div className="h-2 w-2/3 rounded-full bg-white/[0.05]" />
            </div>
          </div>
          <p className="text-center font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
            {isLoading ? 'Generating with Gemini' : 'Ready for forge pass'}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-500"
        >
          <Download className="size-4" strokeWidth={1.7} />
          Download
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-500"
        >
          <Copy className="size-4" strokeWidth={1.7} />
          Copy
        </button>
      </div>
    </article>
  )
}

export function GeneratedResultCard({
  canRepairSeams = false,
  index,
  isRepairing = false,
  mode,
  result,
  onCopy,
  onDownload,
  onRepairSeams,
  showTilePreview = false,
}: GeneratedResultCardProps) {
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!showTilePreview) {
      return () => {
        cancelled = true
      }
    }

    void buildTiledPreviewDataUrl(result.dataUrl)
      .then((preview) => {
        if (!cancelled) {
          setPreviewDataUrl(preview)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewDataUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [result.dataUrl, showTilePreview])

  return (
    <article className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Output {String(index + 1).padStart(2, '0')}
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-200">{mode.label} candidate</p>
        </div>
        <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.32em] text-emerald-100">
          Ready
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[22px] border border-white/10 bg-black/30">
        <img
          src={result.dataUrl}
          alt={`${mode.label} generated output ${index + 1}`}
          className={`${mode.previewAspectClassName} w-full object-cover`}
        />
      </div>

      {showTilePreview ? (
        <div className="mt-4 rounded-[22px] border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              3x3 Tile Preview
            </p>
            <span className="text-xs text-zinc-400">Inspect center seams</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/30">
            {previewDataUrl ? (
              <img
                src={previewDataUrl}
                alt={`${mode.label} tiled preview ${index + 1}`}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square items-center justify-center text-sm text-zinc-500">
                Building preview
              </div>
            )}
          </div>
        </div>
      ) : null}

      <p className="mt-4 line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-zinc-400">
        {result.text ?? 'Generated image candidate returned from Gemini.'}
      </p>

      <PaletteDisplay colors={result.paletteHexes ?? []} />

      <div className={`mt-4 grid gap-2 ${canRepairSeams ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <button
          type="button"
          onClick={() => onDownload(result, index)}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05]"
        >
          <Download className="size-4" strokeWidth={1.7} />
          Download
        </button>
        <button
          type="button"
          onClick={() => void onCopy(result)}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05]"
        >
          <Copy className="size-4" strokeWidth={1.7} />
          Copy
        </button>
        {canRepairSeams ? (
          <button
            type="button"
            disabled={isRepairing || !onRepairSeams}
            onClick={() => void onRepairSeams?.(result)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-50 transition hover:border-emerald-300/35 hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`size-4 ${isRepairing ? 'animate-spin' : ''}`}
              strokeWidth={1.7}
            />
            {isRepairing ? 'Repairing' : 'Repair Seams'}
          </button>
        ) : null}
      </div>
    </article>
  )
}
