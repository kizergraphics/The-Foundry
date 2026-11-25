import { Download, Images, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { modeDefinitions, type ForgeMode } from '../lib/forge'
import {
  deleteLibraryImages,
  libraryUpdatedEvent,
  listLibraryImages,
  type LibraryImage,
} from '../lib/imageLibrary'

const buttonStyle = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-40'
const dangerStyle = 'border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20'
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type LibraryFilter = ForgeMode | 'all'

export function ImageLibrary({ initialMode, modes, onClose }: {
  initialMode: ForgeMode
  modes: ForgeMode[]
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [filter, setFilter] = useState<LibraryFilter>(initialMode)
  const [images, setImages] = useState<LibraryImage[]>([])
  const [selected, setSelected] = useState(new Set<string>())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [version, setVersion] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const current = dialog.current
    if (current && !current.open) current.showModal()
    const onLibraryUpdated = () => setVersion(previous => previous + 1)
    window.addEventListener(libraryUpdatedEvent, onLibraryUpdated)
    return () => window.removeEventListener(libraryUpdatedEvent, onLibraryUpdated)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void listLibraryImages(controller.signal).then(nextImages => {
      if (controller.signal.aborted) return
      const existingIds = new Set(nextImages.map(image => image.id))
      setImages(nextImages)
      setSelected(previous => new Set([...previous].filter(id => existingIds.has(id))))
      setLoaded(true)
      setLoadError(false)
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true)
    })
    return () => controller.abort()
  }, [version])

  const visibleImages = filter === 'all' ? images : images.filter(image => image.mode === filter)
  const allVisibleSelected = visibleImages.length > 0 && visibleImages.every(image => selected.has(image.id))
  const selectionLocked = confirming || deleting

  function toggleVisibleSelection() {
    setSelected(previous => {
      const next = new Set(previous)
      for (const { id } of visibleImages) {
        if (allVisibleSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  async function deleteSelection() {
    setDeleting(true)
    setDeleteError('')
    const ids = [...selected]
    try {
      await deleteLibraryImages(ids)
      setImages(previous => previous.filter(image => !selected.has(image.id)))
      setSelected(new Set())
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete the selected images.')
    } finally {
      setVersion(previous => previous + 1)
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="image-library-title"
      className="m-auto max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-[76rem] overflow-auto rounded-2xl border border-white/15 bg-[#0d121a] text-zinc-100 shadow-2xl backdrop:bg-black/75"
      onCancel={event => { if (deleting) event.preventDefault() }}
      onClose={onClose}
    >
      <div className="sticky top-0 z-10 space-y-4 border-b border-white/10 bg-[#0d121a] p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Images aria-hidden="true" className="size-6 text-sky-300" />
            <h2 id="image-library-title" className="text-xl font-semibold">Image Library</h2>
          </div>
          <button type="button" className={buttonStyle} disabled={deleting} onClick={() => dialog.current?.close()}>
            <X aria-hidden="true" className="size-4" /> Close
          </button>
        </div>

        <nav aria-label="Image library categories" className="flex flex-wrap gap-2">
          {(['all', ...modes] as LibraryFilter[]).map(mode => (
            <button
              key={mode}
              type="button"
              aria-pressed={filter === mode}
              className={`${buttonStyle} aria-pressed:border-sky-300/45 aria-pressed:bg-sky-300/12 aria-pressed:text-sky-100`}
              onClick={() => setFilter(mode)}
            >
              {mode === 'all' ? 'All images' : modeDefinitions[mode].label}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-zinc-400" role="status">
            {visibleImages.length} {visibleImages.length === 1 ? 'image' : 'images'} · {selected.size} selected
          </p>
          <button type="button" className={buttonStyle} disabled={!visibleImages.length || selectionLocked} onClick={toggleVisibleSelection}>
            {allVisibleSelected ? 'Deselect all shown' : 'Select all shown'}
          </button>
          {selected.size > 0 && (
            <button type="button" className={buttonStyle} disabled={selectionLocked} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
          <button
            type="button"
            className={`${buttonStyle} ${dangerStyle}`}
            disabled={!selected.size || selectionLocked}
            onClick={() => { setDeleteError(''); setConfirming(true) }}
          >
            <Trash2 aria-hidden="true" className="size-4" /> Delete selected
          </button>
        </div>
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-400/5 p-3">
            <p className="mr-auto text-sm text-rose-100" role="alert">
              Permanently delete {selected.size} selected {selected.size === 1 ? 'image' : 'images'} from the library?
            </p>
            <button type="button" className={buttonStyle} disabled={deleting} onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className={`${buttonStyle} ${dangerStyle}`} disabled={deleting || !selected.size} onClick={() => void deleteSelection()}>
              {deleting ? 'Deleting…' : 'Confirm deletion'}
            </button>
          </div>
        )}
        {deleteError && <p role="alert" className="text-sm text-rose-200">{deleteError}</p>}
        {loadError && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-rose-200">Could not load the image library.</p>
            <button type="button" className={buttonStyle} onClick={() => setVersion(previous => previous + 1)}>Retry</button>
          </div>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {!loaded && !loadError && <p role="status" className="text-sm text-zinc-400">Loading saved images…</p>}
        {loaded && visibleImages.length === 0 && <p className="py-8 text-center text-zinc-400">No saved images in this category yet.</p>}
        <ul className="grid grid-cols-1 gap-4 min-[430px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {visibleImages.map(image => {
            const endpoint = `/api/library/${image.id}`
            const checked = selected.has(image.id)
            return (
              <li key={image.id} className={`overflow-hidden rounded-xl border bg-white/3 ${checked ? 'border-sky-300/60' : 'border-white/10'}`}>
                <a href={`${endpoint}/image.png`} target="_blank" rel="noreferrer" aria-label={`Open full image: ${image.title}`} className="block bg-black/30">
                  <img src={`${endpoint}/thumbnail.webp`} alt={image.title} loading="lazy" className="aspect-square w-full object-contain" />
                </a>
                <div className="space-y-2 p-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-white" title={image.prompt || image.title}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={selectionLocked}
                      className="mt-0.5 size-4 shrink-0 accent-sky-300"
                      onChange={event => {
                        const nextChecked = event.target.checked
                        setSelected(previous => {
                          const next = new Set(previous)
                          if (nextChecked) next.add(image.id)
                          else next.delete(image.id)
                          return next
                        })
                      }}
                    />
                    <span className="line-clamp-2">{image.title}</span>
                  </label>
                  <div className="flex items-end justify-between gap-2">
                    <div className="text-xs leading-relaxed text-zinc-400">
                      {filter === 'all' && <p>{modeDefinitions[image.mode].label}</p>}
                      <time dateTime={image.createdAt}>{dateFormat.format(new Date(image.createdAt))}</time>
                    </div>
                    <a href={`${endpoint}/image.png`} download={image.fileName} aria-label={`Download ${image.title}`} className={buttonStyle}>
                      <Download aria-hidden="true" className="size-4" />
                    </a>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </dialog>
  )
}
