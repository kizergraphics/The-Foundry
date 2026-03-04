import { useState } from 'react'
import { Copy } from 'lucide-react'

type PaletteDisplayProps = {
  colors: string[]
}

export function PaletteDisplay({ colors }: PaletteDisplayProps) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null)

  if (!colors.length) {
    return null
  }

  async function handleCopy(color: string) {
    await navigator.clipboard.writeText(color)
    setCopiedColor(color)
    window.setTimeout(() => {
      setCopiedColor((current) => (current === color ? null : current))
    }, 1400)
  }

  return (
    <div className="mt-4 rounded-[22px] border border-white/10 bg-black/20 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">
        Palette
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => void handleCopy(color)}
            className="inline-flex items-center justify-between rounded-[18px] border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
          >
            <span className="flex items-center gap-3">
              <span
                className="size-5 rounded-full border border-white/10"
                style={{ backgroundColor: color }}
              />
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-200">
                {color}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 text-xs text-zinc-400">
              <Copy className="size-3.5" strokeWidth={1.8} />
              {copiedColor === color ? 'Copied' : 'Copy'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
