// @vitest-environment node
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const codex = vi.hoisted(() => ({ getCodexStatus: vi.fn(), generateCodexImages: vi.fn(), generateCodexText: vi.fn() }))
vi.mock('./codexRuntime.js', () => codex)
const originalEnv = { ...process.env }
let libraryDir
async function loadServerModule(env = {}) {
  vi.resetModules()
  process.env = { ...originalEnv, NODE_ENV: 'test', OPENAI_API_KEY: '', CODEX_API_KEY: '', FORGE_API_TOKEN: '', CORS_ORIGIN: '', ENABLE_PROMPT_ORCHESTRATION: 'false', FOUNDRY_IMAGE_LIBRARY_DIR: libraryDir, ...env }
  return import('./index.js')
}
async function loadApp(env = {}) { return (await loadServerModule(env)).app }
// Fail closed: neither an unmocked runtime job nor fetch may generate or spend credit.
beforeEach(async () => {
  libraryDir = await mkdtemp(path.join(tmpdir(), 'foundry-test-library-'))
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request in offline test')))
  codex.getCodexStatus.mockResolvedValue({ available: true, authenticated: true, ready: true, provider: 'codex', message: 'Codex is ready.' })
  codex.generateCodexImages.mockRejectedValue(new Error('Unexpected Codex image job in offline test'))
  codex.generateCodexText.mockRejectedValue(new Error('Unexpected Codex text job in offline test'))
})
afterEach(async () => {
  await rm(libraryDir, { recursive: true, force: true })
  expect(fetch).not.toHaveBeenCalled()
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
  vi.resetModules()
})
function post(app, route) { return request(app).post(route).set('X-Foundry-Request', '1') }
async function createPngBase64(width, height, channelValues) {
  return (await sharp(Buffer.alloc(width * height * 3, Buffer.from(channelValues)), { raw: { channels: 3, height, width } }).png().toBuffer()).toString('base64')
}
function buildBinaryParser() {
  return (response, callback) => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => callback(null, Buffer.concat(chunks))) }
}
async function mockImageProvider(width = 1, height = 1) {
  const buffer = Buffer.from(await createPngBase64(width, height, [120, 80, 40]), 'base64')
  codex.generateCodexImages.mockResolvedValue({ provider: 'codex', images: [{ buffer, mimeType: 'image/png', revisedPrompt: 'Codex concept render' }] })
  return buffer
}

