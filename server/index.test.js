import JSZip from 'jszip'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

vi.mock('@google/genai/node', () => {
  const generateContent = vi.fn()
  const GoogleGenAI = vi.fn(function GoogleGenAI() {
    this.models = {
      generateContent,
    }
  })

  return {
    GoogleGenAI,
    __mock: {
      generateContent,
    },
  }
})

async function loadApp(env = {}) {
  const module = await loadServerModule(env)
  return module.app
}

async function loadServerModule(env = {}) {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    ...env,
  }

  return import('./index.js')
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

async function createPngBase64(width, height, channelValues) {
  return sharp(Buffer.from(channelValues), {
    raw: {
      channels: 3,
      height,
      width,
    },
  })
    .png()
    .toBuffer()
    .then((buffer) => buffer.toString('base64'))
}

function buildImageGeneration(base64, mimeType = 'image/png') {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: base64,
                mimeType,
              },
            },
          ],
        },
      },
    ],
    usageMetadata: {
      totalTokenCount: 123,
    },
  }
}

function buildTextOnlyGeneration(text) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text,
            },
          ],
        },
      },
    ],
    text,
    usageMetadata: {
      totalTokenCount: 123,
    },
  }
}

function buildBinaryParser() {
  return (response, callback) => {
    const chunks = []
    response.on('data', (chunk) => {
      chunks.push(chunk)
    })
    response.on('end', () => {
      callback(null, Buffer.concat(chunks))
    })
  }
}

