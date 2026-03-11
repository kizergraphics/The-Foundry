const minuteMs = 60 * 1000

function normalizeHeaderValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function isLoopbackRequest(request) {
  const forwardedFor = normalizeHeaderValue(request.headers['x-forwarded-for'])

  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    return isLoopbackIp(firstIp)
  }

  return isLoopbackIp(request.ip) || isLoopbackIp(request.socket?.remoteAddress)
}

function isLoopbackIp(value) {
  const normalized = normalizeHeaderValue(value)

  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1' ||
    normalized === 'localhost'
  )
}

export function createSecurityHeadersMiddleware(options = {}) {
  const cspDirectives = options.contentSecurityPolicy ?? [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ]

  return function securityHeaders(_request, response, next) {
    response.setHeader('Content-Security-Policy', cspDirectives.join('; '))
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.setHeader('Origin-Agent-Cluster', '?1')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    next()
  }
}

export function createCorsMiddleware({ allowedOrigin } = {}) {
  const normalizedAllowedOrigin = normalizeHeaderValue(allowedOrigin)

  return function corsMiddleware(request, response, next) {
    const requestOrigin = normalizeHeaderValue(request.headers.origin)

    if (!requestOrigin) {
      next()
      return
    }

    if (!normalizedAllowedOrigin || requestOrigin === normalizedAllowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', requestOrigin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token, X-Internal-Api-Token')
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

      if (request.method === 'OPTIONS') {
        response.status(204).end()
        return
      }

      next()
      return
    }

    response.status(403).json({
      error: {
        code: 'origin_forbidden',
        message: 'This origin is not allowed to access the API.',
        title: 'Origin Forbidden',
      },
    })
  }
}

export function createTokenAuthMiddleware({
  allowLoopback = false,
  envToken,
  headerName,
  message,
}) {
  const normalizedToken = normalizeHeaderValue(envToken)

  return function tokenAuthMiddleware(request, response, next) {
    if (!normalizedToken) {
      if (allowLoopback && isLoopbackRequest(request)) {
        next()
        return
      }

      if (allowLoopback) {
        response.status(403).json({
          error: {
            code: 'forbidden',
            message,
            title: 'Forbidden',
          },
        })
        return
      }

      next()
      return
    }

    const requestToken = normalizeHeaderValue(request.headers[headerName.toLowerCase()])

    if (requestToken && requestToken === normalizedToken) {
      next()
      return
    }

    response.status(401).json({
      error: {
        code: 'auth_required',
        message,
        title: 'Authentication Required',
      },
    })
  }
}

export function createRateLimiter({
  keyPrefix,
  maxRequests,
  windowMs = minuteMs,
}) {
  const buckets = new Map()

  return function rateLimiter(request, response, next) {
    const now = Date.now()
    const clientKey = `${keyPrefix}:${request.ip ?? request.socket?.remoteAddress ?? 'unknown'}`
    const existingBucket = buckets.get(clientKey)
    const bucket =
      existingBucket && existingBucket.expiresAt > now
        ? existingBucket
        : {
            count: 0,
            expiresAt: now + windowMs,
          }

    bucket.count += 1
    buckets.set(clientKey, bucket)

    response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))))

    if (bucket.count > maxRequests) {
      response.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Wait briefly before trying again.',
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)),
          title: 'Rate Limited',
        },
      })
      return
    }

    next()
  }
}

export function createConcurrencyLimiter({
  limit,
  routeLabel,
}) {
  let activeCount = 0

  return async function concurrencyLimiter(request, response, next) {
    if (activeCount >= limit) {
      response.status(503).json({
        error: {
          code: 'server_busy',
          message: `${routeLabel} is saturated right now. Try again in a moment.`,
          title: 'Server Busy',
        },
      })
      return
    }

    activeCount += 1
    let released = false

    const release = () => {
      if (released) {
        return
      }

      released = true
      activeCount = Math.max(0, activeCount - 1)
    }

    response.on('close', release)
    response.on('finish', release)

    try {
      await next()
    } catch (error) {
      release()
      throw error
    }
  }
}
