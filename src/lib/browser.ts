import type { ForgeResult } from './forge'

export function createDataUrl(data: string, mimeType: string): string {
  return `data:${mimeType};base64,${data}`
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

type TextureExpansionInputOptions = {
  sourceCoverage?: number
  targetSize?: number
}

type TextureExpansionInput = {
  base64: string
  mimeType: string
  sourceCoverage: number
  sourceHeight: number
  sourceWidth: number
  targetSize: number
}

export async function buildTextureExpansionInput(
  file: Blob,
  options: TextureExpansionInputOptions = {},
): Promise<TextureExpansionInput> {
  const targetSize = options.targetSize ?? 1024
  const sourceCoverage = options.sourceCoverage ?? 0.5
  const image = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  const maxSourceSize = targetSize * sourceCoverage
  const drawScale = Math.min(
    maxSourceSize / image.naturalWidth,
    maxSourceSize / image.naturalHeight,
  )
  const drawWidth = Math.round(image.naturalWidth * drawScale)
  const drawHeight = Math.round(image.naturalHeight * drawScale)
  const drawX = Math.round((targetSize - drawWidth) / 2)
  const drawY = Math.round((targetSize - drawHeight) / 2)

  context.clearRect(0, 0, targetSize, targetSize)
  context.imageSmoothingEnabled = true
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight)

  const blob = await canvasToBlob(canvas, 'image/png')

  return {
    base64: await fileToBase64(blob),
    mimeType: 'image/png',
    sourceCoverage,
    sourceHeight: image.naturalHeight,
    sourceWidth: image.naturalWidth,
    targetSize,
  }
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

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () =>
        reject(new Error('The selected texture could not be decoded as an image.'))
      nextImage.src = objectUrl
    })

    return image
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Failed to serialize the expansion canvas.'))
    }, mimeType)
  })
}
