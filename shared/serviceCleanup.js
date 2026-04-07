import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const serviceStateFileName = 'service-state.json'
const runtimeDirectoryName = 'TheFoundryDesktop'

export function resolveRuntimeDirectory(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDirectory = options.homeDirectory ?? os.homedir()

  if (platform === 'win32') {
    return path.join(
      env.LOCALAPPDATA ?? path.join(homeDirectory, 'AppData', 'Local'),
      runtimeDirectoryName,
    )
  }

  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', runtimeDirectoryName)
  }

  return path.join(
    env.XDG_CONFIG_HOME ?? path.join(homeDirectory, '.config'),
    runtimeDirectoryName,
  )
}

export function resolveServiceStatePath(options = {}) {
  return path.join(resolveRuntimeDirectory(options), serviceStateFileName)
}

export function normalizeServiceRecord(record) {
  if (!record || typeof record !== 'object') {
    return null
  }

  const pid = normalizePositiveInteger(record.pid)

  if (!pid) {
    return null
  }

  const port = normalizePositiveInteger(record.port)

  return {
    kind: typeof record.kind === 'string' && record.kind.trim() ? record.kind.trim() : 'unknown',
    pid,
    port,
    registeredAt:
      typeof record.registeredAt === 'string' && record.registeredAt.trim()
        ? record.registeredAt.trim()
        : new Date().toISOString(),
    workingDirectory:
      typeof record.workingDirectory === 'string' && record.workingDirectory.trim()
        ? record.workingDirectory.trim()
        : null,
  }
}

export function isFoundryOwnedProcess(processInfo, options = {}) {
  if (!processInfo || typeof processInfo !== 'object') {
    return false
  }

  const normalizedName = normalizeForMatch(processInfo.name)
  const normalizedExecutablePath = normalizeForMatch(processInfo.executablePath)
  const normalizedCommandLine = normalizeForMatch(processInfo.commandLine)
  const normalizedCombined = [
    normalizedName,
    normalizedExecutablePath,
    normalizedCommandLine,
  ].join(' ')

  const currentExecutableName = normalizeForMatch(
    options.execPath ? path.basename(options.execPath) : null,
  )
  const productName = normalizeForMatch(options.productName ?? 'The Foundry')
  const pathHints = [
    options.appRoot,
    options.resourcesPath,
    options.workingDirectory,
    ...(Array.isArray(options.additionalPathHints) ? options.additionalPathHints : []),
  ]
    .map((value) => normalizeForMatch(value))
    .filter(Boolean)
  const matchesKnownPath = pathHints.some((hint) => normalizedCombined.includes(hint))
  const looksLikeLocalApiProcess =
    normalizedCommandLine.includes('server/index.js') && matchesKnownPath
  const matchesCurrentExecutable =
    Boolean(currentExecutableName) &&
    (normalizedName === currentExecutableName ||
      normalizedExecutablePath.endsWith(`/${currentExecutableName}`))
  const matchesProductName =
    Boolean(productName) &&
    (normalizedName.includes(productName) || normalizedExecutablePath.includes(productName))

  return looksLikeLocalApiProcess || matchesCurrentExecutable || matchesProductName
}

export async function recordServiceInstance(record, options = {}) {
  const normalizedRecord = normalizeServiceRecord(record)

  if (!normalizedRecord) {
    return null
  }

  const state = await readServiceState(options)
  const nextServices = state.services.filter((service) => service.pid !== normalizedRecord.pid)
  nextServices.push(normalizedRecord)
  await writeServiceState(nextServices, options)
  return normalizedRecord
}

export async function forgetServiceInstance(pid, options = {}) {
  const normalizedPid = normalizePositiveInteger(pid)

  if (!normalizedPid) {
    return
  }

  const state = await readServiceState(options)
  const nextServices = state.services.filter((service) => service.pid !== normalizedPid)
  await writeServiceState(nextServices, options)
}

