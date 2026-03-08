import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'

const googleTokenScope =
  'https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/monitoring.read'
const metricQueryPageSize = 500
const chartBucketCount = 8
const chartBucketDurationMs = 5 * 60 * 1000

const telemetryModelDefinitions = [
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    metricFamily: 'generate',
    modelMatchers: ['gemini-3-pro-image'],
  },
  {
    category: 'Multi-modal generative models',
    id: 'veo-3-fast-generate',
    label: 'Veo 3 Fast Generate',
    metricFamily: 'video',
    modelMatchers: ['veo-3.0-fast-generate'],
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana-2',
    label: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    metricFamily: 'generate',
    modelMatchers: ['gemini-3.1-flash-image'],
  },
  {
    category: 'Multi-modal generative models',
    id: 'nano-banana',
    label: 'Nano Banana (Gemini 2.5 Flash Preview Image)',
    metricFamily: 'generate',
    modelMatchers: ['gemini-2.5-flash-preview-image'],
  },
  {
    category: 'Text-out models',
    id: 'gemini-3-flash-text',
    label: 'Gemini 3 Flash',
    metricFamily: 'generate',
    modelMatchers: ['gemini-3.1-flash', 'gemini-3-flash'],
  },
  {
    category: 'Text-out models',
    id: 'gemini-2.5-flash-text',
    label: 'Gemini 2.5 Flash',
    metricFamily: 'generate',
    modelMatchers: ['gemini-2.5-flash'],
  },
]

const metricFamilies = {
  generate: {
    rpm: [
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_3_requests',
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_2_requests',
      'generativelanguage.googleapis.com/quota/generate_content_free_tier_requests',
      'generativelanguage.googleapis.com/quota/generate_requests_per_model',
    ],
    rpd: [
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_3_requests',
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_2_requests',
      'generativelanguage.googleapis.com/quota/generate_content_free_tier_requests',
    ],
    tpm: [
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_3_input_token_count',
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_2_input_token_count',
      'generativelanguage.googleapis.com/quota/generate_content_free_tier_input_token_count',
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count',
    ],
  },
  predict: {
    rpm: [
      'generativelanguage.googleapis.com/quota/predict_requests_per_model_paid_tier_3',
      'generativelanguage.googleapis.com/quota/predict_requests_per_model_paid_tier_2',
      'generativelanguage.googleapis.com/quota/predict_requests_free_tier_per_model',
      'generativelanguage.googleapis.com/quota/predict_requests_per_model',
    ],
    rpd: [
      'generativelanguage.googleapis.com/quota/predict_requests_per_model_per_day_paid_tier_3',
      'generativelanguage.googleapis.com/quota/predict_requests_per_model_per_day_paid_tier_2',
      'generativelanguage.googleapis.com/quota/predict_requests_per_model_per_day_paid_tier_1',
    ],
    tpm: [
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_3_input_token_count',
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_2_input_token_count',
      'generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count',
    ],
  },
  video: {
    rpm: [
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_paid_tier_3',
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_paid_tier_2',
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_free_tier',
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model',
    ],
    rpd: [
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_per_day_paid_tier_3',
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_per_day_paid_tier_2',
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_per_day_free_tier',
      'generativelanguage.googleapis.com/quota/predict_long_running_requests_per_model_per_day',
    ],
    tpm: [],
  },
}

let accessTokenCache = null

