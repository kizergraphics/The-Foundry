import sharp from 'sharp'

const pngOptions = {
  compressionLevel: 9,
}

export const defaultMaterialMapStrengths = {
  heightStrength: 60,
  metallicStrength: 60,
  normalStrength: 60,
  roughnessStrength: 60,
}

export function clampMaterialMapStrength(value, fallback = 60) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)))
}

export function normalizeMaterialMapStrengths(value = {}) {
  return {
    heightStrength: clampMaterialMapStrength(
      value.heightStrength,
      defaultMaterialMapStrengths.heightStrength,
    ),
    metallicStrength: clampMaterialMapStrength(
      value.metallicStrength,
      defaultMaterialMapStrengths.metallicStrength,
    ),
    normalStrength: clampMaterialMapStrength(
      value.normalStrength,
      defaultMaterialMapStrengths.normalStrength,
    ),
    roughnessStrength: clampMaterialMapStrength(
      value.roughnessStrength,
      defaultMaterialMapStrengths.roughnessStrength,
    ),
  }
}

export async function readMaterialMapSourceMetadata(sourceImageBuffer) {
  const metadata = await sharp(sourceImageBuffer).metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error('The material-map source image could not be decoded.')
  }

  return {
    height: metadata.height,
    width: metadata.width,
  }
}

export async function buildMaterialMapsFromGeneratedImages({
  heightImageBuffer,
  metallicImageBuffer,
  normalStrength,
  roughnessImageBuffer,
  roughnessStrength,
  sourceHeight,
  sourceWidth,
  heightStrength,
  metallicStrength,
}) {
  const normalizedStrengths = normalizeMaterialMapStrengths({
    heightStrength,
    metallicStrength,
    normalStrength,
    roughnessStrength,
  })
  const heightData = await decodeGrayscaleImage(heightImageBuffer, sourceWidth, sourceHeight)
  const roughnessData = await decodeGrayscaleImage(
    roughnessImageBuffer,
    sourceWidth,
    sourceHeight,
  )
  const metallicData = await decodeGrayscaleImage(
    metallicImageBuffer,
    sourceWidth,
    sourceHeight,
  )

  const finalHeightData = adjustHeightMap(heightData, normalizedStrengths.heightStrength)
  const finalRoughnessData = adjustRoughnessMap(
    roughnessData,
    normalizedStrengths.roughnessStrength,
  )
  const finalMetallicData = adjustMetallicMap(
    metallicData,
    normalizedStrengths.metallicStrength,
  )
  const normalData = buildNormalMapFromHeightData(
    finalHeightData,
    sourceWidth,
    sourceHeight,
    normalizedStrengths.normalStrength,
  )

  return {
    height: {
      buffer: await encodeGrayscalePng(finalHeightData, sourceWidth, sourceHeight),
      height: sourceHeight,
      mimeType: 'image/png',
      width: sourceWidth,
    },
    metallic: {
      buffer: await encodeGrayscalePng(finalMetallicData, sourceWidth, sourceHeight),
      height: sourceHeight,
      mimeType: 'image/png',
      width: sourceWidth,
    },
    normal: {
      buffer: await sharp(normalData, {
        raw: {
          channels: 3,
          height: sourceHeight,
          width: sourceWidth,
        },
      })
        .png(pngOptions)
        .toBuffer(),
      height: sourceHeight,
      mimeType: 'image/png',
      width: sourceWidth,
    },
    roughness: {
      buffer: await encodeGrayscalePng(finalRoughnessData, sourceWidth, sourceHeight),
      height: sourceHeight,
      mimeType: 'image/png',
      width: sourceWidth,
    },
  }
}

async function decodeGrayscaleImage(imageBuffer, width, height) {
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .resize(width, height, {
      fit: 'fill',
    })
    .grayscale()
    .normalise()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return toSingleChannelBuffer(data, info.channels)
}

function toSingleChannelBuffer(data, channels) {
  if (channels <= 1) {
    return Buffer.from(data)
  }

  const output = Buffer.alloc(Math.floor(data.length / channels))

  for (let index = 0; index < output.length; index += 1) {
    output[index] = data[index * channels]
  }

  return output
}

function adjustHeightMap(data, strength) {
  const contrast = 0.45 + (strength / 100) * 1.85
  const blend = Math.min(1, strength / defaultMaterialMapStrengths.heightStrength)
  const output = Buffer.alloc(data.length)

  for (let index = 0; index < data.length; index += 1) {
    output[index] = clampChannel(128 + (data[index] - 128) * contrast * blend)
  }

  return output
}

function adjustRoughnessMap(data, strength) {
  const contrast = 0.55 + (strength / 100) * 1.1
  const output = Buffer.alloc(data.length)

  for (let index = 0; index < data.length; index += 1) {
    output[index] = clampChannel(128 + (data[index] - 128) * contrast)
  }

  return output
}

function adjustMetallicMap(data, strength) {
  const normalizedStrength = strength / 100
  const gamma = 2.2 - normalizedStrength * 1.4
  const scale = 0.22 + normalizedStrength * 0.78
  const output = Buffer.alloc(data.length)

  for (let index = 0; index < data.length; index += 1) {
    const normalizedValue = data[index] / 255
    const maskedValue = Math.pow(normalizedValue, gamma) * 255 * scale
    output[index] = clampChannel(maskedValue)
  }

  return output
}

function buildNormalMapFromHeightData(heightData, width, height, strength) {
  if (strength <= 0) {
    return buildFlatNormalMap(width, height)
  }

  const output = Buffer.alloc(width * height * 3)
  const intensity = (strength / 100) * 6

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = sampleHeight(heightData, width, height, x - 1, y)
      const right = sampleHeight(heightData, width, height, x + 1, y)
      const up = sampleHeight(heightData, width, height, x, y - 1)
      const down = sampleHeight(heightData, width, height, x, y + 1)
      const dx = ((right - left) / 255) * intensity
      const dy = ((down - up) / 255) * intensity
      const nx = -dx
      const ny = -dy
      const nz = 1
      const length = Math.hypot(nx, ny, nz) || 1
      const offset = (y * width + x) * 3

      output[offset] = clampChannel(((nx / length) * 0.5 + 0.5) * 255)
      output[offset + 1] = clampChannel(((ny / length) * 0.5 + 0.5) * 255)
      output[offset + 2] = clampChannel(((nz / length) * 0.5 + 0.5) * 255)
    }
  }

  return output
}

function buildFlatNormalMap(width, height) {
  const output = Buffer.alloc(width * height * 3)

  for (let index = 0; index < output.length; index += 3) {
    output[index] = 128
    output[index + 1] = 128
    output[index + 2] = 255
  }

  return output
}

function sampleHeight(data, width, height, x, y) {
  const safeX = Math.max(0, Math.min(width - 1, x))
  const safeY = Math.max(0, Math.min(height - 1, y))
  return data[safeY * width + safeX]
}

async function encodeGrayscalePng(data, width, height) {
  return sharp(data, {
    raw: {
      channels: 1,
      height,
      width,
    },
  })
    .png(pngOptions)
    .toBuffer()
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}
