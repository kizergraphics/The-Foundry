import type { ForgeResult } from './forge'

export function createDataUrl(data: string, mimeType: string): string {
  return `data:${mimeType};base64,${data}`
}

export async function fileToBase64(file: Blob): Promise<string> {
<<<<<<< HEAD
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
=======
  const dataUrl = await blobToDataUrl(file)
  const separatorIndex = dataUrl.indexOf(',')

  if (separatorIndex === -1) {
    throw new Error('Failed to encode the selected file.')
  }

  return dataUrl.slice(separatorIndex + 1)
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const [metadata, encodedPayload] = dataUrl.split(',', 2)

  if (!metadata || encodedPayload === undefined || !metadata.startsWith('data:')) {
    throw new Error('Failed to load the generated image for post-processing.')
  }

  const mimeType = metadata.match(/^data:([^;]+);base64$/)?.[1] ?? 'application/octet-stream'
  const binaryString = atob(encodedPayload)
  const bytes = Uint8Array.from(binaryString, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
>>>>>>> f38f3db (Restore local workspace and hardening changes)
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

<<<<<<< HEAD
  return canvas.toDataURL('image/png')
=======
  return blobToDataUrl(await canvasToBlob(canvas, 'image/png'))
>>>>>>> f38f3db (Restore local workspace and hardening changes)
}

export async function normalizeSquareTextureDataUrl(
  source: string | Blob,
  targetSize: number,
): Promise<string> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source
  const image = await loadImage(blob)
  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  const cropSize = Math.min(image.naturalWidth, image.naturalHeight)
  const sourceX = Math.max(0, Math.round((image.naturalWidth - cropSize) / 2))
  const sourceY = Math.max(0, Math.round((image.naturalHeight - cropSize) / 2))

  context.clearRect(0, 0, targetSize, targetSize)
  context.imageSmoothingEnabled = true
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    targetSize,
    targetSize,
  )

<<<<<<< HEAD
  return canvas.toDataURL('image/png')
=======
  return blobToDataUrl(await canvasToBlob(canvas, 'image/png'))
>>>>>>> f38f3db (Restore local workspace and hardening changes)
}

export async function copyResultToClipboard(result: ForgeResult): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard copy is not supported in this browser.')
  }

<<<<<<< HEAD
  const blob = await fetch(result.dataUrl).then((response) => response.blob())
=======
  const blob = await dataUrlToBlob(result.dataUrl)
>>>>>>> f38f3db (Restore local workspace and hardening changes)
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

<<<<<<< HEAD
  return Array.from({ length: safeFrameCount }, (_, index) => {
=======
  return Promise.all(Array.from({ length: safeFrameCount }, async (_, index) => {
>>>>>>> f38f3db (Restore local workspace and hardening changes)
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

<<<<<<< HEAD
    return canvas.toDataURL('image/png')
  })
=======
    return blobToDataUrl(await canvasToBlob(canvas, 'image/png'))
  }))
>>>>>>> f38f3db (Restore local workspace and hardening changes)
}

type SpriteSheetBounds = {
  bottom: number
  left: number
  right: number
  top: number
}

type SliceSpriteSheetByContentOptions = {
  expectedCount?: number
  padding?: number
}

export async function sliceSpriteSheetFramesByContent(
  source: string | Blob,
  options: SliceSpriteSheetByContentOptions = {},
): Promise<string[]> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source
  const image = await loadImage(blob)
  const analysisCanvas = document.createElement('canvas')
  analysisCanvas.width = image.naturalWidth
  analysisCanvas.height = image.naturalHeight
  const analysisContext = analysisCanvas.getContext('2d', {
    willReadFrequently: true,
  })

  if (!analysisContext) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  analysisContext.drawImage(image, 0, 0)
<<<<<<< HEAD
=======
  await yieldToMainThread()
>>>>>>> f38f3db (Restore local workspace and hardening changes)

  const { data, height, width } = analysisContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
  const rowThreshold = Math.max(3, Math.round(width * 0.002))
  const rowRanges = collectActiveRanges(
    Array.from({ length: height }, (_, y) =>
      countActivePixelsInRow(data, width, y),
    ),
    {
      maxGap: 6,
      minimumSpan: 4,
      threshold: rowThreshold,
    },
  )

  const detectedBounds = rowRanges.flatMap((rowRange) => {
    const rowHeight = rowRange.end - rowRange.start + 1
    const columnThreshold = Math.max(3, Math.round(rowHeight * 0.015))
    const columnRanges = collectActiveRanges(
      Array.from({ length: width }, (_, x) =>
        countActivePixelsInColumn(data, width, height, x, rowRange.start, rowRange.end),
      ),
      {
        maxGap: 8,
        minimumSpan: 4,
        threshold: columnThreshold,
      },
    )

    return columnRanges
      .map((columnRange) =>
        tightenSpriteBounds(
          data,
          width,
          height,
          columnRange.start,
          columnRange.end,
          rowRange.start,
          rowRange.end,
        ),
      )
      .filter((bounds): bounds is SpriteSheetBounds => bounds !== null)
  })

  if (detectedBounds.length === 0) {
    if (options.expectedCount) {
      return sliceSpriteSheetFrames(source, options.expectedCount)
    }

    throw new Error('No VFX frames were detected in the returned sprite sheet.')
  }

  const padding = Math.max(0, Math.round(options.padding ?? 8))
  const outputCanvas = document.createElement('canvas')
  const outputContext = outputCanvas.getContext('2d')

  if (!outputContext) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