export function isGoogleTelemetryConfigured() {
  return Boolean(
    normalizeValue(process.env.GOOGLE_CLOUD_PROJECT) &&
      normalizeValue(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  )
}

export async function getGoogleTelemetrySnapshot({
  now = new Date(),
} = {}) {
  const projectId = normalizeValue(process.env.GOOGLE_CLOUD_PROJECT)
  const credentialsPath = normalizeValue(process.env.GOOGLE_APPLICATION_CREDENTIALS)

  if (!projectId || !credentialsPath) {
    throw buildTelemetryError(
      'google_telemetry_not_configured',
      'Google Cloud project or application credentials are not configured on the server.',
    )
  }

  const credentials = await loadServiceAccountCredentials(credentialsPath)
  const nowDate = new Date(now)

  try {
    const accessToken = await getAccessToken(credentials)
    const metricStore = await loadMetricStore({
      accessToken,
      now: nowDate,
      projectId,
    })

    return {
      generatedAt: nowDate.toISOString(),
      rows: telemetryModelDefinitions.map((definition) =>
        buildTelemetryRow(definition, metricStore, nowDate),
      ),
      source: 'google-cloud-monitoring',
      timeZone: 'America/Los_Angeles',
    }
  } catch (error) {
    throw decorateGoogleTelemetryError(error, {
      credentials,
      projectId,
    })
  }
}

async function loadMetricStore({ accessToken, now, projectId }) {
  const metricTypes = new Set()

  for (const family of Object.values(metricFamilies)) {
    for (const metricGroup of Object.values(family)) {
      metricGroup.forEach((metricType) => metricTypes.add(metricType))
    }
  }

  const quotaMetricCatalog = await loadQuotaMetricCatalog({
    accessToken,
    projectId,
  })
  const store = new Map()

  await Promise.all(
    Array.from(metricTypes).map(async (metricType) => {
      const [limitSeries, usageMinuteSeries, usageDaySeries, usageChartSeries] =
        await Promise.all([
          listTimeSeries({
            accessToken,
            endTime: now,
            metricType: `${metricType}/limit`,
            projectId,
            startTime: new Date(now.getTime() - 10 * 60 * 1000),
          }),
          listTimeSeries({
            accessToken,
            endTime: now,
            metricType: `${metricType}/usage`,
            projectId,
            startTime: new Date(now.getTime() - 60 * 1000),
          }),
          listTimeSeries({
            accessToken,
            endTime: now,
            metricType: `${metricType}/usage`,
            projectId,
            startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          }),
          listTimeSeries({
            accessToken,
            endTime: now,
            metricType: `${metricType}/usage`,
            projectId,
            startTime: new Date(now.getTime() - chartBucketCount * chartBucketDurationMs),
          }),
        ])

      store.set(metricType, {
        chartUsage: usageChartSeries,
        dailyUsage: usageDaySeries,
        limitBuckets: quotaMetricCatalog.get(toQuotaMetricName(metricType)) ?? [],
        limitSeries,
        minuteUsage: usageMinuteSeries,
      })
    }),
  )

  return store
}

function buildTelemetryRow(definition, metricStore, now) {
  const family = metricFamilies[definition.metricFamily]
  const rpm = resolveMetricSnapshot({
    candidates: family.rpm,
    limitScope: 'minute',
    metricStore,
    modelMatchers: definition.modelMatchers,
    usageScope: 'minuteUsage',
  })
  const rpd = resolveMetricSnapshot({
    candidates: family.rpd,
    limitScope: 'day',
    metricStore,
    modelMatchers: definition.modelMatchers,
    usageScope: 'dailyUsage',
  })
  const tpm = family.tpm.length
    ? resolveMetricSnapshot({
        candidates: family.tpm,
        limitScope: 'minute',
        metricStore,
        modelMatchers: definition.modelMatchers,
        usageScope: 'minuteUsage',
      })
    : buildEmptyMetricSnapshot()

  const chartCandidates = rpm.chartPoints.some((value) => value > 0)
    ? rpm.chartPoints
    : rpd.chartPoints

  return {
    category: definition.category,
    chartPoints: chartCandidates,
    id: definition.id,
    label: definition.label,
    lastRequestAt: resolveLastRequestAt([rpm.lastRequestAt, rpd.lastRequestAt, tpm.lastRequestAt]),
    metrics: {
      rpm: rpm.metric,
      rpd: rpd.metric,
      tpm: tpm.metric,
    },
  }
}

function resolveMetricSnapshot({
  candidates,
  limitScope,
  metricStore,
  modelMatchers,
  usageScope,
}) {
  for (const metricType of candidates) {
    const metricData = metricStore.get(metricType)

    if (!metricData) {
      continue
    }

    const matchingLimitSeries = metricData.limitSeries.filter((series) =>
      modelMatches(series.model, modelMatchers),
    )
    const matchingLimitBuckets = metricData.limitBuckets.filter(
      (bucket) =>
        bucket.scope === limitScope &&
        (bucket.model === '*' || modelMatches(bucket.model, modelMatchers)),
    )
    const matchingUsageSeries = metricData[usageScope].filter((series) =>
      modelMatches(series.model, modelMatchers),
    )
    const matchingChartSeries = metricData.chartUsage.filter((series) =>
      modelMatches(series.model, modelMatchers),
    )

    if (
      matchingLimitBuckets.length === 0 &&
      matchingLimitSeries.length === 0 &&
      matchingUsageSeries.length === 0 &&
      matchingChartSeries.length === 0
    ) {
      continue
    }

    const limit = matchingLimitSeries.reduce(
      (maximum, series) => Math.max(maximum, getLatestPointValue(series.points)),
      0,
    )
    const bucketLimit = matchingLimitBuckets.reduce(
      (maximum, bucket) => Math.max(maximum, bucket.limit),
      0,
    )
    const current = matchingUsageSeries.reduce(
      (sum, series) => sum + sumPointValues(series.points),
      0,
    )
    const resolvedLimit = Math.max(limit, bucketLimit)

    return {
      chartPoints: buildChartPoints(matchingChartSeries),
      lastRequestAt: resolveLastRequestAt(
        matchingUsageSeries.flatMap((series) => series.points.map((point) => point.timestamp)),
      ),
      metric:
        resolvedLimit > 0 || current > 0
          ? {
              current,
              limit: resolvedLimit > 0 ? resolvedLimit : null,
              ratio:
                resolvedLimit > 0 ? Math.max(0, Math.min(current / resolvedLimit, 1)) : null,
            }
          : buildEmptyMetric(),
    }
  }

  return buildEmptyMetricSnapshot()
}

function buildChartPoints(seriesCollection) {
  const bucketStart = Date.now() - chartBucketCount * chartBucketDurationMs
  const points = Array.from({ length: chartBucketCount }, () => 0)

  for (const series of seriesCollection) {
    for (const point of series.points) {
      const timestamp = Date.parse(point.timestamp)

      if (!Number.isFinite(timestamp) || timestamp < bucketStart) {
        continue
      }

      const bucketIndex = Math.min(
        chartBucketCount - 1,
        Math.floor((timestamp - bucketStart) / chartBucketDurationMs),
      )

      if (bucketIndex >= 0) {
        points[bucketIndex] += point.value
      }
    }
  }

  return points
}

function buildEmptyMetric() {
  return {
    current: null,
    limit: null,
    ratio: null,
  }
}

function buildEmptyMetricSnapshot() {
  return {
    chartPoints: Array.from({ length: chartBucketCount }, () => 0),
    lastRequestAt: null,
    metric: buildEmptyMetric(),
  }
}

function resolveLastRequestAt(timestamps) {
  const validTimestamps = timestamps
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((left, right) => Date.parse(right) - Date.parse(left))

  return validTimestamps[0] ?? null
}

function modelMatches(value, matchers) {
  const normalizedValue = String(value ?? '').toLowerCase()
  return matchers.some((matcher) => normalizedValue.includes(matcher.toLowerCase()))
}

function getLatestPointValue(points) {
  const latestPoint = points
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0]

  return latestPoint?.value ?? 0
}

