import { useId } from 'react'
import type { ChangeEvent } from 'react'
import { Box, CheckCircle2 } from 'lucide-react'

import type { ModelAsset } from '../lib/forge'
import { validateModelUpload } from '../lib/uvLab'

type ModelUploadFieldProps = {
  asset: ModelAsset | null
  error?: string | null
  helper: string
  isRequired?: boolean
  label: string
  onFileSelect: (asset: ModelAsset | null) => void
  onInvalidSelection?: (message: string) => void
}

export function ModelUploadField({
  label,
  helper,
  asset,
  error = null,
  isRequired = false,
  onFileSelect,
  onInvalidSelection,
}: ModelUploadFieldProps) {
  const inputId = useId()

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]

    if (!nextFile) {
      onFileSelect(null)
      event.target.value = ''
      return
    }

    const validation = validateModelUpload(nextFile)

    if (!validation.ok) {
      onInvalidSelection?.(validation.error)
      event.target.value = ''
      return
    }

    onFileSelect(validation.asset)
    event.target.value = ''
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.32em] text-zinc-500">
        <span>{label}</span>
        <span>{asset ? asset.format.toUpperCase() : isRequired ? 'Required' : 'Optional'}</span>
      </div>
      <label
        htmlFor={inputId}
        className="group block cursor-pointer rounded-[24px] border border-white/10 bg-white/[0.035] p-4 transition duration-200 hover:border-amber-300/35 hover:bg-white/[0.055]"
      >
        <input
          id={inputId}
          type="file"
          accept=".obj,.fbx"
          className="sr-only"
          onChange={handleChange}
        />
        <div className="flex items-start gap-4">
          <div className="rounded-[18px] border border-white/10 bg-black/30 p-3 text-zinc-200 transition duration-200 group-hover:border-amber-300/30 group-hover:text-amber-100">
            <Box className="size-5" strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <span className="truncate">{asset?.name ?? 'Select OBJ or FBX mesh'}</span>
              {asset ? <CheckCircle2 className="size-4 shrink-0 text-amber-200" /> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              {asset
                ? `${asset.sizeLabel} | ${asset.format.toUpperCase()} mesh staged for unwrap.`
                : helper}
            </p>
            {error ? (
              <p className="mt-2 text-sm text-rose-200">{error}</p>
            ) : (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
                Accepts .obj and .fbx only
              </p>
            )}
          </div>
        </div>
      </label>
    </div>
  )
}
