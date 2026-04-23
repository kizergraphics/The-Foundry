import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  telemetryModelDefinitions,
  telemetryModelIdByAlias,
  telemetryModelsById,
} from './telemetryModelCatalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')
const usageFilePath = path.join(dataDir, 'usage-log.json')
const usageEventLogPath = path.join(dataDir, 'usage-events.ndjson')
const pacificTimeZone = 'America/Los_Angeles'
const defaultDailyRequestLimit = 1500
const defaultRequestCostEstimate = 0.0005
const minuteWindowMs = 60 * 1000
const chartBucketCount = 8
const chartBucketDurationMs = 5 * minuteWindowMs

const requestCostByModel = {
  'gemini-2.5-flash-image': 0.0005,
  'gemini-3-flash': 0.0005,
  'gemini-3-pro': 0.0012,
  'gemini-3-pro-image-preview': 0.0012,
  'gemini-3-flash-text': 0.0003,
  'gemini-2.5-flash-text': 0.0003,
  'openai-gpt-image-2': 0.053,
  'gpt-image-2': 0.053,
}

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: pacificTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

let writeQueue = Promise.resolve()

export async function recordUsageEvent({
  model,
  route,
  telemetryModel,
  timestamp = new Date().toISOString(),
  tokenCount = 0,
}) {
  const normalizedTelemetryModel =
    typeof telemetryModel === 'string' && telemetryModelsById.has(telemetryModel)
      ? telemetryModel
      : null
  const event = {
    model: typeof model === 'string' ? model : 'unknown',
    route: typeof route === 'string' ? route : 'unknown',
    telemetryModel: normalizedTelemetryModel,
    timestamp,
    tokenCount: normalizeTokenCount(tokenCount),
  }

  writeQueue = writeQueue.then(async () => {
    await persistUsageEvent(event)
  })

  await writeQueue
}

export async function getUsageSummary({
  model,
  now = new Date(),
} = {}) {
  const usageStore = await readUsageStore()
  const normalizedScope =
    typeof model === 'string' && model.trim().length > 0 ? model.trim() : null
  const scopedEvents = normalizedScope
    ? usageStore.events.filter((event) => eventMatchesScope(event, normalizedScope))
    : usageStore.events
  const todayKey = toPacificDateKey(now)

  const todayEvents = scopedEvents.filter(
    (event) => toPacificDateKey(event.timestamp) === todayKey,
  )
  const todayTimestamps = todayEvents
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  const requestCostEstimate = resolveRequestCostEstimate(normalizedScope)
  const dailyRequestLimit = resolveDailyRequestLimit(normalizedScope)
  const todayTotal = todayEvents.length
  const peakHourly = computeRollingHourlyPeak(todayTimestamps)
  const costEstimate = roundCurrency(todayTotal * requestCostEstimate)
  const averageDailyUse = computeAverageDailyUse(scopedEvents)
  const projectedMonthlyCost = roundCurrency(averageDailyUse * 30 * requestCostEstimate)

  return {
    activeRpdRatio: dailyRequestLimit > 0 ? todayTotal / dailyRequestLimit : 0,
    averageDailyUse,
    costEstimate,
    dailyLimit: dailyRequestLimit,
    peakHourly,
    projectedMonthlyCost,
    requestCostEstimate,
    scopedModel: normalizedScope,
    timeZone: pacificTimeZone,
    todayTotal,
  }
}

export async function getTelemetrySnapshot({
  now = new Date(),
} = {}) {
  const usageStore = await readUsageStore()
  const nowTimestamp = new Date(now).getTime()
  const minuteStart = nowTimestamp - minuteWindowMs
  const todayKey = toPacificDateKey(now)

  return {
    generatedAt: new Date(nowTimestamp).toISOString(),
    rows: telemetryModelDefinitions.map((definition) => {
      const events = usageStore.events.filter(
        (event) => resolveEventTelemetryModelId(event) === definition.id,
      )
      const minuteEvents = events.filter((event) => {
        const timestamp = Date.parse(event.timestamp)
        return Number.isFinite(timestamp) && timestamp >= minuteStart
      })
      const todayEvents = events.filter(
        (event) => toPacificDateKey(event.timestamp) === todayKey,
      )
      const tpmCurrent =
        definition.limits.tpm === null
          ? null
          : minuteEvents.reduce(
              (sum, event) => sum + normalizeTokenCount(event.tokenCount),
              0,
            )

      return {
        category: definition.category,
        chartPoints: buildChartPoints(events, nowTimestamp),
        id: definition.id,
        label: definition.label,
        lastRequestAt: events.at(-1)?.timestamp ?? null,
        metrics: {
          rpm: buildMetricPayload(minuteEvents.length, definition.limits.rpm),
          rpd: buildMetricPayload(todayEvents.length, definition.limits.rpd),
          tpm:
            definition.limits.tpm === null
              ? buildMetricPayload(null, null)
              : buildMetricPayload(tpmCurrent, definition.limits.tpm),
        },
      }
    }),
    timeZone: pacificTimeZone,
  }
}