function sumPointValues(points) {
  return points.reduce((sum, point) => sum + point.value, 0)
}

async function listTimeSeries({
  accessToken,
  endTime,
  metricType,
  projectId,
  startTime,
}) {
  const timeSeries = []
  let pageToken = ''

  do {
    const url = new URL(
      `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries`,
    )
    url.searchParams.set('filter', `metric.type="${metricType}"`)
    url.searchParams.set('interval.endTime', endTime.toISOString())
    url.searchParams.set('interval.startTime', startTime.toISOString())
    url.searchParams.set('pageSize', String(metricQueryPageSize))

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const errorInfo = payload?.error?.details?.find?.(
        (detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo',
      )
      throw buildTelemetryError(
        'google_monitoring_request_failed',
        payload?.error?.message || 'Google Cloud Monitoring request failed.',
        {
          activationUrl: errorInfo?.metadata?.activationUrl,
          metricType,
          reason: errorInfo?.reason,
          service: errorInfo?.metadata?.service,
          serviceTitle: errorInfo?.metadata?.serviceTitle,
          status: response.status,
        },
      )
    }

    for (const series of payload?.timeSeries ?? []) {
      timeSeries.push({
        limitName: series.metric?.labels?.limit_name ?? '',
        model: series.metric?.labels?.model ?? '',
        points: (series.points ?? []).map((point) => ({
          timestamp: point.interval?.endTime ?? point.interval?.startTime ?? null,
          value: normalizePointValue(point.value),
        })),
      })
    }

    pageToken = payload?.nextPageToken ?? ''
  } while (pageToken)

  return timeSeries
}

