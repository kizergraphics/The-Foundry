import { useId, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { ReferenceAsset } from '../lib/forge'
import { validateReferenceImageUpload } from '../lib/forge'

type ImageUploadFieldProps = {
  asset: ReferenceAsset | null
  error?: string | null
  helper: string
  icon: LucideIcon
  isRequired?: boolean
  label: string
  onFileSelect: (asset: ReferenceAsset | null) => void
  onInvalidSelection?: (message: string) => void
}

export function ImageUploadField({
  label,
  helper,
  asset,
  error = null,
  icon: Icon,
  isRequired = false,
  onFileSelect,
  onInvalidSelection,
}: ImageUploadFieldProps) {
  const inputId = useId()
  const [localError, setLocalError] = useState<string | null>(null)
  const resolvedError = error ?? localError

  function handleRemove() {
    setLocalError(null)
    onFileSelect(null)
  }

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]

    if (!nextFile) {
      onFileSelect(null)
      event.target.value = ''
      return
    }

    const validation = await validateReferenceImageUpload(nextFile)

    if (!validation.ok) {
      setLocalError(validation.error)
      onInvalidSelection?.(validation.error)
      event.target.value = ''
      return
    }

    setLocalError(null)
    onFileSelect(validation.asset)
    event.target.value = ''
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.32em] text-zinc-500">
        <span>{label}</span>
        <div className="flex items-center gap-2">
          {asset ? (
            <button
              type="button"
              onClick={handleRemove}
              className="inline-flex items-center gap-1 rounded-full border border-rose-300/20 bg-rose-400/10 px-2.5 py-1 text-[10px] tracking-[0.24em] text-rose-100 transition hover:border-rose-200/35 hover:bg-rose-400/15"
            >
              <X className="size-3" strokeWidth={1.8} />
              Remove
            </button>
          ) : null}
          <span>{asset ? 'Attached' : isRequired ? 'Required' : 'Optional'}</span>
        </div>
      </div>
      <label
        htmlFor={inputId}
        className="group block cursor-pointer rounded-[24px] border border-white/10 bg-white/[0.035] p-4 transition duration-200 hover:border-sky-400/35 hover:bg-white/[0.055]"
      >
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleChange}
        />
        <div className="flex items-start gap-4">
          <div className="rounded-[18px] border border-white/10 bg-black/30 p-3 text-zinc-200 transition duration-200 group-hover:border-sky-400/30 group-hover:text-sky-200">
            <Icon className="size-5" strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <span className="truncate">{asset?.name ?? 'Select reference image'}</span>
              {asset ? <CheckCircle2 className="size-4 shrink-0 text-sky-300" /> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              {asset ? `${asset.sizeLabel} loaded into the forge queue.` : helper}
            </p>
            {resolvedError ? (
              <p className="mt-2 text-sm text-rose-200">{resolvedError}</p>
            ) : (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
                Accepts PNG, JPEG, and WebP up to 10 MB
              </p>
            )}
          </div>
        </div>
      </label>
    </div>
  )
}
