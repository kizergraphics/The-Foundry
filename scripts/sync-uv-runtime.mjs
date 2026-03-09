import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const publicWasmDir = path.join(rootDir, 'public', 'wasm')

const assetCopies = [
  {
    from: path.join(
      rootDir,
      'node_modules',
      '@sruim',
      'mesh-flow',
      'dist',
      'wasm',
      'assimpjs-all.js',
    ),
    to: path.join(publicWasmDir, 'assimpjs-all.js'),
  },
  {
    from: path.join(
      rootDir,
      'node_modules',
      '@sruim',
      'mesh-flow',
      'dist',
      'wasm',
      'assimpjs-all.wasm',
    ),
    to: path.join(publicWasmDir, 'assimpjs-all.wasm'),
  },
  {
    from: path.join(
      rootDir,
      'node_modules',
      '@sruim',
      'mesh-flow',
      'dist',
      'wasm',
      'assimpjs-exporter.js',
    ),
    to: path.join(publicWasmDir, 'assimpjs-exporter.js'),
  },
  {
    from: path.join(
      rootDir,
      'node_modules',
      '@sruim',
      'mesh-flow',
      'dist',
      'wasm',
      'assimpjs-exporter.wasm',
    ),
    to: path.join(publicWasmDir, 'assimpjs-exporter.wasm'),
  },
  {
    from: path.join(rootDir, 'node_modules', 'xatlasjs', 'dist', 'xatlas.js'),
    to: path.join(publicWasmDir, 'xatlas.js'),
  },
  {
    from: path.join(rootDir, 'node_modules', 'xatlasjs', 'dist', 'xatlas.wasm'),
    to: path.join(publicWasmDir, 'xatlas.wasm'),
  },
]

async function main() {
  await fs.mkdir(publicWasmDir, { recursive: true })

  for (const asset of assetCopies) {
    await fs.copyFile(asset.from, asset.to)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