async function loadQuotaMetricCatalog({ accessToken, projectId }) {
  const catalog = new Map()
  let pageToken = ''

  do {
    const url = new URL(
      `https://serviceusage.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}/services/generativelanguage.googleapis.com/consumerQuotaMetrics`,
    )
    url.searchParams.set('pageSize', '200')

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw buildTelemetryError(
        'google_serviceusage_request_failed',
        payload?.error?.message || 'Google Service Usage request failed.',
        {
          status: response.status,
        },
      )
    }

    for (const metric of payload?.metrics ?? []) {
      catalog.set(
        metric.metric,
        (metric.consumerQuotaLimits ?? []).flatMap((limit) =>
          (limit.quotaBuckets ?? [])
            .map((bucket) => ({
              limit: normalizeQuotaLimit(bucket.effectiveLimit ?? bucket.defaultLimit),
              model: bucket.dimensions?.model ?? '*',
              scope: limit.unit.includes('/min/') ? 'minute' : limit.unit.includes('/d/') ? 'day' : 'other',
            }))
            .filter((bucket) => bucket.limit > 0),
        ),
      )
    }

    pageToken = payload?.nextPageToken ?? ''
  } while (pageToken)

  return catalog
}

function toQuotaMetricName(metricType) {
  return metricType.replace('/quota/', '/')
}

