import type { ForgeMode } from './forge'

export type LibraryImage = {
  id: string
  mode: ForgeMode
  title: string
  prompt: string
  createdAt: string
  fileName: string
}

export const libraryUpdatedEvent = 'foundry-library-updated'

export function reportLibrarySave(response: Response) {
  const status = response.headers?.get('X-Foundry-Library')
  if (status && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(libraryUpdatedEvent, { detail: status }))
  }
}

export async function listLibraryImages(signal: AbortSignal): Promise<LibraryImage[]> {
  const response = await fetch('/api/library', { signal })
  if (!response.ok) throw new Error('Could not load the image library.')
  return (await response.json()).images
}

export async function deleteLibraryImages(ids: string[]) {
  const response = await fetch('/api/library/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Foundry-Request': '1',
    },
    body: JSON.stringify({ ids }),
  })
  if (!response.ok) throw new Error('Some selected images could not be deleted. Try again.')
}