export async function cleanupStaleServices(options = {}) {
  const currentPid = normalizePositiveInteger(options.currentPid) ?? process.pid
  const defaultPort =
    normalizePositiveInteger(options.defaultPort) ?? normalizePositiveInteger(process.env.PORT) ?? 3001
  const state = await readServiceState(options)
  const terminatedServices = []
  const terminatedPids = new Set()
  const remainingServices = []

  for (const service of state.services) {
    if (service.pid === currentPid) {
      remainingServices.push(service)
      continue
    }

    const processInfo = await getProcessInfo(service.pid, options)

    if (!processInfo) {
      continue
    }

    if (
      !isFoundryOwnedProcess(processInfo, {
        ...options,
        workingDirectory: service.workingDirectory,
      })
    ) {
      remainingServices.push(service)
      continue
    }

    if (await terminateProcessTree(service.pid, options)) {
      terminatedPids.add(service.pid)
      terminatedServices.push({
        kind: service.kind,
        pid: service.pid,
        port: service.port,
        source: 'registry',
      })
      continue
    }

    remainingServices.push(service)
  }

  const portsToCheck = Array.from(
    new Set(
      [defaultPort, ...state.services.map((service) => service.port)]
        .map((port) => normalizePositiveInteger(port))
        .filter(Boolean),
    ),
  )

  for (const port of portsToCheck) {
    const listeningPids = await getListeningProcessIdsForPort(port, options)

    for (const pid of listeningPids) {
      if (pid === currentPid || terminatedPids.has(pid)) {
        continue
      }

      const processInfo = await getProcessInfo(pid, options)

      if (!processInfo || !isFoundryOwnedProcess(processInfo, options)) {
        continue
      }

      if (!(await terminateProcessTree(pid, options))) {
        continue
      }

      terminatedPids.add(pid)
      terminatedServices.push({
        kind: 'unknown',
        pid,
        port,
        source: 'port-scan',
      })
    }
  }

  const nextServices = remainingServices.filter((service) => !terminatedPids.has(service.pid))
  await writeServiceState(nextServices, options)

  return {
    remainingServices: nextServices,
    terminatedServices,
  }
}

async function readServiceState(options = {}) {
  const statePath = resolveServiceStatePath(options)

  try {
    const rawState = await fs.readFile(statePath, 'utf8')
    const parsedState = JSON.parse(rawState)
    const services = Array.isArray(parsedState?.services)
      ? parsedState.services.map(normalizeServiceRecord).filter(Boolean)
      : []

    return { services }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { services: [] }
    }

    return { services: [] }
  }
}

async function writeServiceState(services, options = {}) {
  const statePath = resolveServiceStatePath(options)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(
    statePath,
    JSON.stringify({ services }, null, 2),
    'utf8',
  )
}

async function getListeningProcessIdsForPort(port, options = {}) {
  const normalizedPort = normalizePositiveInteger(port)

  if (!normalizedPort) {
    return []
  }

  if ((options.platform ?? process.platform) !== 'win32') {
    return []
  }

  const result = await runPowerShellJson(
    `
$connections = Get-NetTCPConnection -State Listen -LocalPort ${normalizedPort} -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
if ($null -eq $connections) {
  @() | ConvertTo-Json -Compress
} else {
  $connections | ConvertTo-Json -Compress
}
    `.trim(),
    options,
  ).catch(() => [])

  return normalizePowerShellArray(result)
    .map((value) => normalizePositiveInteger(value))
    .filter(Boolean)
}

async function getProcessInfo(pid, options = {}) {
  const normalizedPid = normalizePositiveInteger(pid)

  if (!normalizedPid) {
    return null
  }

  if ((options.platform ?? process.platform) !== 'win32') {
    return null
  }

  const result = await runPowerShellJson(
    `
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = ${normalizedPid}" -ErrorAction SilentlyContinue |
  Select-Object ProcessId, Name, ExecutablePath, CommandLine
if ($null -eq $processInfo) {
  $null | ConvertTo-Json -Compress
} else {
  $processInfo | ConvertTo-Json -Compress
}
    `.trim(),
    options,
  ).catch(() => null)

  if (!result || typeof result !== 'object') {
    return null
  }

  return {
    pid: normalizePositiveInteger(result.ProcessId ?? result.processId ?? normalizedPid),
    name: typeof result.Name === 'string' ? result.Name : result.name ?? null,
    executablePath:
      typeof result.ExecutablePath === 'string'
        ? result.ExecutablePath
        : result.executablePath ?? null,
    commandLine:
      typeof result.CommandLine === 'string' ? result.CommandLine : result.commandLine ?? null,
  }
}

async function terminateProcessTree(pid, options = {}) {
  const normalizedPid = normalizePositiveInteger(pid)

  if (!normalizedPid || normalizedPid === process.pid) {
    return false
  }

  if ((options.platform ?? process.platform) !== 'win32') {
    try {
      process.kill(normalizedPid, 'SIGTERM')
      return true
    } catch {
      return false
    }
  }

  try {
    await runCommand('taskkill.exe', ['/PID', String(normalizedPid), '/T', '/F'], options)
    return true
  } catch {
    return false
  }
}

async function runPowerShellJson(script, options = {}) {
  const stdout = await runCommand(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ],
    options,
  )

  const trimmed = stdout.trim()

  if (!trimmed) {
    return null
  }

  return JSON.parse(trimmed)
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      reject(
        new Error(
          `${command} exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      )
    })
  })
}

function normalizePowerShellArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value === null || typeof value === 'undefined') {
    return []
  }

  return [value]
}

function normalizeForMatch(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\\/gu, '/').replace(/\s+/gu, ' ').toLowerCase()
    : ''
}

function normalizePositiveInteger(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }

  return Math.round(numericValue)
}
