import type { ForgeErrorInfo, ForgeResult, TextureMaterialMapDefaults, TextureMaterialMapKey } from '../lib/forge'
import type { MaterialMapResult } from '../modes/execution'
import { TextureMaterialViewer } from './TextureMaterialViewer'

const materialMapLabels: Record<TextureMaterialMapKey, string> = {
  height: 'Height',
  metallic: 'Metallic',
  normal: 'Normal',
  roughness: 'Roughness',
}

const strengthKeyByMap: Record<TextureMaterialMapKey, keyof TextureMaterialMapDefaults> = {
  height: 'heightStrength',
  metallic: 'metallicStrength',
  normal: 'normalStrength',
  roughness: 'roughnessStrength',
}

const materialMapOrder: TextureMaterialMapKey[] = [
  'height',
  'normal',
  'roughness',
  'metallic',
]

type TextureMaterialPackProps = {
  error: ForgeErrorInfo | null
  isDirty: boolean
  isLoading: boolean
  maps: Partial<Record<TextureMaterialMapKey, MaterialMapResult>>
  onDownloadAll: () => void
  onDownloadMap: (mapKey: TextureMaterialMapKey) => void
  onRegenerate: () => void
  onStrengthChange: (key: keyof TextureMaterialMapDefaults, value: number) => void
  sourceResult: ForgeResult
  strengths: TextureMaterialMapDefaults
}

export function TextureMaterialPack({
  error,
  isDirty,
  isLoading,
  maps,
  onDownloadAll,
  onDownloadMap,
  onRegenerate,
  onStrengthChange,
  sourceResult,
  strengths,
}: TextureMaterialPackProps) {
  const hasAnyMaps = materialMapOrder.some((mapKey) => Boolean(maps[mapKey]))
  const hasAllMaps = materialMapOrder.every((mapKey) => Boolean(maps[mapKey]))
  const statusLabel = isLoading
    ? 'Generating'
    : error
      ? 'Needs Attention'
      : isDirty
        ? 'Needs Regeneration'
        : hasAllMaps
          ? 'Ready'
          : 'Queued'

  return (
    <section className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            Material Pack
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            Generate PBR-ready maps inline from this Texture Lab result and download each PNG separately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-300">
            {statusLabel}
          </span>
          <button
            type="button"
            disabled={isLoading || (!isDirty && !error)}
            onClick={onRegenerate}
            className="rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-50 transition hover:border-sky-300/35 hover:bg-sky-400/16 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Regenerate Maps
          </button>
          <button
            type="button"
            disabled={isLoading || !hasAllMaps}
            onClick={onDownloadAll}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download All Maps
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[18px] border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          <p className="font-medium">{error.title}</p>
          <p className="mt-1">{error.message}</p>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        <TextureMaterialViewer maps={maps} sourceDataUrl={sourceResult.dataUrl} />

        <div className="space-y-4">
          <article className="rounded-[22px] border border-white/10 bg-white/[0.03] p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Source
            </p>
            <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/30">
              <img
                src={sourceResult.dataUrl}
                alt="Source texture"
                className="aspect-square w-full object-cover"
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-400">
              The source texture anchors all generated maps and stays unchanged while the viewer
              applies the current material response live.
            </p>
          </article>

          {materialMapOrder.map((mapKey) => {
            const map = maps[mapKey]
            const label = materialMapLabels[mapKey]
            const strengthKey = strengthKeyByMap[mapKey]

            return (
              <article
                key={mapKey}
                className="rounded-[22px] border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                      {label}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      {map
                        ? 'Applied to the live viewer and ready for PNG download.'
                        : isLoading
                          ? `Generating ${label.toLowerCase()} map...`
                          : `${label} map preview will appear here after generation.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!map || isLoading}
                    onClick={() => onDownloadMap(mapKey)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download {label}
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <label
                    htmlFor={`${sourceResult.id}-${strengthKey}`}
                    className="text-xs font-medium text-zinc-300"
                  >
                    {label} Strength
                  </label>
                  <span className="text-xs text-zinc-500">{strengths[strengthKey]}</span>
                </div>
                <input
                  id={`${sourceResult.id}-${strengthKey}`}
                  aria-label={`${label} Strength`}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={strengths[strengthKey]}
                  disabled={isLoading}
                  onChange={(event) => onStrengthChange(strengthKey, Number(event.target.value))}
                  className="mt-3 w-full cursor-pointer accent-sky-400 disabled:cursor-not-allowed"
                />
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  {mapKey === 'height'
                    ? 'Controls grayscale contrast before the height map is saved.'
                    : mapKey === 'normal'
                      ? 'Controls how strongly the server converts height detail into normal vectors.'
                      : mapKey === 'roughness'
                        ? 'Biases roughness contrast around mid-gray for broader or tighter variation.'
                        : 'Keeps metallic coverage restrained so non-metals stay dark by default.'}
                </p>
              </article>
            )
          })}
        </div>
      </div>

      {!hasAnyMaps && !isLoading ? (
        <p className="mt-4 text-sm text-zinc-500">
          Generate the first pass to populate previews for height, normal, roughness, and metallic.
        </p>
      ) : null}
    </section>
  )
}