async function readUsageStore() {
  const ndjsonStore = await readUsageEventLog()

  if (ndjsonStore.events.length > 0) {
    return ndjsonStore
  }

  try {
    const rawFile = await fs.readFile(usageFilePath, 'utf8')
    const parsed = JSON.parse(rawFile)

    if (!parsed || !Array.isArray(parsed.events)) {
      return { events: [] }
    }

    return {
      events: parsed.events
        .filter(
          (event) =>
            event &&
            typeof event === 'object' &&
            typeof event.timestamp === 'string' &&
            typeof event.model === 'string' &&
            typeof event.route === 'string',
        )
        .map((event) => ({
          model: event.model,
          route: event.route,
          telemetryModel:
            typeof event.telemetryModel === 'string' ? event.telemetryModel : null,
          timestamp: event.timestamp,
          tokenCount: normalizeTokenCount(event.tokenCount),
        })),
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      await persistUsageStore({ events: [] })
      return { events: [] }
    }

    throw error
  }
}

async function persistUsageStore(store) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(usageFilePath, JSON.stringify(store, null, 2), 'utf8')
}

async function persistUsageEvent(event) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.appendFile(usageEventLogPath, `${JSON.stringify(event)}\n`, 'utf8')
}

async function readUsageEventLog() {
  try {
    const rawFile = await fs.readFile(usageEventLogPath, 'utf8')
    const events = rawFile
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line)

          if (
            event &&
            typeof event === 'object' &&
            typeof event.timestamp === 'string' &&
            typeof event.model === 'string' &&
            typeof event.route === 'string'
          ) {
            return [
              {
                model: event.model,
                route: event.route,
                telemetryModel:
                  typeof event.telemetryModel === 'string' ? event.telemetryModel : null,
                timestamp: event.timestamp,
                tokenCount: normalizeTokenCount(event.tokenCount),
              },
            ]
          }
        } catch {
          return []
        }

        return []
      })

    return { events }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { events: [] }
    }

    throw error
  }
}

function buildChartPoints(events, nowTimestamp) {
  const bucketStart = nowTimestamp - chartBucketCount * chartBucketDurationMs
  const points = Array.from({ length: chartBucketCount }, () => 0)

  for (const event of events) {
    const timestamp = Date.parse(event.timestamp)

    if (!Number.isFinite(timestamp) || timestamp < bucketStart || timestamp > nowTimestamp) {
      continue
    }

    const bucketIndex = Math.min(
      chartBucketCount - 1,
      Math.floor((timestamp - bucketStart) / chartBucketDurationMs),
    )

    if (bucketIndex >= 0) {
      points[bucketIndex] += 1
    }
  }

  return points
}

function buildMetricPayload(current, limit) {
  if (
    typeof current !== 'number' ||
    !Number.isFinite(current) ||
    typeof limit !== 'number' ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    return {
      current: null,
      limit: null,
      ratio: null,
    }
  }

  return {
    current,
    limit,
    ratio: Math.max(0, Math.min(current / limit, 1)),
  }
}

function eventMatchesScope(event, scope) {
  if (telemetryModelsById.has(scope)) {
    return resolveEventTelemetryModelId(event) === scope
  }

  const telemetryModelId = telemetryModelIdByAlias[scope]
  if (telemetryModelId) {
    return resolveEventTelemetryModelId(event) === telemetryModelId
  }

  return event.model === scope
}

function resolveEventTelemetryModelId(event) {
  if (
    typeof event?.telemetryModel === 'string' &&
    telemetryModelsById.has(event.telemetryModel)
  ) {
    return event.telemetryModel
  }

  if (typeof event?.model === 'string' && telemetryModelIdByAlias[event.model]) {
    return telemetryModelIdByAlias[event.model]
  }

  return null
}

function toPacificDateKey(dateLike) {
  return dateKeyFormatter.format(new Date(dateLike))
}

function computeRollingHourlyPeak(sortedTimestamps) {
  let peak = 0
  let windowStart = 0

  for (let windowEnd = 0; windowEnd < sortedTimestamps.length; windowEnd += 1) {
    while (
      sortedTimestamps[windowEnd] - sortedTimestamps[windowStart] >=
      60 * 60 * 1000
    ) {
      windowStart += 1
    }

    peak = Math.max(peak, windowEnd - windowStart + 1)
  }

  return peak
}

function computeAverageDailyUse(events) {
  if (!events.length) {
    return 0
  }

  const countsByDay = new Map()

  for (const event of events) {
    const dayKey = toPacificDateKey(event.timestamp)
    countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1)
  }

  const totals = Array.from(countsByDay.values())
  const aggregate = totals.reduce((sum, value) => sum + value, 0)

  return Number((aggregate / totals.length).toFixed(2))
}

function normalizeTokenCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }

  return Math.round(value)
}

function roundCurrency(value) {
  return Number(value.toFixed(4))
}

function resolveRequestCostEstimate(model) {
  if (!model) {
    return defaultRequestCostEstimate
  }

  const normalizedModel = telemetryModelsById.has(model)
    ? model === 'nano-banana-pro'
      ? 'gemini-3-pro'
      : model === 'nano-banana-2'
        ? 'gemini-3-flash'
        : model === 'nano-banana'
          ? 'gemini-2.5-flash-image'
          : model === 'gpt-image-2'
            ? 'openai-gpt-image-2'
            : model
    : model

  return requestCostByModel[normalizedModel] ?? defaultRequestCostEstimate
}

function resolveDailyRequestLimit(model) {
  if (!model) {
    return defaultDailyRequestLimit
  }

  if (telemetryModelsById.has(model)) {
    return telemetryModelsById.get(model)?.limits.rpd ?? defaultDailyRequestLimit
  }

  const telemetryModelId = telemetryModelIdByAlias[model]
  if (telemetryModelId) {
    return telemetryModelsById.get(telemetryModelId)?.limits.rpd ?? defaultDailyRequestLimit
  }

  return defaultDailyRequestLimit
}
