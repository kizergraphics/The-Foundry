import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { textureCallCount, textureGeometry } from '../../shared/textureLab.js'
import type { TextureSettings, TextureRect } from '../../shared/textureLab.js'
import type {
  ForgeResult,
  ReferenceAsset,
  TextureExpansionTargetSize,
} from '../lib/forge'
import type { useTextureLabRun } from '../lib/textureLabRun'
const panel =
  'space-y-4 rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-200'
const button =
  'rounded-xl border border-white/20 px-3 py-2 hover:bg-white/10 disabled:opacity-40'
export function TextureLabControls({
  settings,
  onSettingsChange,
  expansionTargetSize,
  onTargetSizeChange,
  seamlessMode,
  onSeamlessModeChange,
  source,
  modelId,
  disabled = false,
}: {
  settings: TextureSettings
  onSettingsChange: (settings: Partial<TextureSettings>) => void
  expansionTargetSize: TextureExpansionTargetSize
  onTargetSizeChange: (size: TextureExpansionTargetSize) => void
  seamlessMode: boolean
  onSeamlessModeChange: (value: boolean) => void
  source: ReferenceAsset | null
  modelId: string
  disabled?: boolean
}) {
  const [preview, setPreview] = useState<{
    url: string
    width: number
    height: number
  } | null>(null)
  useEffect(() => {
    if (!source) return
    const url = URL.createObjectURL(source.file),
      img = new Image()
    let active = true
    img.onload = () => {
      if (active)
        setPreview({ url, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = url
    return () => {
      active = false
      URL.revokeObjectURL(url)
    }
  }, [source])
  const g = textureGeometry(preview?.width ?? 1, preview?.height ?? 1, {
    ...settings,
    targetSize: expansionTargetSize,
    seamlessMode,
  })
  return (
    <section className={panel}>
      <h3 className="font-medium text-white">Expansion Workflow</h3>
      <p>
        Expand an existing texture into a larger surface, with optional seamless
        finishing.
      </p>
      <fieldset disabled={disabled} className="grid grid-cols-2 gap-3">
        <label>
          Technique
          <select
            aria-label="Technique"
            className="block w-full bg-zinc-900 p-2"
            value={settings.technique}
            onChange={(e) =>
              onSettingsChange({
                technique: e.target.value as TextureSettings['technique'],
              })
            }
          >
            <option value="creative">Creative expansion</option>
            <option value="faithful">Faithful synthesis</option>
          </select>
        </label>
        <label>
          Expansion amount
          <select
            aria-label="Expansion amount"
            className="block w-full bg-zinc-900 p-2"
            value={settings.factor}
            onChange={(e) =>
              onSettingsChange({
                factor: Number(e.target.value) as TextureSettings['factor'],
              })
            }
          >
            {[1.5, 2, 4].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select
            aria-label="Direction"
            className="block w-full bg-zinc-900 p-2"
            value={settings.direction}
            onChange={(e) =>
              onSettingsChange({
                direction: e.target.value as TextureSettings['direction'],
              })
            }
          >
            {['all', 'left', 'right', 'up', 'down'].map((v) => (
              <option key={v} value={v}>
                {v === 'all' ? 'All around' : v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source protection
          <select
            aria-label="Source protection"
            className="block w-full bg-zinc-900 p-2"
            value={settings.preservation}
            onChange={(e) =>
              onSettingsChange({
                preservation: e.target.value as TextureSettings['preservation'],
              })
            }
          >
            <option value="preserve">Preserve original</option>
            <option value="blend">Blend the boundary</option>
          </select>
        </label>
        <label>
          Variants
          <select
            aria-label="Variants"
            className="block w-full bg-zinc-900 p-2"
            value={settings.variants}
            onChange={(e) =>
              onSettingsChange({
                variants: Number(e.target.value) as TextureSettings['variants'],
              })
            }
          >
            {[1, 2, 3, 4].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Export size
          <select
            aria-label="Export size"
            className="block w-full bg-zinc-900 p-2"
            value={expansionTargetSize}
            onChange={(e) =>
              onTargetSizeChange(
                Number(e.target.value) as TextureExpansionTargetSize,
              )
            }
          >
            <option value={512}>512 × 512</option>
            <option value={1024}>1024 × 1024</option>
          </select>
        </label>
        <label className="col-span-2 flex gap-2">
          <input
            type="checkbox"
            checked={seamlessMode}
            onChange={(e) => onSeamlessModeChange(e.target.checked)}
          />
          Seamless Mode
        </label>
      </fieldset>
      <p className="text-xs text-zinc-400">
        {settings.technique === 'faithful'
          ? 'Rearranges source patches locally. Distinctive marks may recur; large cracks and brick courses may fragment.'
          : modelId === 'openai-gpt-image-2'
            ? 'Native edit mask plus protected compositing.'
            : 'Reference-guided edit plus protected compositing; this provider has no enabled native mask.'}
      </p>
      <p className="text-xs">
        {textureCallCount({ ...settings, seamlessMode })} planned provider calls
        · {settings.factor === 4 ? 2 : 1} expansion stage(s) per variant
        {seamlessMode ? ' + finishing' : ''}.{' '}
        {settings.technique === 'creative'
          ? 'Generated at 1024 × 1024; exported at your selected size.'
          : 'Computed locally at export resolution.'}
      </p>
      <p className="text-xs text-zinc-400">
        The source is scaled once. Its protected pixels remain exact after
        scaling. Expansion amount controls source coverage independently of
        export size.
      </p>
      <div
        aria-label="Centered source preview"
        className="relative mx-auto aspect-square w-full max-w-64 overflow-hidden rounded-xl bg-zinc-800"
      >
        <div
          className="absolute border-2 border-emerald-300 bg-emerald-300/10"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: `${(g.width / expansionTargetSize) * 100}%`,
            height: `${(g.height / expansionTargetSize) * 100}%`,
          }}
        >
          {source && preview && (
            <img
              alt="Placed source"
              className="h-full w-full"
              src={preview.url}
            />
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400">
        Source shown centered. Direction controls its placement in the generated
        texture.
      </p>
      {seamlessMode && (
        <p className="text-xs">
          The placement reserves room for edge and corner finishing.
        </p>
      )}
    </section>
  )
}
export function TextureLabWorkspace({
  results,
  runner,
  onDownload,
}: {
  results: ForgeResult[]
  runner: ReturnType<typeof useTextureLabRun>
  onDownload: (result: ForgeResult, index: number) => void
}) {
  const [selected, setSelected] = useState(''),
    [repeats, setRepeats] = useState(1),
    [region, setRegion] = useState<TextureRect | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const result = results.find((r) => r.id === selected) ?? results.at(-1)
  const n = result?.texture?.exportSize ?? 1024,
    g = result?.texture?.sourceRect
  function point(e: PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(n - 1, Math.floor(((e.clientX - b.left) / b.width) * n)),
      ),
      y: Math.max(
        0,
        Math.min(n - 1, Math.floor(((e.clientY - b.top) / b.height) * n)),
      ),
    }
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!origin.current) return
    const p = point(e),
      o = origin.current
    setRegion({
      x: Math.min(p.x, o.x),
      y: Math.min(p.y, o.y),
      width: Math.abs(p.x - o.x) + 1,
      height: Math.abs(p.y - o.y) + 1,
    })
  }
  return (
    <section className={panel}>
      <div role="status">
        {runner.progress ||
          'Texture candidates and tiled previews appear here.'}
      </div>
      {runner.error && (
        <p role="alert" className="text-rose-300">
          {runner.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {runner.busy && (
          <button className={button} onClick={runner.cancel}>
            Stop after current operation
          </button>
        )}
        {runner.pending && !runner.busy && (
          <>
            <button className={button} onClick={() => void runner.resume()}>
              Resume / retry failed operation
            </button>
            <button className={button} onClick={runner.discard}>
              Discard remaining operations
            </button>
          </>
        )}
      </div>
      {!!results.length && (
        <label>
          Selected candidate
          <select
            aria-label="Selected candidate"
            className="ml-2 bg-zinc-900 p-2"
            value={result?.id ?? ''}
            onChange={(e) => {
              setSelected(e.target.value)
              setRegion(null)
            }}
          >
            {results.map((r, i) => (
              <option key={r.id} value={r.id}>
                Candidate {i + 1} · {r.texture?.status ?? 'legacy'}
              </option>
            ))}
          </select>
        </label>
      )}
      {result && (
        <>
          <div className="flex flex-wrap gap-2">
            {[1, 3, 5].map((v) => (
              <button
                key={v}
                aria-pressed={repeats === v}
                className={button}
                onClick={() => {
                  setRepeats(v)
                  setRegion(null)
                }}
              >
                {v}×{v}
              </button>
            ))}
            <button
              className={button}
              onClick={() => onDownload(result, results.indexOf(result))}
            >
              Export selected candidate
            </button>
          </div>
          <div
            role="img"
            aria-label="Texture preview; drag to select a region at 1×"
            className="relative mx-auto aspect-square w-full max-w-[720px] overflow-hidden rounded-xl border border-white/20"
            style={{
              backgroundImage: `url("${result.dataUrl}")`,
              backgroundSize: `${100 / repeats}% ${100 / repeats}%`,
              imageRendering: 'auto',
              touchAction: 'none',
            }}
            onPointerDown={(e) => {
              if (repeats !== 1 || runner.busy) return
              origin.current = point(e)
              setRegion(null)
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={move}
            onPointerUp={(e) => {
              move(e)
              origin.current = null
            }}
            onPointerCancel={() => {
              origin.current = null
            }}
          >
            {repeats === 1 && g && (
              <div
                className="pointer-events-none absolute border border-emerald-300/80"
                style={{
                  left: `${((g.x + g.band) / n) * 100}%`,
                  top: `${((g.y + g.band) / n) * 100}%`,
                  width: `${((g.width - 2 * g.band) / n) * 100}%`,
                  height: `${((g.height - 2 * g.band) / n) * 100}%`,
                }}
              />
            )}
            {repeats === 1 && region && (
              <div
                className="pointer-events-none absolute border-2 border-sky-300 bg-sky-300/15"
                style={{
                  left: `${(region.x / n) * 100}%`,
                  top: `${(region.y / n) * 100}%`,
                  width: `${(region.width / n) * 100}%`,
                  height: `${(region.height / n) * 100}%`,
                }}
              />
            )}
          </div>
          <p className="text-xs text-zinc-400">
            Drag a rectangle at 1× to regenerate detail. Green outlines the
            protected source. Edge continuity and repeated internal features
            should be judged separately.
          </p>
          {region && (
            <div className="flex flex-wrap gap-2">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    aria-label={`Region ${key}`}
                    className="ml-1 w-20 bg-zinc-900 p-1"
                    type="number"
                    min={key === 'width' || key === 'height' ? 1 : 0}
                    max={n}
                    value={region[key]}
                    onChange={(e) =>
                      setRegion({ ...region, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              className={button}
              disabled={runner.busy || runner.pending || !result.texture}
              onClick={() =>
                setRegion({
                  x: 0,
                  y: 0,
                  width: Math.round(n / 8),
                  height: Math.round(n / 8),
                })
              }
            >
              Select corner region
            </button>
            <button
              className={button}
              disabled={
                runner.busy || runner.pending || !region || !result.texture
              }
              onClick={() => region && void runner.edit(result, region)}
            >
              Regenerate selected region
            </button>
            {result.texture?.status === 'unfinished' && (
              <button
                className={button}
                disabled={runner.busy}
                onClick={() =>
                  void (runner.pending ? runner.resume() : runner.edit(result))
                }
              >
                Retry Finish
              </button>
            )}
          </div>
          {result.texture && (
            <p className="text-xs">
              {result.texture.options.technique} ·{' '}
              {result.texture.options.preservation} · generated{' '}
              {result.texture.generationSize}² · exported{' '}
              {result.texture.exportSize}² · {result.texture.status} ·{' '}
              {result.texture.maskMode} ·{' '}
              {(result.texture.elapsedMs / 1000).toFixed(1)}s
            </p>
          )}
        </>
      )}
    </section>
  )
}