function normalizePointValue(value) {
  if (typeof value?.int64Value === 'string') {
    const parsed = Number(value.int64Value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (typeof value?.doubleValue === 'number') {
    return value.doubleValue
  }

  return 0
}

function normalizeQuotaLimit(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

async function loadServiceAccountCredentials(credentialsPath) {
  const rawFile = await fs.readFile(credentialsPath, 'utf8')
  const credentials = JSON.parse(rawFile)

  if (
    credentials?.type !== 'service_account' ||
    typeof credentials.client_email !== 'string' ||
    typeof credentials.private_key !== 'string' ||
    typeof credentials.token_uri !== 'string' ||
    typeof credentials.project_id !== 'string'
  ) {
    throw buildTelemetryError(
      'invalid_service_account',
      'The configured GOOGLE_APPLICATION_CREDENTIALS file is not a valid service account key.',
    )
  }

  return credentials
}

async function getAccessToken(credentials) {
  const now = Date.now()

  if (accessTokenCache && accessTokenCache.expiresAt > now + 60 * 1000) {
    return accessTokenCache.accessToken
  }

  const issuedAt = Math.floor(now / 1000)
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }
  const claimSet = {
    aud: credentials.token_uri,
    exp: issuedAt + 3600,
    iat: issuedAt,
    iss: credentials.client_email,
    scope: googleTokenScope,
  }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url')
  const unsignedToken = `${encodedHeader}.${encodedClaimSet}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsignedToken)
  const signature = signer.sign(credentials.private_key, 'base64url')
  const assertion = `${unsignedToken}.${signature}`

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.access_token) {
    throw buildTelemetryError(
      'google_oauth_failed',
      payload?.error_description || payload?.error || 'Failed to authenticate with Google OAuth.',
    )
  }

  accessTokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + Number(payload.expires_in ?? 3600) * 1000,
  }

  return accessTokenCache.accessToken
}

function buildTelemetryError(code, message, details) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function decorateGoogleTelemetryError(
  error,
  {
    credentials,
    projectId,
  },
) {
  const errorCode =
    error && typeof error === 'object' && 'code' in error ? error.code : 'telemetry_unavailable'
  const errorDetails =
    error && typeof error === 'object' && 'details' in error ? error.details : undefined
  const disabledService =
    typeof errorDetails?.service === 'string' ? errorDetails.service : null
  const disabledServiceTitle =
    typeof errorDetails?.serviceTitle === 'string' ? errorDetails.serviceTitle : null
  const activationUrl =
    typeof errorDetails?.activationUrl === 'string' ? errorDetails.activationUrl : null

  if (
    errorCode === 'google_monitoring_request_failed' &&
    errorDetails?.reason === 'SERVICE_DISABLED'
  ) {
    const serviceAccount = credentials.client_email

    return buildTelemetryError(
      'google_telemetry_service_disabled',
      [
        `Google quota telemetry cannot run because ${disabledServiceTitle ?? 'a required Google API'} is disabled for project "${projectId}".`,
        disabledService ? `Disabled API: ${disabledService}.` : null,
        `Service account: ${serviceAccount}.`,
        activationUrl ? `Enable it here: ${activationUrl}` : null,
        'For this telemetry integration, enable at least "monitoring.googleapis.com".',
        'You should also enable "serviceusage.googleapis.com" because quota-limit reads and diagnostics depend on it.',
        'After enabling the APIs, wait a few minutes for propagation, restart the server, and refresh the app.',
      ]
        .filter(Boolean)
        .join('\n'),
      {
        activationUrl,
        disabledService,
        projectId,
        serviceAccount,
      },
    )
  }

  if (
    errorCode === 'google_monitoring_request_failed' &&
    errorDetails?.status === 403
  ) {
    const serviceAccount = credentials.client_email
    const keyProjectId = credentials.project_id
    const projectMismatch = keyProjectId !== projectId
    const mismatchLine = projectMismatch
      ? `The credential file belongs to project "${keyProjectId}", but telemetry is targeting "${projectId}".`
      : `The credential file also belongs to the target project "${projectId}", so the issue is missing IAM access rather than the wrong key file.`

    return buildTelemetryError(
      'google_telemetry_permission_denied',
      [
        `Google denied quota telemetry for project "${projectId}".`,
        `Service account: ${serviceAccount}.`,
        mismatchLine,
        `Fix: grant "${serviceAccount}" access on project "${projectId}".`,
        'Required permissions include "monitoring.timeSeries.list" and "serviceusage.quotas.get".',
        'Start with "Monitoring Viewer" plus a role that includes quota read access such as "Service Usage Consumer".',
        'If access is already granted, verify GOOGLE_CLOUD_PROJECT points to the Gemini project that owns the AI Studio quota.',
      ].join('\n'),
      {
        projectId,
        requiredPermissions: ['monitoring.timeSeries.list', 'serviceusage.quotas.get'],
        serviceAccount,
      },
    )
  }

  if (errorCode === 'google_oauth_failed') {
    return buildTelemetryError(
      'google_telemetry_auth_failed',
      [
        'Google OAuth failed while creating the telemetry access token.',
        `Service account: ${credentials.client_email}.`,
        'Fix: verify the service-account JSON is valid, the private key has not been revoked, and the server can reach oauth2.googleapis.com.',
      ].join('\n'),
      errorDetails,
    )
  }

  return error instanceof Error
    ? error
    : buildTelemetryError(
        'telemetry_unavailable',
        'Telemetry is unavailable right now.',
      )
}

function normalizeValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}
