import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const buildDir = path.join(rootDir, 'build')
const sourceIconPath =
  process.env.FOUNDRY_ICON_SOURCE?.trim() ||
  path.join(rootDir, 'assets', 'branding', 'the-foundry-icon.jpg')
const windowsIconPath = path.join(buildDir, 'icon.ico')
const pngIconPath = path.join(buildDir, 'icon.png')
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const maxPngSize = 512

async function main() {
  await fs.mkdir(buildDir, { recursive: true })
  await fs.access(sourceIconPath)

  const normalizedSource = sharp(sourceIconPath)
    .rotate()
    .resize(maxPngSize, maxPngSize, {
      fit: 'cover',
      position: 'centre',
    })

  await normalizedSource
    .clone()
    .png({
      compressionLevel: 9,
    })
    .toFile(pngIconPath)

  const icoBuffers = await Promise.all(
    icoSizes.map((size) =>
      normalizedSource
        .clone()
        .resize(size, size, {
          fit: 'cover',
          position: 'centre',
        })
        .png({
          compressionLevel: 9,
        })
        .toBuffer(),
    ),
  )
  const icoBuffer = await pngToIco(icoBuffers)

  await fs.writeFile(windowsIconPath, icoBuffer)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
