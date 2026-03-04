import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')
const usageFilePath = path.join(dataDir, 'usage-log.json')
const pacificTimeZone = 'America/Los_Angeles'
const defaultDailyRequestLimit = 1500
const defaultRequestCostEstimate = 0.0005
const dailyLimitByModel = {
  'gemini-3-flash': 1500,
  'gemini-3-pro': 250,
}
const requestCostByModel = {
  'gemini-3-flash': 0.0005,
  'gemini-3-pro': 0.0012,
  'gemini-2.5-flash-image': 0.0005,
  'gemini-3-pro-image-preview': 0.0012,
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
  timestamp = new Date().toISOString(),
}) {
  const event = {
    model: typeof model === 'string' ? model : 'unknown',
    route: typeof route === 'string' ? route : 'unknown',
    timestamp,
  }

  writeQueue = writeQueue.then(async () => {
    const usageStore = await readUsageStore()
    usageStore.events.push(event)
    await persistUsageStore(usageStore)
  })

  await writeQueue
}

export async function getUsageSummary({
  model,
  now = new Date(),
} = {}) {
  const usageStore = await readUsageStore()
  const normalizedModel =
    typeof model === 'string' && model.trim().length > 0 ? model.trim() : null
  const scopedEvents = normalizedModel
    ? usageStore.events.filter((event) => event.model === normalizedModel)
    : usageStore.events
  const todayKey = toPacificDateKey(now)

  const todayEvents = scopedEvents.filter(
    (event) => toPacificDateKey(event.timestamp) === todayKey,
  )
  const todayTimestamps = todayEvents
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  const requestCostEstimate = resolveRequestCostEstimate(normalizedModel)
  const dailyRequestLimit = resolveDailyRequestLimit(normalizedModel)
  const todayTotal = todayEvents.length
  const peakHourly = computeRollingHourlyPeak(todayTimestamps)
  const costEstimate = roundCurrency(todayTotal * requestCostEstimate)
  const averageDailyUse = computeAverageDailyUse(scopedEvents)
  const projectedMonthlyCost = roundCurrency(averageDailyUse * 30 * requestCostEstimate)

  return {
    activeRpdRatio: todayTotal / dailyRequestLimit,
    averageDailyUse,
    costEstimate,
    dailyLimit: dailyRequestLimit,
    peakHourly,
    projectedMonthlyCost,
    requestCostEstimate,
    scopedModel: normalizedModel,
    timeZone: pacificTimeZone,
    todayTotal,
  }
}

async function readUsageStore() {
  try {
    const rawFile = await fs.readFile(usageFilePath, 'utf8')
    const parsed = JSON.parse(rawFile)

    if (!parsed || !Array.isArray(parsed.events)) {
      return { events: [] }
    }

    return {
      events: parsed.events.filter(
        (event) =>
          event &&
          typeof event === 'object' &&
          typeof event.timestamp === 'string' &&
          typeof event.model === 'string' &&
          typeof event.route === 'string',
      ),
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

function roundCurrency(value) {
  return Number(value.toFixed(4))
}

function resolveRequestCostEstimate(model) {
  if (!model) {
    return defaultRequestCostEstimate
  }

  return requestCostByModel[model] ?? defaultRequestCostEstimate
}

function resolveDailyRequestLimit(model) {
  if (!model) {
    return defaultDailyRequestLimit
  }

  return dailyLimitByModel[model] ?? defaultDailyRequestLimit
}
