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

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)

  if (!response.ok) {
    throw new Error('Failed to load the generated image for post-processing.')
  }

  return response.blob()
}

export async function dataUrlToFile(
  dataUrl: string,
  fileName: string,
): Promise<File> {
  const blob = await dataUrlToBlob(dataUrl)

  return new File([blob], fileName, {
    type: blob.type || 'image/png',
  })
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

type TextureSeamRepairInput = {
  mimeType: string
  offsetBase64: string
  originalBase64: string
  sourceHeight: number
  sourceWidth: number
}

export async function buildTextureSeamRepairInput(
  source: Blob,
): Promise<TextureSeamRepairInput> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  const width = image.naturalWidth
  const height = image.naturalHeight
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  const offsetX = -Math.round(width / 2)
  const offsetY = -Math.round(height / 2)

  for (const x of [offsetX, offsetX + width]) {
    for (const y of [offsetY, offsetY + height]) {
      context.drawImage(image, x, y, width, height)
    }
  }

  const offsetBlob = await canvasToBlob(canvas, 'image/png')

  return {
    mimeType: 'image/png',
    offsetBase64: await fileToBase64(offsetBlob),
    originalBase64: await fileToBase64(source),
    sourceHeight: height,
    sourceWidth: width,
  }
}

export async function buildTiledPreviewDataUrl(
  source: string | Blob,
  repeats = 3,
): Promise<string> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source
  const image = await loadImage(blob)
  const canvas = document.createElement('canvas')
  const width = image.naturalWidth
  const height = image.naturalHeight
  canvas.width = width * repeats
  canvas.height = height * repeats

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  for (let x = 0; x < repeats; x += 1) {
    for (let y = 0; y < repeats; y += 1) {
      context.drawImage(image, x * width, y * height, width, height)
    }
  }

  return canvas.toDataURL('image/png')
}

export async function copyResultToClipboard(result: ForgeResult): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard copy is not supported in this browser.')
  }

  const blob = await fetch(result.dataUrl).then((response) => response.blob())
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export async function sliceSpriteSheetFrames(
  source: string | Blob,
  frameCount: number,
): Promise<string[]> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source
  const image = await loadImage(blob)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  const safeFrameCount = Math.max(1, Math.round(frameCount))
  const frameWidth = Math.max(1, Math.floor(image.naturalWidth / safeFrameCount))
  const frameHeight = image.naturalHeight
  canvas.width = frameWidth
  canvas.height = frameHeight

  return Array.from({ length: safeFrameCount }, (_, index) => {
    context.clearRect(0, 0, frameWidth, frameHeight)
    context.drawImage(
      image,
      index * frameWidth,
      0,
      frameWidth,
      frameHeight,
      0,
      0,
      frameWidth,
      frameHeight,
    )

    return canvas.toDataURL('image/png')
  })
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
