import type { ForgeResult } from './forge'

export function createDataUrl(data: string, mimeType: string): string {
  return `data:${mimeType};base64,${data}`
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

export async function copyResultToClipboard(result: ForgeResult): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard copy is not supported in this browser.')
  }

  const blob = await fetch(result.dataUrl).then((response) => response.blob())
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export function downloadResult(result: ForgeResult, fileName: string) {
  const link = document.createElement('a')
  link.href = result.dataUrl
  link.download = fileName
  link.click()
}
