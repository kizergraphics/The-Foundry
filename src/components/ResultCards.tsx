import {
  Clock3,
  Copy,
  Download,
  LoaderCircle,
  Sparkles,
} from 'lucide-react'

import { PaletteDisplay } from './PaletteDisplay'
import type { ForgeResult, ModeDefinition } from '../lib/forge'

type PlaceholderCardProps = {
  index: number
  mode: ModeDefinition
  state: 'idle' | 'loading'
}

type GeneratedResultCardProps = {
  index: number
  mode: ModeDefinition
  onCopy: (result: ForgeResult) => Promise<void>
  onDownload: (result: ForgeResult, index: number) => void
  result: ForgeResult
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
  index,
  mode,
  result,
  onCopy,
  onDownload,
}: GeneratedResultCardProps) {
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

      <p className="mt-4 line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-zinc-400">
        {result.text ?? 'Generated image candidate returned from Gemini.'}
      </p>

      <PaletteDisplay colors={result.paletteHexes ?? []} />

      <div className="mt-4 grid grid-cols-2 gap-2">
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
      </div>
    </article>
  )
}
