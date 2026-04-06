import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog, shell } from 'electron'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const defaultPort = Number(process.env.PORT ?? 3001)
const appUrl = `http://127.0.0.1:${defaultPort}`
const maxHealthWaitMs = 30000
const healthRetryDelayMs = 750

process.env.FOUNDRY_ELECTRON_MAIN = 'true'
process.env.NODE_ENV = 'production'
process.env.PORT = String(defaultPort)

let mainWindow = null
let localServer = null
let isQuitting = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return
  }

  isQuitting = true
  event.preventDefault()
  await stopLocalServer()
  app.quit()
})

app.whenReady().then(async () => {
  try {
    await ensureLocalServer()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  } catch (error) {
    await dialog.showErrorBox(
      'The Foundry Could Not Start',
      error instanceof Error ? error.message : String(error),
    )
    app.quit()
  }
})

async function ensureLocalServer() {
  if (await isServerHealthy()) {
    return
  }

  const serverModule = await import(
    pathToFileURL(path.join(appRoot, 'server', 'index.js')).href
  )
  const nextServer = serverModule.startServer()

  await waitForListeningServer(nextServer)
  localServer = nextServer
  await waitForHealthyServer()
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    backgroundColor: '#0f1311',
    minHeight: 820,
    minWidth: 1180,
    show: false,
    title: 'The Foundry',
    width: 1480,
    height: 980,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  void mainWindow.loadURL(appUrl)
}

async function stopLocalServer() {
  if (!localServer) {
    return
  }

  localServer.closeAllConnections?.()
  await new Promise((resolve) => {
    localServer.close(() => {
      resolve()
    })
  })
}

async function waitForListeningServer(server) {
  if (server.listening) {
    return
  }

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening)
      reject(error)
    }
    const handleListening = () => {
      server.off('error', handleError)
      resolve()
    }

    server.once('error', handleError)
    server.once('listening', handleListening)
  })
}

async function waitForHealthyServer() {
  const startedAt = Date.now()

  while (Date.now() - startedAt < maxHealthWaitMs) {
    if (await isServerHealthy()) {
      return
    }

    await sleep(healthRetryDelayMs)
  }

  throw new Error(
    `The embedded server did not become healthy within ${maxHealthWaitMs / 1000} seconds.`,
  )
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

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
