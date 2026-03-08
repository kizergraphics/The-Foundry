import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distIndexPath = path.join(rootDir, 'dist', 'index.html')
const appUrl = 'http://localhost:3001'
const maxHealthWaitMs = 30000
const healthRetryDelayMs = 750

async function main() {
  if (!(await isServerHealthy())) {
    await ensureBuild()
    startServer()
    await waitForHealthyServer()
  }

  openBrowser(appUrl)
}

async function ensureBuild() {
  try {
    await fs.access(distIndexPath)
  } catch {
    await runCommand(getNpmCommand(), ['run', 'build'])
  }
}

function startServer() {
  const serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
    stdio: 'ignore',
  })

  serverProcess.unref()
}

async function waitForHealthyServer() {
  const startedAt = Date.now()

  while (Date.now() - startedAt < maxHealthWaitMs) {
    if (await isServerHealthy()) {
      return
    }

    await sleep(healthRetryDelayMs)
  }

  throw new Error(`Server did not become healthy within ${maxHealthWaitMs / 1000} seconds.`)
}

async function isServerHealthy() {
  return new Promise((resolve) => {
    const request = http.get(`${appUrl}/api/health`, (response) => {
      response.resume()
      resolve((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300)
    })

    request.on('error', () => {
      resolve(false)
    })

    request.setTimeout(1500, () => {
      request.destroy()
      resolve(false)
    })
  })
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`))
    })
  })
}

function openBrowser(url) {
  const browserProcess = spawn('cmd.exe', ['/c', 'start', '', url], {
    cwd: rootDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })

  browserProcess.unref()
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
