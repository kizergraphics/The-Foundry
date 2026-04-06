import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distIndexPath = path.join(rootDir, 'dist', 'index.html')
const appName = 'The Foundry'
const port = Number(process.env.PORT ?? 3001)
const appUrl = `http://127.0.0.1:${port}`
const maxHealthWaitMs = 30000
const healthRetryDelayMs = 750
const chromiumWindowSize = '1480,980'
const explicitBrowserPath = process.env.FOUNDRY_DESKTOP_BROWSER?.trim() ?? ''

async function main() {
  if (!(await isServerHealthy())) {
    await ensureBuild()
    startServer()
    await waitForHealthyServer()
  }

  await openDesktopWindow(appUrl)
}

async function ensureBuild() {
  try {
    await fs.access(distIndexPath)
  } catch {
    await runCommand(getNpmCommand(), ['run', 'build'], {
      stdio: 'inherit',
    })
  }
}

function startServer() {
  const serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: 'ignore',
    windowsHide: true,
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

async function openDesktopWindow(url) {
  const desktopBrowser = await resolveDesktopBrowser()

  if (!desktopBrowser) {
    openBrowser(url)
    return
  }

  const profileDir = await ensureChromiumProfileDir(desktopBrowser.profileFolder)
  const browserProcess = spawn(
    desktopBrowser.command,
    [
      `--app=${url}`,
      '--new-window',
      `--window-size=${chromiumWindowSize}`,
      '--disable-session-crashed-bubble',
      '--no-first-run',
      `--user-data-dir=${profileDir}`,
    ],
    {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  )

  browserProcess.unref()
}

async function resolveDesktopBrowser() {
  if (explicitBrowserPath) {
    return {
      command: explicitBrowserPath,
      profileFolder: 'custom-browser',
    }
  }

  const candidates = getBrowserCandidates()

  for (const candidate of candidates) {
    const resolvedPath = await findBrowserExecutable(candidate)

    if (resolvedPath) {
      return {
        command: resolvedPath,
        profileFolder: candidate.profileFolder,
      }
    }
  }

  return null
}

function getBrowserCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 =
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'

  if (process.platform === 'win32') {
    return [
      {
        commands: ['msedge.exe', 'msedge'],
        paths: [
          path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
        profileFolder: 'edge',
      },
      {
        commands: ['chrome.exe', 'chrome'],
        paths: [
          path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
        profileFolder: 'chrome',
      },
      {
        commands: ['brave.exe', 'brave-browser', 'brave'],
        paths: [
          path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        ],
        profileFolder: 'brave',
      },
    ]
  }

  if (process.platform === 'darwin') {
    return [
      {
        commands: ['Microsoft Edge'],
        paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
        profileFolder: 'edge',
      },
      {
        commands: ['Google Chrome'],
        paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        profileFolder: 'chrome',
      },
      {
        commands: ['Brave Browser'],
        paths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
        profileFolder: 'brave',
      },
    ]
  }

  return [
    {
      commands: ['microsoft-edge', 'microsoft-edge-stable'],
      paths: [],
      profileFolder: 'edge',
    },
    {
      commands: ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'],
      paths: [],
      profileFolder: 'chrome',
    },
    {
      commands: ['brave-browser', 'brave'],
      paths: [],
      profileFolder: 'brave',
    },
  ]
}

async function findBrowserExecutable(candidate) {
  for (const browserPath of candidate.paths) {
    if (await pathExists(browserPath)) {
      return browserPath
    }
  }

  for (const command of candidate.commands) {
    const resolvedCommand = await findCommandOnPath(command)

    if (resolvedCommand) {
      return resolvedCommand
    }
  }

  return null
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function findCommandOnPath(command) {
  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = await runCommand(lookupCommand, [command], {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).catch(() => null)

  if (!result?.stdout) {
    return null
  }

  const [resolvedCommand] = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  return resolvedCommand ?? null
}

async function ensureChromiumProfileDir(profileFolder) {
  const profileRoot = resolveProfileRoot()
  const profileDir = path.join(profileRoot, profileFolder)
  await fs.mkdir(profileDir, { recursive: true })
  return profileDir
}

function resolveProfileRoot() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'TheFoundryDesktop',
    )
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'TheFoundryDesktop')
  }

  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'TheFoundryDesktop',
  )
}

async function runCommand(command, args, options = {}) {
  const stdio = options.stdio ?? 'ignore'

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: false,
      stdio,
      windowsHide: true,
    })

    let stdout = ''

    if (Array.isArray(stdio) && stdio[1] === 'pipe') {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
    }

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout })
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`))
    })
  })
}

function openBrowser(url) {
  const command =
    process.platform === 'win32'
      ? 'cmd.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  const args =
    process.platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url]
  const browserProcess = spawn(command, args, {
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
  process.stderr.write(`${appName}: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
