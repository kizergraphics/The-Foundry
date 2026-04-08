import os from 'node:os'
import path from 'node:path'

const relaunchMarkerArg = '--foundry-portable-relaunch'

export function getPortableRelaunchMarkerArg() {
  return relaunchMarkerArg
}

export function resolvePortableExecutablePath(env = process.env) {
  const portableExecutablePath = normalizePath(env?.PORTABLE_EXECUTABLE_FILE)
  return portableExecutablePath || null
}

export function shouldHandlePortableSecondInstance(options = {}) {
  if (!options.isPackaged) {
    return false
  }

  return Boolean(resolvePortableExecutablePath(options.env))
}

export function buildPortableRelaunchOptions(options = {}) {
  if (!shouldHandlePortableSecondInstance(options)) {
    return null
  }

  const execPath =
    resolveRequestedPortableExecutablePath(options.commandLine, options.env) ??
    resolvePortableExecutablePath(options.env)

  if (!execPath) {
    return null
  }

  const args = Array.isArray(options.argv)
    ? options.argv
        .slice(1)
        .filter((value) => normalizeArg(value) !== relaunchMarkerArg)
    : []

  args.push(relaunchMarkerArg)

  return {
    args,
    execPath,
  }
}

export function isPortableRelaunchArg(value) {
  return normalizeArg(value) === relaunchMarkerArg
}

function resolveRequestedPortableExecutablePath(commandLine, env = process.env) {
  if (!Array.isArray(commandLine)) {
    return null
  }

  for (const candidate of commandLine) {
    const normalizedCandidate = normalizePath(candidate)

    if (!normalizedCandidate || !normalizedCandidate.toLowerCase().endsWith('.exe')) {
      continue
    }

    if (looksLikePortableExtractionPath(normalizedCandidate, env)) {
      continue
    }

    return normalizedCandidate
  }

  return null
}

function looksLikePortableExtractionPath(candidatePath, env = process.env) {
  const tempRoots = [
    env?.TEMP,
    env?.TMP,
    os.tmpdir(),
  ]
    .map(normalizePath)
    .filter(Boolean)

  return tempRoots.some((tempRoot) => isPathWithin(candidatePath, tempRoot))
}

function isPathWithin(candidatePath, parentPath) {
  const normalizedCandidate = normalizePath(candidatePath)
  const normalizedParent = normalizePath(parentPath)

  if (!normalizedCandidate || !normalizedParent) {
    return false
  }

  const relativePath = path.relative(normalizedParent, normalizedCandidate)

  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

function normalizeArg(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizePath(value) {
  return typeof value === 'string' && value.trim()
    ? path.normalize(value.trim())
    : ''
}
