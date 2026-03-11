import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadApp(env = {}) {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    ...env,
  }

  const module = await import('./index.js')
  return module.app
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('API hardening', () => {
  it('requires the internal token for usage telemetry when configured', async () => {
    const app = await loadApp({
      INTERNAL_API_TOKEN: 'top-secret',
    })

    const unauthorizedResponse = await request(app).get('/api/usage')

    expect(unauthorizedResponse.status).toBe(401)
    expect(unauthorizedResponse.body.error.code).toBe('auth_required')

    const authorizedResponse = await request(app)
      .get('/api/usage')
      .set('x-internal-api-token', 'top-secret')

    expect(authorizedResponse.status).toBe(200)
    expect(authorizedResponse.body).toHaveProperty('todayTotal')
  })

  it('sanitizes google telemetry failures before returning them to clients', async () => {
    const app = await loadApp({
      GOOGLE_APPLICATION_CREDENTIALS: 'C:\\missing-service-account.json',
      GOOGLE_CLOUD_PROJECT: 'private-project-id',
      INTERNAL_API_TOKEN: 'top-secret',
    })

    const response = await request(app)
      .get('/api/usage/telemetry')
      .set('x-internal-api-token', 'top-secret')

    expect(response.status).toBe(200)
    expect(response.body.source).toBe('local')
    expect(response.body.error).toEqual({
      code: 'telemetry_unavailable',
      message: 'Google quota telemetry is unavailable right now. Local telemetry is still active.',
    })
    expect(JSON.stringify(response.body)).not.toContain('private-project-id')
    expect(JSON.stringify(response.body)).not.toContain('missing-service-account')
  })

  it('rejects invalid action animator payloads before attempting generation', async () => {
    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/action-animator')
      .send({
        actionType: 'walk',
        fps: 8,
        frameCount: 8,
        image: {
          data: 'abc123',
          mimeType: 'text/plain',
        },
        modelId: 'veo-3.1-fast',
        prompt: 'Walk cycle',
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_request')
  })

  it('rejects oversized inline media on forge requests', async () => {
    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const oversizedImageData = 'A'.repeat(8 * 1024 * 1024)
    const response = await request(app)
      .post('/api/forge')
      .send({
        mode: 'texture-lab',
        references: [
          {
            data: oversizedImageData,
            mimeType: 'image/png',
          },
        ],
        workflow: 'generate',
      })

    expect([400, 413]).toContain(response.status)
    if (response.body?.error?.code) {
      expect(response.body.error.code).toMatch(/invalid_request|payload_too_large/)
    }
  })

  it('rate limits repeated action animator requests', async () => {
    const app = await loadApp({
      ACTION_ANIMATOR_RATE_LIMIT_PER_MINUTE: '1',
    })

    const firstResponse = await request(app).post('/api/action-animator').send({})
    const secondResponse = await request(app).post('/api/action-animator').send({})

    expect(firstResponse.status).toBe(400)
    expect(secondResponse.status).toBe(429)
    expect(secondResponse.body.error.code).toBe('rate_limited')
  })
})