<<<<<<< HEAD
  return detectedBounds.map((bounds) => {
=======
  return Promise.all(detectedBounds.map(async (bounds) => {
>>>>>>> f38f3db (Restore local workspace and hardening changes)
    const left = Math.max(0, bounds.left - padding)
    const top = Math.max(0, bounds.top - padding)
    const right = Math.min(width - 1, bounds.right + padding)
    const bottom = Math.min(height - 1, bounds.bottom + padding)
    const outputWidth = Math.max(1, right - left + 1)
    const outputHeight = Math.max(1, bottom - top + 1)

    outputCanvas.width = outputWidth
    outputCanvas.height = outputHeight
    outputContext.clearRect(0, 0, outputWidth, outputHeight)
    outputContext.drawImage(
      image,
      left,
      top,
      outputWidth,
      outputHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    )

<<<<<<< HEAD
    return outputCanvas.toDataURL('image/png')
  })
=======
    return blobToDataUrl(await canvasToBlob(outputCanvas, 'image/png'))
  }))
>>>>>>> f38f3db (Restore local workspace and hardening changes)
}

type SliceImageGridOptions = {
  columns: number
  count?: number
  rows: number
}

export async function sliceImageGrid(
  source: string | Blob,
  options: SliceImageGridOptions,
): Promise<string[]> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source
  const image = await loadImage(blob)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.')
  }

  const safeColumns = Math.max(1, Math.round(options.columns))
  const safeRows = Math.max(1, Math.round(options.rows))
  const safeCount = Math.min(
    Math.max(1, Math.round(options.count ?? safeColumns * safeRows)),
    safeColumns * safeRows,
  )
  const sliceWidth = image.naturalWidth / safeColumns
  const sliceHeight = image.naturalHeight / safeRows
  const outputWidth = Math.max(1, Math.round(sliceWidth))
  const outputHeight = Math.max(1, Math.round(sliceHeight))
  canvas.width = outputWidth
  canvas.height = outputHeight

<<<<<<< HEAD
  return Array.from({ length: safeCount }, (_, index) => {
=======
  return Promise.all(Array.from({ length: safeCount }, async (_, index) => {
>>>>>>> f38f3db (Restore local workspace and hardening changes)
    const column = index % safeColumns
    const row = Math.floor(index / safeColumns)

    context.clearRect(0, 0, outputWidth, outputHeight)
    context.drawImage(
      image,
      column * sliceWidth,
      row * sliceHeight,
      sliceWidth,
      sliceHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    )

<<<<<<< HEAD
    return canvas.toDataURL('image/png')
  })
=======
    return blobToDataUrl(await canvasToBlob(canvas, 'image/png'))
  }))
>>>>>>> f38f3db (Restore local workspace and hardening changes)
}

export function slicePortraitStudioFaces(source: string | Blob): Promise<string[]> {
  return sliceImageGrid(source, {
    columns: 3,
    count: 5,
    rows: 2,
  })
}

export function downloadResult(result: ForgeResult, fileName: string) {
  downloadDataUrl(result.dataUrl, fileName)
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = dataUrl
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

function countActivePixelsInRow(
  data: Uint8ClampedArray,
  width: number,
  y: number,
) {
  let count = 0
  const rowOffset = y * width * 4

  for (let x = 0; x < width; x += 1) {
    if (isActiveSpritePixel(data, rowOffset + x * 4)) {
      count += 1
    }
  }

  return count
}

function countActivePixelsInColumn(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  startY: number,
  endY: number,
) {
  let count = 0
  const safeStartY = Math.max(0, startY)
  const safeEndY = Math.min(height - 1, endY)

  for (let y = safeStartY; y <= safeEndY; y += 1) {
    if (isActiveSpritePixel(data, (y * width + x) * 4)) {
      count += 1
    }
  }

  return count
}

function collectActiveRanges(
  values: number[],
  options: {
    maxGap: number
    minimumSpan: number
    threshold: number
  },
) {
  const ranges: Array<{ end: number; start: number }> = []
  let rangeStart = -1
  let lastActiveIndex = -1

  values.forEach((value, index) => {
    const isActive = value >= options.threshold

    if (isActive) {
      if (rangeStart === -1) {
        rangeStart = index
      }
      lastActiveIndex = index
      return
    }

    if (rangeStart === -1) {
      return
    }

    if (index - lastActiveIndex <= options.maxGap) {
      return
    }

    if (lastActiveIndex - rangeStart + 1 >= options.minimumSpan) {
      ranges.push({
        end: lastActiveIndex,
        start: rangeStart,
      })
    }

    rangeStart = -1
    lastActiveIndex = -1
  })

  if (
    rangeStart !== -1 &&
    lastActiveIndex - rangeStart + 1 >= options.minimumSpan
  ) {
    ranges.push({
      end: lastActiveIndex,
      start: rangeStart,
    })
  }

  return ranges
}

function tightenSpriteBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
): SpriteSheetBounds | null {
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  let activePixelCount = 0

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (!isActiveSpritePixel(data, (y * width + x) * 4)) {
        continue
      }

      activePixelCount += 1
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }

  if (activePixelCount < 12 || right < left || bottom < top) {
    return null
  }

  return {
    bottom,
    left,
    right,
    top,
  }
}

function isActiveSpritePixel(data: Uint8ClampedArray, offset: number) {
  const alpha = data[offset + 3]

  if (alpha < 12) {
    return false
  }

  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  const maxChannel = Math.max(red, green, blue)

  return maxChannel >= 24 || red + green + blue >= 54
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
<<<<<<< HEAD
=======

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Failed to serialize the generated image.'))
    }
    reader.onerror = () => reject(new Error('Failed to serialize the generated image.'))
    reader.readAsDataURL(blob)
  })
}

function yieldToMainThread() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}
>>>>>>> f38f3db (Restore local workspace and hardening changes)