describe('retained validation and deterministic exports', () => {
  it('rejects oversized inline media on forge requests', async () => {
    const app = await loadApp({
      OPENAI_API_KEY: 'offline-test-key',
    })

    const oversizedImageData = 'A'.repeat(8 * 1024 * 1024)
    const response = await request(app)
      .post('/api/forge').set('X-Foundry-Request', '1')
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
      OPENAI_API_KEY: 'offline-test-key',
    })

    const response = await request(app)
      .post('/api/variant-forge-ideas').set('X-Foundry-Request', '1')
      .send({
        variantFamily: 'damage',
        variantPreset: 'legendary',
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_request')
  })
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
      .post('/api/vfx-recipe').set('X-Foundry-Request', '1')
      .send({
        ...basePayload,
        exportTarget: 'particle-system',
      })
    const graphResponse = await request(app)
      .post('/api/vfx-recipe').set('X-Foundry-Request', '1')
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
      .post('/api/vfx-export').set('X-Foundry-Request', '1')
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

describe('managed Codex generation', () => {
  it.each([undefined, 'codex', 'openai-gpt-image-2'])('uses Codex for model alias %s without API credentials or fetch', async modelId => {
    await mockImageProvider()
    const app = await loadApp({ OPENAI_IMAGE_MODEL: 'must-not-be-used', OPENAI_BASE_URL: 'https://must-not-be-used.example' })
    const response = await post(app, '/api/forge').send({ mode: 'armory', modelId, prompt: 'bronze gauntlet', quality: 'high' })
    expect(response.status).toBe(200)
    expect(response.body.model).toBe('codex')
    expect(response.body.images).toHaveLength(1)
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
    expect(codex.generateCodexImages.mock.calls[0][0]).toMatchObject({ prompt: expect.stringContaining('bronze gauntlet'), count: 1 })
  })
  it('rejects unknown model overrides before generation', async () => {
    const app = await loadApp()
    const response = await post(app, '/api/forge').send({ mode: 'armory', modelId: 'untrusted-custom-model', prompt: 'sword' })
    expect(response.status).toBe(400)
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
  it('uses Codex text for idea refresh', async () => {
    codex.generateCodexText.mockResolvedValue('wind-carved fuller\ndrifting pollen halo\nseedpod pommel wrap\nthorn-vein filigree')
    const response = await post(await loadApp(), '/api/variant-forge-ideas').send({ variantFamily: 'elemental', variantPreset: 'burning' })
    expect(response.status).toBe(200)
    expect(response.body.source).toBe('ai')
    expect(response.body.ideas).toHaveLength(4)
    expect(codex.generateCodexText).toHaveBeenCalledTimes(1)
    expect(codex.generateCodexText.mock.calls[0][0]).toMatchObject({ prompt: expect.any(String), systemInstruction: expect.any(String) })
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
  it('passes all original character reference buffers to Codex', async () => {
    await mockImageProvider()
    const data = await createPngBase64(2048, 512, [50, 90, 130])
    const response = await post(await loadApp(), '/api/character-sheet').send({ generationMode: 'reference', prompt: 'cel-shaded turnaround', references: [['face', 'Identity_Reference'], ['outfit', 'Clothing_Reference'], ['art-style', 'Style_Reference']].map(([slot, role]) => ({ data, mimeType: 'image/png', role, slot })) })
    expect(response.status).toBe(200)
    const job = codex.generateCodexImages.mock.calls[0][0]
    expect(job.references).toHaveLength(3)
    expect(Buffer.isBuffer(job.references[0])).toBe(true)
    const metadata = await sharp(job.references[0]).metadata()
    expect(Math.max(metadata.width, metadata.height)).toBe(2048)
  })
  it('retains staged character and VFX style reference instructions', async () => {
    const buffer = await mockImageProvider()
    const image = { data: buffer.toString('base64'), mimeType: 'image/png' }
    const app = await loadApp()
    const character = await post(app, '/api/character-sheet').send({ generationMode: 'manifest', prompt: 'calm hero turnaround', consistencyReference: image })
    expect(character.status).toBe(200)
    expect(codex.generateCodexImages.mock.calls[0][0].prompt).toContain('staged prior sheet reference')
    const vfx = await post(app, '/api/forge').send({ mode: 'vfx-forge', textureKind: 'flipbook', references: [{ ...image, slot: 'style' }] })
    expect(vfx.status).toBe(200)
    expect(codex.generateCodexImages.mock.calls[1][0].prompt).toContain('A style reference image is attached;')
    const library = await request(app).get('/api/library').expect(200)
    expect(library.body.images.map(image => image.mode)).toEqual(['vfx-forge', 'character-sheet'])
  })
  it('routes Animator source and guide frames to Codex and exports complete frame artifacts', async () => {
    const tile = Buffer.from(await createPngBase64(32, 56, [120, 80, 40]), 'base64')
    const buffer = await sharp({ create: {width: 192, height: 128, channels: 3, background: '#0000FF'} }).composite([0,1,2,3].map(index => ({input: tile, left: index % 2 * 96 + 32, top: Math.floor(index / 2) * 64 + 4}))).png().toBuffer()
    codex.generateCodexImages.mockResolvedValue({ provider: 'codex', images: [{ buffer, mimeType: 'image/png' }] })
    const image = { data: buffer.toString('base64'), mimeType: 'image/png', name: 'hero.png' }
    const app = await loadApp()
    const response = await post(app, '/api/action-animator').send({ actionType: 'jump', pipeline: 'image-strip', image, firstFrame: image, lastFrame: image, frameCount: 4, fps: 8, normalizedSize: 512, keyColor: 'blue', quality: 'high' })
    expect(response.status).toBe(200)
    expect(response.body.artifacts.frames).toHaveLength(4)
    expect(response.body.artifacts).not.toHaveProperty('video')
    expect(response.body.artifacts.metadata).toMatchObject({ pipeline: 'image-strip', sampleStrategy: 'strip', frameCount: 4, keyColor: 'blue' })
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
    expect(codex.generateCodexImages.mock.calls[0][0].references).toHaveLength(3)
    const library = await request(app).get('/api/library').expect(200)
    expect(library.body.images).toHaveLength(5)
    expect(library.body.images.every(image => image.mode === 'action-animator')).toBe(true)
  })
  it('requests one Codex batch and preserves output order', async () => {
    const buffer = await mockImageProvider()
    codex.generateCodexImages.mockResolvedValue({ provider: 'codex', images: ['first', 'second'].map(revisedPrompt => ({ buffer, mimeType: 'image/png', revisedPrompt })) })
    const response = await post(await loadApp(), '/api/forge').send({ generationCount: 2, mode: 'texture-lab', prompt: 'basalt floor', workflow: 'generate' })
    expect(response.status).toBe(200)
    expect(response.body.images.map(image => image.text)).toEqual(['first', 'second'])
    expect(response.body).toMatchObject({ requestedCount: 2, completedCount: 2, partial: false })
    expect(response.body).not.toHaveProperty('warning')
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
    expect(codex.generateCodexImages.mock.calls[0][0].count).toBe(2)
  })
  it('preserves partial output without retrying generation', async () => {
    await mockImageProvider()
    const response = await post(await loadApp(), '/api/forge').send({ mode: 'armory', generationCount: 3, prompt: 'bronze gauntlet' })
    expect(response.status).toBe(200)
    expect(response.body.images).toHaveLength(1)
    expect(response.body).toMatchObject({ requestedCount: 3, completedCount: 1, partial: true })
    expect(response.body.warning).toMatch(/no automatic.*retry/i)
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
    expect(codex.generateCodexImages.mock.calls[0][0].count).toBe(3)
  })
  it('rejects empty output rather than claiming partial success', async () => {
    codex.generateCodexImages.mockResolvedValue({ provider: 'codex', images: [] })
    const response = await post(await loadApp(), '/api/forge').send({ mode: 'armory', generationCount: 2, prompt: 'bronze gauntlet' })
    expect(response.status).toBe(422)
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
  })
  it.each([['CODEX_BUSY', 409, 'Codex is busy. Try again after the current job finishes.'], ['CODEX_NOT_AUTHENTICATED', 401, 'Sign in to Codex with ChatGPT to generate images.']])('returns readable %s errors without fallback or retry', async (code, status, message) => {
    codex.generateCodexImages.mockRejectedValue(Object.assign(new Error(message), { code, status }))
    const response = await post(await loadApp(), '/api/forge').send({ mode: 'armory', prompt: 'bronze gauntlet' })
    expect(response.status).toBe(status)
    expect(response.text).toContain(message)
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
    expect(codex.generateCodexText).not.toHaveBeenCalled()
  })
})

describe('image library', () => {
  it('keeps completed images across app restarts and removes a selection across categories', async () => {
    const original = await mockImageProvider()
    const app = await loadApp()
    await request(app).get('/api/library').expect(200, { images: [] })
    for (const [mode, prompt] of [['armory', 'bronze lantern'], ['armory', 'stone lantern'], ['variant-forge', 'aged metal lantern']]) {
      await post(app, '/api/forge').send({ mode, prompt }).expect(200).expect('X-Foundry-Library', 'saved')
    }

    const restarted = await loadApp()
    const response = await request(restarted).get('/api/library').expect(200)
    expect(response.body.images).toHaveLength(3)
    const entries = Object.fromEntries(response.body.images.map(entry => [entry.title, entry]))
    const bronze = entries['bronze lantern']
    const stone = entries['stone lantern']
    const variant = response.body.images.find(entry => entry.mode === 'variant-forge')
    const originalResponse = await request(restarted).get(`/api/library/${bronze.id}/image.png`).expect(200)
    expect(originalResponse.body).toEqual(original)
    await request(restarted).get(`/api/library/${bronze.id}/thumbnail.webp`).expect(200).expect('Content-Type', 'image/webp')
    await request(restarted).post('/api/library/delete').send({ ids: [bronze.id] }).expect(403)
    await post(restarted, '/api/library/delete').send({ ids: [bronze.id, '../invalid'] }).expect(400)
    await post(restarted, '/api/library/delete').send({ ids: [bronze.id, variant.id] }).expect(204)
    await request(restarted).get(`/api/library/${bronze.id}/image.png`).expect(404)
    await request(restarted).get('/api/library').expect(200, { images: [stone] })
  })

  it('still returns the original result and reports a library write failure', async () => {
    const original = await mockImageProvider()
    const invalidDirectory = path.join(libraryDir, 'file')
    await writeFile(invalidDirectory, '')
    const app = await loadApp({ FOUNDRY_IMAGE_LIBRARY_DIR: invalidDirectory })
    const response = await post(app, '/api/forge').send({ mode: 'armory', prompt: 'stone lantern' })
    expect(response.status).toBe(200)
    expect(response.headers['x-foundry-library']).toBe('failed')
    expect(response.body.images[0].data).toBe(original.toString('base64'))
  })
})

describe('local API security and readiness', () => {
  it('reports Codex readiness without leaking API secrets', async () => {
    const response = await request(await loadApp({ OPENAI_API_KEY: 'private-provider-secret' })).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, provider: 'codex', generationConfigured: true })
    expect(response.text).not.toContain('private-provider-secret')
    expect(codex.getCodexStatus).toHaveBeenCalled()
  })
  it('reports an unavailable runtime truthfully', async () => {
    codex.getCodexStatus.mockResolvedValue({ available: false, authenticated: false, ready: false, provider: 'codex', message: 'Install Codex to generate.' })
    const response = await request(await loadApp()).get('/api/health')
    expect(response.body).toMatchObject({ provider: 'codex', generationConfigured: false })
    expect(response.text).toContain('Install Codex')
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
  it('rejects missing same-origin request headers before generation', async () => {
    const response = await request(await loadApp()).post('/api/forge').send({ mode: 'armory', prompt: 'sword' })
    expect(response.status).toBe(403)
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
  it('enforces a configured generation token', async () => {
    const response = await post(await loadApp({ FORGE_API_TOKEN: 'test-secret' }), '/api/forge').send({ mode: 'armory', prompt: 'sword' })
    expect(response.status).toBe(401)
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
  it('rejects untrusted origins and forged host headers', async () => {
    const app = await loadApp()
    expect((await post(app, '/api/forge').set('Origin', 'https://evil.example').send({ mode: 'armory' })).status).toBe(403)
    const forged = await post(app, '/api/forge').set('Host', 'attacker.example:3001').set('Origin', 'http://attacker.example:3001').send({ mode: 'armory' })
    expect(forged.status).toBe(403)
    expect((await request(app).get('/api/health').set('Host', 'not a host')).status).toBe(403)
    expect((await request(app).get('/api/health').set('Host', 'localhost:3001').set('Origin', 'http://localhost:3001')).status).toBe(200)
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
  it('binds loopback and disallows remote hosting even with a token and trusted origin', async () => {
    const server = await loadServerModule({ HOST: '127.0.0.1' })
    const listen = vi.spyOn(server.app, 'listen').mockImplementation(() => ({ mocked: true }))
    server.startServer()
    expect(listen).toHaveBeenCalledWith(expect.any(Number), '127.0.0.1', expect.any(Function))
    for (const FORGE_API_TOKEN of ['', 'test-token', '   ']) {
      const remote = await loadServerModule({ HOST: '0.0.0.0', FORGE_API_TOKEN, CORS_ORIGIN: 'https://foundry.example' })
      const remoteListen = vi.spyOn(remote.app, 'listen').mockImplementation(() => ({ mocked: true }))
      expect(() => remote.startServer()).toThrow(/loopback/i)
      expect(remoteListen).not.toHaveBeenCalled()
    }
  })
  it('keeps removed telemetry and video routes unavailable', async () => {
    const app = await loadApp()
    for (const route of ['/api/usage', '/api/usage/telemetry', '/api/telemetry', '/api/google-telemetry', '/api/openai-telemetry', '/api/uv-lab']) expect((await request(app).get(route)).status).toBe(404)
    const response = await post(app, '/api/action-animator').send({ pipeline: 'veo-video', image: { data: await createPngBase64(1, 1, [255, 0, 0]), mimeType: 'image/png' } })
    expect(response.status).toBe(400)
    expect(codex.generateCodexImages).not.toHaveBeenCalled()
  })
})


describe('Codex texture expansion', () => {
  it('uses an authoritative visual canvas and local compositing instead of an API mask', async () => {
    await mockImageProvider(1254, 1254)
    const image = { data: await createPngBase64(2, 2, [30, 90, 150]), mimeType: 'image/png' }
    const response = await post(await loadApp(), '/api/forge').send({ mode: 'texture-lab', prompt: 'weathered basalt floor tile', textureExpansion: { canvasImage: image, sourceImage: image }, workflow: 'expand-texture' })
    expect(response.status).toBe(200)
    expect(response.body.model).toBe('codex')
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
    const job = codex.generateCodexImages.mock.calls[0][0]
    expect(job.references).toHaveLength(1)
    expect((await sharp(job.references[0]).metadata()).width).toBe(1024)
    expect(job.prompt).toContain('varied plausible new detail')
    expect(job).not.toHaveProperty('mask')
    expect(response.body.images[0].texture.maskMode).not.toContain('native mask')
  })
})



describe('native texture output geometry', () => {
  it.each([512, 1024])('delivers requested %i square source candidates from native1254 images', async textureSize => {
    const buffer = await mockImageProvider(1254, 1254)
    codex.generateCodexImages.mockResolvedValue({provider:'codex', images:['first','second'].map(revisedPrompt => ({buffer, mimeType:'image/png', revisedPrompt}))})
    const response = await post(await loadApp(), '/api/forge').send({mode:'texture-lab', prompt:'weathered stone', textureSize, generationCount:2})
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({requestedCount:2,completedCount:2,partial:false})
    expect(response.body.images.map(image => image.text)).toEqual(['first','second'])
    for (const image of response.body.images) {
      expect(await sharp(Buffer.from(image.data,'base64')).metadata()).toMatchObject({width:textureSize,height:textureSize,format:'png'})
      expect(image.providerDimensions).toEqual({width:1254,height:1254})
    }
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
  })
  it('preserves valid candidates if another native output has the wrong aspect ratio', async () => {
    const square = await mockImageProvider(1254,1254)
    const landscape = Buffer.from(await createPngBase64(1536,1024,[90,90,90]),'base64')
    codex.generateCodexImages.mockResolvedValue({provider:'codex',images:[{buffer:square,mimeType:'image/png'},{buffer:landscape,mimeType:'image/png'}]})
    const response = await post(await loadApp(), '/api/forge').send({mode:'texture-lab',prompt:'stone',generationCount:2})
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({requestedCount:2,completedCount:1,partial:true})
    expect(response.body.warning).toMatch(/aspect|square/i)
    expect(codex.generateCodexImages).toHaveBeenCalledTimes(1)
  })
})
