import JSZip from 'jszip'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import request from 'supertest'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

vi.mock('@google/genai/node', () => {
  const generateContent = vi.fn()
  const generateVideos = vi.fn()
  const getVideosOperation = vi.fn()
  const download = vi.fn()
  const GoogleGenAI = vi.fn(function GoogleGenAI() {
    this.models = {
      generateContent,
      generateVideos,
    }
    this.operations = {
      getVideosOperation,
    }
    this.files = {
      download,
    }
  })

  return {
    GoogleGenAI,
    __mock: {
      download,
      generateContent,
      generateVideos,
      getVideosOperation,
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
  vi.unstubAllGlobals()
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

async function createActionAnimatorVideoBuffer() {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is required for action animator route tests.')
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'foundry-action-animator-test-'))
  const framePattern = path.join(tempDir, 'frame-%02d.png')
  const videoPath = path.join(tempDir, 'fixture.mp4')
  const background = { alpha: 1, b: 0, g: 255, r: 0 }

  try {
    await Promise.all([
      sharp({
        create: {
          background,
          channels: 4,
          height: 512,
          width: 512,
        },
      })
        .composite([
          {
            input: await sharp({
              create: {
                background: { alpha: 1, b: 255, g: 255, r: 255 },
                channels: 4,
                height: 220,
                width: 140,
              },
            })
              .png()
              .toBuffer(),
            left: 180,
            top: 250,
          },
        ])
        .png()
        .toFile(path.join(tempDir, 'frame-01.png')),
      sharp({
        create: {
          background,
          channels: 4,
          height: 512,
          width: 512,
        },
      })
        .composite([
          {
            input: await sharp({
              create: {
                background: { alpha: 1, b: 255, g: 255, r: 255 },
                channels: 4,
                height: 220,
                width: 140,
              },
            })
              .png()
              .toBuffer(),
            left: 210,
            top: 250,
          },
        ])
        .png()
        .toFile(path.join(tempDir, 'frame-02.png')),
    ])

    await runBinaryProcess(ffmpegPath, [
      '-y',
      '-framerate',
      '1',
      '-i',
      framePattern,
      '-pix_fmt',
      'yuv420p',
      '-vf',
      'format=yuv420p',
      videoPath,
    ])

    return await fs.readFile(videoPath)
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {})
  }
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

async function runBinaryProcess(binaryPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(undefined)
        return
      }

      reject(new Error(stderr || `Process exited with code ${code}.`))
    })
  })
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
        modelId: 'gemini-3-flash',
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
        modelId: 'gemini-3-flash',
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
  it('supports OpenAI GPT Image 2 on forge routes', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    const generatedBase64 = await createPngBase64(1, 1, [120, 80, 40])
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers({
        'x-ratelimit-limit-requests': '20',
        'x-ratelimit-limit-tokens': '250000',
        'x-ratelimit-remaining-requests': '19',
        'x-ratelimit-remaining-tokens': '249100',
      }),
      json: async () => ({
        data: [
          {
            b64_json: generatedBase64,
            revised_prompt: 'Studio-lit bronze gauntlet concept render',
          },
        ],
        usage: {
          input_tokens: 34,
          output_tokens: 1200,
          total_tokens: 1234,
        },
      }),
      ok: true,
      status: 200,
    })

    vi.stubGlobal('fetch', fetchMock)

    const app = await loadApp({
      OPENAI_API_KEY: 'openai-test-key',
    })

    const response = await request(app)
      .post('/api/forge')
      .send({
        mode: 'armory',
        modelId: 'openai-gpt-image-2',
        prompt: 'bronze gauntlet concept',
        workflow: 'generate',
      })

    expect(response.status).toBe(200)
    expect(response.body.model).toBe('openai-gpt-image-2')
    expect(response.body.providerModel).toBe('gpt-image-2')
    expect(response.body.images).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer openai-test-key',
          'Content-Type': 'application/json',
        }),
        method: 'POST',
      }),
    )
    expect(__mock.generateContent).not.toHaveBeenCalled()
  })

  it('passes optional OpenAI project scoping headers on forge routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: async () => ({
        data: [
          {
            b64_json: await createPngBase64(1, 1, [80, 120, 160]),
            revised_prompt: 'Silver signet ring product render',
          },
        ],
      }),
      ok: true,
      status: 200,
    })

    vi.stubGlobal('fetch', fetchMock)

    const app = await loadApp({
      OPENAI_API_KEY: 'openai-test-key',
      OPENAI_ORGANIZATION_ID: 'org_test_123',
      OPENAI_PROJECT_ID: 'proj_test_456',
    })

    const response = await request(app)
      .post('/api/forge')
      .send({
        mode: 'armory',
        modelId: 'openai-gpt-image-2',
        prompt: 'silver signet ring',
        workflow: 'generate',
      })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer openai-test-key',
          'OpenAI-Organization': 'org_test_123',
          'OpenAI-Project': 'proj_test_456',
        }),
      }),
    )
  })

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

  it('includes style-reference guidance in VFX forge generation requests when a style image is attached', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    const generatedBase64 = await createPngBase64(1, 1, [80, 120, 255])
    __mock.generateContent.mockResolvedValue(buildImageGeneration(generatedBase64))

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/forge')
      .send({
        modelId: 'gemini-3-flash',
        mode: 'vfx-forge',
        references: [
          {
            data: generatedBase64,
            mimeType: 'image/png',
            slot: 'style',
          },
        ],
        textureKind: 'flipbook',
      })

    expect(response.status).toBe(200)
    expect(response.body.prompt).toContain('A style reference image is attached;')
    expect(__mock.generateContent).toHaveBeenCalledTimes(1)
    expect(__mock.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            text: expect.stringContaining('A style reference image is attached;'),
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

describe('Action Animator route', () => {
  it('returns video, sprite sheet, frames, and metadata for Veo extraction', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateVideos.mockReset()
    __mock.getVideosOperation.mockReset()
    __mock.download.mockReset()
    const videoBuffer = await createActionAnimatorVideoBuffer()

    __mock.generateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          {
            video: {
              uri: 'mock://generated-video',
            },
          },
        ],
      },
    })
    __mock.download.mockImplementation(async ({ downloadPath }) => {
      await fs.writeFile(downloadPath, videoBuffer)
    })

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/action-animator')
      .send({
        actionType: 'walk',
        fps: 8,
        frameCount: 4,
        image: {
          data: await createPngBase64(1, 1, [255, 255, 255]),
          mimeType: 'image/png',
        },
        keyColor: 'green',
        modelId: 'veo-3.1-fast',
        normalizedSize: 512,
        pipeline: 'veo-video',
        prompt: 'Side-profile walk cycle on a green key background.',
      })

    expect(response.status).toBe(200)
    expect(__mock.generateVideos).toHaveBeenCalledTimes(1)
    expect(response.body.model).toBe('veo-3.1-fast')
    expect(response.body.artifacts.metadata).toMatchObject({
      fps: 8,
      frameCount: 4,
      keyColor: 'green',
      normalizedSize: 512,
      sampleStrategy: 'even',
      sourceModel: 'veo-3.1-fast',
    })
    expect(response.body.artifacts.video.mimeType).toBe('video/mp4')
    expect(response.body.artifacts.spriteSheet.mimeType).toBe('image/png')
    expect(response.body.artifacts.frames).toHaveLength(4)
    expect(response.body.prompt).toContain('green')
  })

  it('returns sprite-strip frames without video for image-strip generation', async () => {
    const { __mock } = await import('@google/genai/node')
    __mock.generateContent.mockReset()
    __mock.generateContent.mockResolvedValue(
      buildImageGeneration(
        await createPngBase64(4, 1, [
          255, 255, 255,
          240, 240, 240,
          225, 225, 225,
          210, 210, 210,
        ]),
      ),
    )

    const app = await loadApp({
      GEMINI_API_KEY: 'test-key',
    })

    const response = await request(app)
      .post('/api/action-animator')
      .send({
        actionType: 'idle',
        firstFrame: {
          data: await createPngBase64(1, 1, [255, 255, 255]),
          mimeType: 'image/png',
          name: 'first-frame.png',
        },
        fps: 8,
        frameCount: 4,
        image: {
          data: await createPngBase64(1, 1, [255, 255, 255]),
          mimeType: 'image/png',
          name: 'hero.png',
        },
        keyColor: 'blue',
        lastFrame: {
          data: await createPngBase64(1, 1, [255, 255, 255]),
          mimeType: 'image/png',
          name: 'last-frame.png',
        },
        modelId: 'gemini-3-flash',
        normalizedSize: 512,
        pipeline: 'image-strip',
        prompt: 'Side-profile idle strip on a blue key background.',
      })

    expect(response.status).toBe(200)
    expect(__mock.generateContent).toHaveBeenCalledTimes(1)
    expect(response.body.model).toBe('gemini-3-flash')
    expect(response.body.artifacts.metadata).toMatchObject({
      fps: 8,
      frameCount: 4,
      keyColor: 'blue',
      normalizedSize: 512,
      pipeline: 'image-strip',
      sampleStrategy: 'strip',
      sourceModel: 'gemini-3-flash',
    })
    expect(response.body.artifacts.video).toBeNull()
    expect(response.body.artifacts.spriteSheet.mimeType).toBe('image/png')
    expect(response.body.artifacts.frames).toHaveLength(4)
    expect(response.body.prompt).toContain('sprite strip')
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
