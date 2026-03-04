import { useId } from 'react'
import type { ChangeEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { ReferenceAsset } from '../lib/forge'
import { toReferenceAsset } from '../lib/forge'

type ImageUploadFieldProps = {
  asset: ReferenceAsset | null
  helper: string
  icon: LucideIcon
  isRequired?: boolean
  label: string
  onFileSelect: (asset: ReferenceAsset | null) => void
}

export function ImageUploadField({
  label,
  helper,
  asset,
  icon: Icon,
  isRequired = false,
  onFileSelect,
}: ImageUploadFieldProps) {
  const inputId = useId()

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]

    onFileSelect(nextFile ? toReferenceAsset(nextFile) : null)
    event.target.value = ''
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.32em] text-zinc-500">
        <span>{label}</span>
        <span>{asset ? 'Attached' : isRequired ? 'Required' : 'Optional'}</span>
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
          </div>
        </div>
      </label>
    </div>
  )
}
