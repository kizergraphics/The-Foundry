import { telemetryModelDefinitions } from './telemetryModelCatalog.js'

const chartBucketCount = 8
const chartBucketDurationMs = 5 * 60 * 1000
const openAiUsageEndpoint = 'https://api.openai.com/v1/organization/usage/images'
const openAiTelemetryDefinitions = telemetryModelDefinitions.filter(
  (definition) => definition.provider === 'openai',
)
const latestRateLimitSnapshotByModel = new Map()

export function isOpenAiTelemetryConfigured() {
  return Boolean(normalizeValue(process.env.OPENAI_ADMIN_KEY))
}

export function recordOpenAiRateLimitSnapshot({
  headers,
  telemetryModel,
  timestamp = new Date().toISOString(),
}) {
  if (
    typeof telemetryModel !== 'string' ||
    !telemetryModel ||
    !openAiTelemetryDefinitions.some((definition) => definition.id === telemetryModel)
  ) {
    return
  }

  const limitRequests = readHeaderNumber(headers, 'x-ratelimit-limit-requests')
  const remainingRequests = readHeaderNumber(headers, 'x-ratelimit-remaining-requests')
  const limitTokens = readHeaderNumber(headers, 'x-ratelimit-limit-tokens')
  const remainingTokens = readHeaderNumber(headers, 'x-ratelimit-remaining-tokens')

  if (
    !Number.isFinite(limitRequests) &&
    !Number.isFinite(remainingRequests) &&
    !Number.isFinite(limitTokens) &&
    !Number.isFinite(remainingTokens)
  ) {
    return
  }

  latestRateLimitSnapshotByModel.set(telemetryModel, {
    limitRequests: Number.isFinite(limitRequests) ? limitRequests : null,
    limitTokens: Number.isFinite(limitTokens) ? limitTokens : null,
    remainingRequests: Number.isFinite(remainingRequests) ? remainingRequests : null,
    remainingTokens: Number.isFinite(remainingTokens) ? remainingTokens : null,
    timestamp,
  })
}

export async function getOpenAiTelemetrySnapshot({
  now = new Date(),
} = {}) {
  const adminKey = normalizeValue(process.env.OPENAI_ADMIN_KEY)

  if (!adminKey) {
    throw buildTelemetryError(
      'openai_telemetry_not_configured',
      'OpenAI admin telemetry is not configured on the server.',
    )
  }

  const nowDate = new Date(now)
  const modelIds = openAiTelemetryDefinitions.map((definition) => definition.id)
  const chartWindowStart = Math.floor(
    (nowDate.getTime() - chartBucketCount * chartBucketDurationMs) / 1000,
  )
  const dayWindowStart = Math.floor((nowDate.getTime() - 24 * 60 * 60 * 1000) / 1000)
  const endTime = Math.ceil(nowDate.getTime() / 1000)

  const [minuteBuckets, dailyBuckets] = await Promise.all([
    listImageUsageBuckets({
      adminKey,
      bucketWidth: '1m',
      endTime,
      limit: chartBucketCount * 5,
      modelIds,
      startTime: chartWindowStart,
    }),
    listImageUsageBuckets({
      adminKey,
      bucketWidth: '1d',
      endTime,
      limit: 2,
      modelIds,
      startTime: dayWindowStart,
    }),
  ])

  return {
    generatedAt: nowDate.toISOString(),
    rows: openAiTelemetryDefinitions.map((definition) =>
      buildTelemetryRow(definition, {
        dailyBuckets,
        minuteBuckets,
        now: nowDate,
      }),
    ),
    source: 'openai-usage',
    timeZone: 'America/Los_Angeles',
  }
}

async function listImageUsageBuckets({
  adminKey,
  bucketWidth,
  endTime,
  limit,
  modelIds,
  startTime,
}) {
  const buckets = []
  let nextPage = null

  do {
    const url = new URL(openAiUsageEndpoint)
    url.searchParams.set('start_time', String(startTime))
    url.searchParams.set('end_time', String(endTime))
    url.searchParams.set('bucket_width', bucketWidth)
    url.searchParams.set('limit', String(limit))
    url.searchParams.append('group_by', 'model')

    for (const modelId of modelIds) {
      url.searchParams.append('models', modelId)
    }

    if (nextPage) {
      url.searchParams.set('page', nextPage)
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw buildTelemetryError(
        'openai_telemetry_request_failed',
        payload?.error?.message || 'OpenAI usage telemetry request failed.',
        {
          status: response.status,
        },
      )
    }

    for (const bucket of payload?.data ?? []) {
      buckets.push(bucket)
    }

    nextPage = payload?.next_page ?? null
  } while (nextPage)

  return buckets
}

