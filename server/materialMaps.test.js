import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { buildMaterialMapsFromGeneratedImages } from './materialMaps.js'

async function createRgbPng(width, height, values) {
  return sharp(Buffer.from(values), {
    raw: {
      channels: 3,
      height,
      width,
    },
  })
    .png()
    .toBuffer()
}

describe('buildMaterialMapsFromGeneratedImages', () => {
  it('returns grayscale utility maps and an RGB normal map at the source size', async () => {
    const sourceWidth = 4
    const sourceHeight = 4
    const heightImageBuffer = await createRgbPng(sourceWidth, sourceHeight, [
      20, 10, 0, 80, 30, 10, 160, 90, 20, 240, 200, 60,
      30, 20, 10, 90, 40, 20, 180, 100, 30, 250, 220, 80,
      40, 30, 20, 100, 50, 30, 190, 110, 40, 255, 230, 90,
      50, 40, 30, 110, 60, 40, 200, 120, 50, 255, 240, 100,
    ])
    const roughnessImageBuffer = await createRgbPng(sourceWidth, sourceHeight, [
      10, 60, 120, 25, 80, 140, 40, 100, 160, 55, 120, 180,
      20, 70, 130, 35, 90, 150, 50, 110, 170, 65, 130, 190,
      30, 80, 140, 45, 100, 160, 60, 120, 180, 75, 140, 200,
      40, 90, 150, 55, 110, 170, 70, 130, 190, 85, 150, 210,
    ])
    const metallicImageBuffer = await createRgbPng(sourceWidth, sourceHeight, [
      0, 40, 80, 30, 70, 110, 60, 100, 140, 90, 130, 170,
      10, 50, 90, 40, 80, 120, 70, 110, 150, 100, 140, 180,
      20, 60, 100, 50, 90, 130, 80, 120, 160, 110, 150, 190,
      30, 70, 110, 60, 100, 140, 90, 130, 170, 120, 160, 200,
    ])

    const maps = await buildMaterialMapsFromGeneratedImages({
      heightImageBuffer,
      heightStrength: 60,
      metallicImageBuffer,
      metallicStrength: 60,
      normalStrength: 60,
      roughnessImageBuffer,
      roughnessStrength: 60,
      sourceHeight,
      sourceWidth,
    })

    const heightMetadata = await sharp(maps.height.buffer).metadata()
    const roughnessMetadata = await sharp(maps.roughness.buffer).metadata()
    const metallicMetadata = await sharp(maps.metallic.buffer).metadata()
    const normalMetadata = await sharp(maps.normal.buffer).metadata()
    const decodedHeight = await sharp(maps.height.buffer).raw().toBuffer({ resolveWithObject: true })
    const decodedRoughness = await sharp(maps.roughness.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const decodedMetallic = await sharp(maps.metallic.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(heightMetadata.width).toBe(sourceWidth)
    expect(heightMetadata.height).toBe(sourceHeight)
    expect(normalMetadata.width).toBe(sourceWidth)
    expect(normalMetadata.height).toBe(sourceHeight)
    expect(normalMetadata.channels).toBe(3)
    expect(isGrayscale(decodedHeight.data, decodedHeight.info.channels)).toBe(true)
    expect(isGrayscale(decodedRoughness.data, decodedRoughness.info.channels)).toBe(true)
    expect(isGrayscale(decodedMetallic.data, decodedMetallic.info.channels)).toBe(true)
  })

  it('produces a stronger normal response when normalStrength increases', async () => {
    const sourceWidth = 4
    const sourceHeight = 4
    const gradientImageBuffer = await createRgbPng(sourceWidth, sourceHeight, [
      10, 10, 10, 60, 60, 60, 140, 140, 140, 240, 240, 240,
      10, 10, 10, 60, 60, 60, 140, 140, 140, 240, 240, 240,
      10, 10, 10, 60, 60, 60, 140, 140, 140, 240, 240, 240,
      10, 10, 10, 60, 60, 60, 140, 140, 140, 240, 240, 240,
    ])

    const lowStrengthMaps = await buildMaterialMapsFromGeneratedImages({
      heightImageBuffer: gradientImageBuffer,
      heightStrength: 60,
      metallicImageBuffer: gradientImageBuffer,
      metallicStrength: 60,
      normalStrength: 0,
      roughnessImageBuffer: gradientImageBuffer,
      roughnessStrength: 60,
      sourceHeight,
      sourceWidth,
    })
    const highStrengthMaps = await buildMaterialMapsFromGeneratedImages({
      heightImageBuffer: gradientImageBuffer,
      heightStrength: 60,
      metallicImageBuffer: gradientImageBuffer,
      metallicStrength: 60,
      normalStrength: 100,
      roughnessImageBuffer: gradientImageBuffer,
      roughnessStrength: 60,
      sourceHeight,
      sourceWidth,
    })
    const lowStrengthRaw = await sharp(lowStrengthMaps.normal.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const highStrengthRaw = await sharp(highStrengthMaps.normal.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const measureDeviation = (buffer) => {
      let totalDeviation = 0

      for (let index = 0; index < buffer.length; index += 3) {
        totalDeviation += Math.abs(buffer[index] - 128)
        totalDeviation += Math.abs(buffer[index + 1] - 128)
        totalDeviation += Math.abs(buffer[index + 2] - 255)
      }

      return totalDeviation / (buffer.length / 3)
    }

    expect(measureDeviation(highStrengthRaw.data)).toBeGreaterThan(
      measureDeviation(lowStrengthRaw.data),
    )
  })
})

function isGrayscale(buffer, channels) {
  if (channels <= 1) {
    return true
  }

  for (let index = 0; index < buffer.length; index += channels) {
    if (buffer[index] !== buffer[index + 1] || buffer[index] !== buffer[index + 2]) {
      return false
    }
  }

  return true
}