describe('Texture Lab batch scheduling', () => {
  it('caps Texture Lab worker count at 2 by default', async () => {
    const serverModule = await loadServerModule({
      TEXTURE_LAB_MAX_PARALLEL_REQUESTS: '9',
    })

    expect(serverModule.resolveForgeBatchWorkerCount('texture-lab', 'generate', 1)).toBe(1)
    expect(serverModule.resolveForgeBatchWorkerCount('texture-lab', 'generate', 4)).toBe(2)
    expect(serverModule.resolveForgeBatchWorkerCount('armory', 'generate', 4)).toBe(4)
  })

  it('applies startup delay only to Texture Lab workers after the first slot', async () => {
    const serverModule = await loadServerModule({
      TEXTURE_LAB_BATCH_START_STAGGER_MS: '1500',
    })

    expect(serverModule.resolveForgeWorkerStartDelayMs('texture-lab', 'generate', 0)).toBe(0)
    expect(serverModule.resolveForgeWorkerStartDelayMs('texture-lab', 'generate', 1)).toBe(1500)
    expect(serverModule.resolveForgeWorkerStartDelayMs('texture-lab', 'generate', 2)).toBe(3000)
    expect(serverModule.resolveForgeWorkerStartDelayMs('armory', 'generate', 1)).toBe(0)
  })

  it('adds bounded retry jitter only for Texture Lab generate requests', async () => {
    const serverModule = await loadServerModule({
      TEXTURE_LAB_RETRY_JITTER_MS: '800',
    })

    expect(
      serverModule.resolveForgeRetryDelay({
        mode: 'texture-lab',
        workflow: 'generate',
        randomValue: 0,
      }),
    ).toEqual({
      baseDelayMs: 1200,
      effectiveDelayMs: 1200,
      jitterMs: 0,
    })

    const maxJitterDelay = serverModule.resolveForgeRetryDelay({
      mode: 'texture-lab',
      workflow: 'generate',
      randomValue: 0.9999,
      retryAfterSeconds: 3,
    })
    expect(maxJitterDelay.baseDelayMs).toBe(3000)
    expect(maxJitterDelay.jitterMs).toBeGreaterThanOrEqual(0)
    expect(maxJitterDelay.jitterMs).toBeLessThanOrEqual(800)
    expect(maxJitterDelay.effectiveDelayMs).toBeGreaterThanOrEqual(3000)
    expect(maxJitterDelay.effectiveDelayMs).toBeLessThanOrEqual(3800)

    expect(
      serverModule.resolveForgeRetryDelay({
        mode: 'armory',
        workflow: 'generate',
        randomValue: 0.9999,
        retryAfterSeconds: 3,
      }),
    ).toEqual({
      baseDelayMs: 3000,
      effectiveDelayMs: 3000,
      jitterMs: 0,
    })
  })

  it('stagger-starts initial Texture Lab worker requests without affecting result order', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    const generatedBase64 = await createPngBase64(1, 1, [40, 80, 120])
    const callTimes = []

    __mock.generateContent.mockImplementation(async () => {
      callTimes.push(Date.now())
      return buildImageGeneration(generatedBase64)
    })

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
      TEXTURE_LAB_BATCH_START_STAGGER_MS: '25',
      TEXTURE_LAB_MAX_PARALLEL_REQUESTS: '2',
    })

    const response = await request(app)
      .post('/api/forge')
      .send({
        generationCount: 2,
        mode: 'texture-lab',
        prompt: 'weathered basalt floor tile',
        workflow: 'generate',
      })

    expect(response.status).toBe(200)
    expect(response.body.images).toHaveLength(2)
    expect(callTimes).toHaveLength(2)
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(20)
  })

  it('does not apply the Texture Lab startup stagger to other forge modes', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    const generatedBase64 = await createPngBase64(1, 1, [90, 60, 30])
    const callTimes = []

    __mock.generateContent.mockImplementation(async () => {
      callTimes.push(Date.now())
      return buildImageGeneration(generatedBase64)
    })

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
      TEXTURE_LAB_BATCH_START_STAGGER_MS: '40',
    })

    const response = await request(app)
      .post('/api/forge')
      .send({
        generationCount: 2,
        mode: 'armory',
        prompt: 'iron longsword concept',
        workflow: 'generate',
      })

    expect(response.status).toBe(200)
    expect(response.body.images).toHaveLength(2)
    expect(callTimes).toHaveLength(2)
    expect(callTimes[1] - callTimes[0]).toBeLessThan(30)
  })
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

  it('rejects invalid action animator strip payloads before attempting generation', async () => {
    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/action-animator-strip')
      .send({
        actionType: 'hurt',
        anchorImage: {
          data: 'abc123',
          mimeType: 'text/plain',
        },
        canvasImage: {
          data: 'abc123',
          mimeType: 'image/png',
        },
        chunkIndex: 0,
        frameCount: 4,
        fps: 8,
        modelId: 'gemini-3-pro',
        prompt: 'Hurt strip',
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

  it('rejects invalid variant forge idea-refresh payloads before attempting generation', async () => {
    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/variant-forge-ideas')
      .send({
        variantFamily: 'damage',
        variantPreset: 'legendary',
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_request')
  })

  it('includes a staged consistency reference in character sheet generation requests', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    const generatedBase64 = await createPngBase64(1, 1, [40, 80, 120])
    __mock.generateContent.mockResolvedValue(buildImageGeneration(generatedBase64))

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/character-sheet')
      .send({
        consistencyReference: {
          data: generatedBase64,
          mimeType: 'image/png',
        },
        generationMode: 'manifest',
        modelId: 'gemini-3-pro',
        prompt: 'Create a calm hero turnaround.',
        responseModalities: ['IMAGE', 'TEXT'],
      })

    expect(response.status).toBe(200)
    expect(__mock.generateContent).toHaveBeenCalledTimes(1)
    expect(__mock.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            text: expect.stringContaining('staged prior sheet reference'),
          }),
          {
            inlineData: {
              data: generatedBase64,
              mimeType: 'image/png',
            },
          },
        ],
      }),
    )
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

  it('rejects invalid material-map payloads before attempting generation', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/material-maps')
      .send({
        sourceImage: {
          data: 'abc123',
          mimeType: 'text/plain',
        },
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_request')
    expect(__mock.generateContent).not.toHaveBeenCalled()
  })

  it('returns source-sized material maps as PNG images', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()

    const sourceImageBase64 = await createPngBase64(4, 4, [
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
    ])
    const generatedHeightBase64 = await createPngBase64(2, 2, [
      20, 20, 20, 220, 220, 220,
      20, 20, 20, 220, 220, 220,
    ])
    const generatedRoughnessBase64 = await createPngBase64(2, 2, [
      80, 30, 10, 120, 60, 20,
      160, 90, 30, 220, 140, 50,
    ])
    const generatedMetallicBase64 = await createPngBase64(2, 2, [
      5, 40, 80, 25, 70, 110,
      45, 100, 140, 85, 150, 200,
    ])

    __mock.generateContent
      .mockResolvedValueOnce(buildImageGeneration(generatedHeightBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedRoughnessBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedMetallicBase64))

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/material-maps')
      .send({
        heightStrength: 90,
        metallicStrength: 10,
        normalStrength: 75,
        prompt: 'weathered brushed metal floor',
        roughnessStrength: 40,
        sourceImage: {
          data: sourceImageBase64,
          mimeType: 'image/png',
        },
        styleText: 'neutral production texture',
      })

    expect(response.status).toBe(200)
    expect(response.body.model).toBe('gemini-3-pro')
    expect(Object.keys(response.body.maps)).toEqual([
      'height',
      'metallic',
      'normal',
      'roughness',
    ])

    const heightMap = response.body.maps.height
    const roughnessMap = response.body.maps.roughness
    const metallicMap = response.body.maps.metallic
    const normalMap = response.body.maps.normal
    const decodedHeight = await sharp(Buffer.from(heightMap.data, 'base64')).metadata()
    const decodedRoughness = await sharp(Buffer.from(roughnessMap.data, 'base64')).metadata()
    const decodedMetallic = await sharp(Buffer.from(metallicMap.data, 'base64')).metadata()
    const decodedNormal = await sharp(Buffer.from(normalMap.data, 'base64')).metadata()
    const rawHeight = await sharp(Buffer.from(heightMap.data, 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const rawRoughness = await sharp(Buffer.from(roughnessMap.data, 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const rawMetallic = await sharp(Buffer.from(metallicMap.data, 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(heightMap.mimeType).toBe('image/png')
    expect(heightMap.width).toBe(4)
    expect(heightMap.height).toBe(4)
    expect(isGrayscale(rawHeight.data, rawHeight.info.channels)).toBe(true)
    expect(isGrayscale(rawRoughness.data, rawRoughness.info.channels)).toBe(true)
    expect(isGrayscale(rawMetallic.data, rawMetallic.info.channels)).toBe(true)
    expect(normalMap.width).toBe(4)
    expect(normalMap.height).toBe(4)
    expect(decodedNormal.channels).toBe(3)
  })

  it('falls back to another image-capable model when a material map attempt returns no inline image', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()

    const sourceImageBase64 = await createPngBase64(4, 4, [
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
    ])
    const generatedHeightBase64 = await createPngBase64(2, 2, [
      20, 20, 20, 220, 220, 220,
      20, 20, 20, 220, 220, 220,
    ])
    const generatedRoughnessBase64 = await createPngBase64(2, 2, [
      80, 30, 10, 120, 60, 20,
      160, 90, 30, 220, 140, 50,
    ])
    const generatedMetallicBase64 = await createPngBase64(2, 2, [
      5, 40, 80, 25, 70, 110,
      45, 100, 140, 85, 150, 200,
    ])

    __mock.generateContent.mockImplementation(async ({ contents, model }) => {
      const prompt = contents?.[0]?.text ?? ''

      if (prompt.includes('height map')) {
        if (model === 'gemini-3-pro-image-preview') {
          return buildTextOnlyGeneration('Here is a material analysis without inline image output.')
        }

        return buildImageGeneration(generatedHeightBase64)
      }

      if (prompt.includes('roughness map')) {
        return buildImageGeneration(generatedRoughnessBase64)
      }

      if (prompt.includes('metallic map')) {
        return buildImageGeneration(generatedMetallicBase64)
      }

      throw new Error(`Unexpected prompt in test: ${prompt}`)
    })

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/material-maps')
      .send({
        heightStrength: 90,
        metallicStrength: 10,
        normalStrength: 75,
        prompt: 'weathered brushed metal floor',
        roughnessStrength: 40,
        sourceImage: {
          data: sourceImageBase64,
          mimeType: 'image/png',
        },
        styleText: 'neutral production texture',
      })

    expect(response.status).toBe(200)
    expect(Object.keys(response.body.maps)).toEqual([
      'height',
      'metallic',
      'normal',
      'roughness',
    ])
    expect(
      __mock.generateContent.mock.calls.some(
        ([requestBody]) =>
          requestBody?.model === 'gemini-2.5-flash-image' &&
          requestBody?.contents?.[0]?.text?.includes('height map'),
      ),
    ).toBe(true)
  })

  it('regenerates all AI utility maps on every material-map request and rebuilds normal from current strengths', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()

    const sourceImageBase64 = await createPngBase64(4, 4, [
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
      0, 0, 0, 60, 60, 60, 180, 180, 180, 255, 255, 255,
    ])
    const generatedHeightBase64 = await createPngBase64(2, 2, [
      20, 20, 20, 220, 220, 220,
      20, 20, 20, 220, 220, 220,
    ])
    const generatedRoughnessBase64 = await createPngBase64(2, 2, [
      80, 30, 10, 120, 60, 20,
      160, 90, 30, 220, 140, 50,
    ])
    const generatedMetallicBase64 = await createPngBase64(2, 2, [
      5, 40, 80, 25, 70, 110,
      45, 100, 140, 85, 150, 200,
    ])

    __mock.generateContent
      .mockResolvedValueOnce(buildImageGeneration(generatedHeightBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedRoughnessBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedMetallicBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedHeightBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedRoughnessBase64))
      .mockResolvedValueOnce(buildImageGeneration(generatedMetallicBase64))

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const lowHeightResponse = await request(app)
      .post('/api/material-maps')
      .send({
        heightStrength: 0,
        metallicStrength: 10,
        normalStrength: 60,
        prompt: 'weathered brushed metal floor',
        roughnessStrength: 40,
        sourceImage: {
          data: sourceImageBase64,
          mimeType: 'image/png',
        },
        styleText: 'neutral production texture',
      })
    const highHeightResponse = await request(app)
      .post('/api/material-maps')
      .send({
        heightStrength: 100,
        metallicStrength: 10,
        normalStrength: 60,
        prompt: 'weathered brushed metal floor',
        roughnessStrength: 40,
        sourceImage: {
          data: sourceImageBase64,
          mimeType: 'image/png',
        },
        styleText: 'neutral production texture',
      })

    expect(lowHeightResponse.status).toBe(200)
    expect(highHeightResponse.status).toBe(200)
    expect(__mock.generateContent).toHaveBeenCalledTimes(6)
    expect(Object.keys(lowHeightResponse.body.maps)).toEqual([
      'height',
      'metallic',
      'normal',
      'roughness',
    ])
    expect(Object.keys(highHeightResponse.body.maps)).toEqual([
      'height',
      'metallic',
      'normal',
      'roughness',
    ])

    const lowHeightNormal = await sharp(Buffer.from(lowHeightResponse.body.maps.normal.data, 'base64'))
      .raw()
      .toBuffer()
    const highHeightNormal = await sharp(Buffer.from(highHeightResponse.body.maps.normal.data, 'base64'))
      .raw()
      .toBuffer()

    expect(Buffer.compare(lowHeightNormal, highHeightNormal)).not.toBe(0)
  })
})

describe('VFX recipe export routes', () => {
  it('returns deterministic VFX recipe manifests for both solution types', async () => {
    const app = await loadApp()

    const basePayload = {
      effectLabel: 'Fireball',
      exportTarget: 'particle-system',
      frameCount: 8,
      intensity: 60,
      looping: true,
      textureOutputs: ['flipbook', 'noise'],
      textures: [
        {
          data: await createPngBase64(1, 1, [255, 180, 80]),
          kind: 'flipbook',
          mimeType: 'image/png',
        },
        {
          data: await createPngBase64(1, 1, [90, 90, 90]),
          kind: 'noise',
          mimeType: 'image/png',
        },
      ],
      unityPipeline: 'urp',
    }

    const particleResponse = await request(app)
      .post('/api/vfx-recipe')
      .send({
        ...basePayload,
        exportTarget: 'particle-system',
      })
    const graphResponse = await request(app)
      .post('/api/vfx-recipe')
      .send({
        ...basePayload,
        exportTarget: 'vfx-graph',
      })

    expect(particleResponse.status).toBe(200)
    expect(graphResponse.status).toBe(200)
    expect(particleResponse.body.recipe).toMatchObject({
      recipeVersion: '1.0.0',
      recipeKind: 'generic',
      unityPipeline: 'urp',
      exportTarget: 'particle-system',
    })
    expect(graphResponse.body.recipe).toMatchObject({
      recipeVersion: '1.0.0',
      recipeKind: 'generic',
      unityPipeline: 'urp',
      exportTarget: 'vfx-graph',
    })
    expect(particleResponse.body.recipe.textures[0].fileName).toContain('textures/fireball-flipbook.png')
    expect(graphResponse.body.recipe.vfxGraphConfig.exposedProperties.length).toBeGreaterThan(0)
  })

  it('packages VFX export bundles with sanitized filenames and required files', async () => {
    const app = await loadApp()
    const response = await request(app)
      .post('/api/vfx-export')
      .buffer(true)
      .parse(buildBinaryParser())
      .send({
        effectLabel: 'Arcane Gate / Beta',
        exportTarget: 'particle-system',
        frameCount: 12,
        intensity: 70,
        looping: true,
        textureOutputs: ['swirl', 'noise', 'dissolve-mask'],
        textures: [
          {
            data: await createPngBase64(1, 1, [120, 180, 255]),
            kind: 'swirl',
            mimeType: 'image/png',
          },
          {
            data: await createPngBase64(1, 1, [80, 80, 80]),
            kind: 'noise',
            mimeType: 'image/png',
          },
          {
            data: await createPngBase64(1, 1, [255, 255, 255]),
            kind: 'dissolve-mask',
            mimeType: 'image/png',
          },
        ],
        unityPipeline: 'urp',
      })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/zip')
    expect(response.headers['content-disposition']).toContain(
      'kizer-forge-vfx-arcane-gate-beta-bundle.zip',
    )

    const zip = await JSZip.loadAsync(response.body)
    const fileNames = Object.keys(zip.files).sort()

    expect(fileNames).toEqual(
      expect.arrayContaining([
        'README.md',
        'manifest.json',
        'preview/arcane-gate-beta-dissolve-mask.png',
        'preview/arcane-gate-beta-noise.png',
        'preview/arcane-gate-beta-swirl.png',
        'recipe.json',
        'textures/arcane-gate-beta-dissolve-mask.png',
        'textures/arcane-gate-beta-noise.png',
        'textures/arcane-gate-beta-swirl.png',
      ]),
    )
  })
})

function isGrayscale(buffer, channels) {
  if (channels <= 1) {
    return true
  }

  for (let index = 0; index < buffer.length; index += channels) {
    if (buffer[index] !== buffer[index + 1] || buffer[index] !== buffer[index + 2]) {
      return false
    }
  }

  return true
}