function buildTelemetryRow(definition, { dailyBuckets, minuteBuckets, now }) {
  const requestSnapshot = latestRateLimitSnapshotByModel.get(definition.id) ?? null
  const minuteSeries = minuteBuckets
    .map((bucket) => ({
      count: getBucketRequestCount(bucket, definition.id),
      timestamp: Number(bucket.end_time) * 1000,
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp)
  const dailyCount = dailyBuckets.reduce(
    (sum, bucket) => sum + getBucketRequestCount(bucket, definition.id),
    0,
  )
  const currentMinuteRequests = minuteSeries.at(-1)?.count ?? 0
  const currentRateWindowRequests = deriveCurrentUsage(
    requestSnapshot?.limitRequests,
    requestSnapshot?.remainingRequests,
  )
  const currentRateWindowTokens = deriveCurrentUsage(
    requestSnapshot?.limitTokens,
    requestSnapshot?.remainingTokens,
  )
  const lastActiveMinute = minuteSeries
    .slice()
    .reverse()
    .find((entry) => entry.count > 0)

  return {
    category: definition.category,
    chartPoints: buildChartPoints(minuteSeries, now),
    id: definition.id,
    label: definition.label,
    lastRequestAt:
      typeof lastActiveMinute?.timestamp === 'number'
        ? new Date(lastActiveMinute.timestamp).toISOString()
        : requestSnapshot?.timestamp ?? null,
    metrics: {
      rpm: buildMetricPayload(
        Math.max(currentMinuteRequests, currentRateWindowRequests ?? 0),
        requestSnapshot?.limitRequests ?? definition.limits.rpm ?? null,
      ),
      rpd: buildMetricPayload(dailyCount, definition.limits.rpd ?? null),
      tpm: buildMetricPayload(
        currentRateWindowTokens,
        requestSnapshot?.limitTokens ?? definition.limits.tpm ?? null,
      ),
    },
  }
}

function getBucketRequestCount(bucket, modelId) {
  return (bucket?.results ?? [])
    .filter((result) => String(result?.model ?? '') === modelId)
    .reduce((sum, result) => sum + normalizePositiveInteger(result?.num_model_requests), 0)
}

function buildChartPoints(minuteSeries, now) {
  const bucketStart = now.getTime() - chartBucketCount * chartBucketDurationMs
  const points = Array.from({ length: chartBucketCount }, () => 0)

  for (const entry of minuteSeries) {
    if (entry.timestamp < bucketStart || entry.timestamp > now.getTime()) {
      continue
    }

    const bucketIndex = Math.min(
      chartBucketCount - 1,
      Math.floor((entry.timestamp - bucketStart) / chartBucketDurationMs),
    )

    if (bucketIndex >= 0) {
      points[bucketIndex] += entry.count
    }
  }

  return points
}

function buildMetricPayload(current, limit) {
  const normalizedCurrent =
    typeof current === 'number' && Number.isFinite(current) ? current : null
  const normalizedLimit =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null

  return {
    current: normalizedCurrent,
    limit: normalizedLimit,
    ratio:
      normalizedCurrent !== null && normalizedLimit !== null
        ? Math.max(0, Math.min(normalizedCurrent / normalizedLimit, 1))
        : null,
  }
}

function deriveCurrentUsage(limit, remaining) {
  if (
    typeof limit !== 'number' ||
    !Number.isFinite(limit) ||
    typeof remaining !== 'number' ||
    !Number.isFinite(remaining)
  ) {
    return null
  }

  return Math.max(0, limit - remaining)
}

function readHeaderNumber(headers, name) {
  if (!headers || typeof headers.get !== 'function') {
    return null
  }

  const rawValue = headers.get(name)
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null
  }

  const numericValue = Number(rawValue)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizePositiveInteger(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : 0
}

function buildTelemetryError(code, message, details) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function normalizeValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}
