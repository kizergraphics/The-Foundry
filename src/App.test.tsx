import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadBlobMock, downloadDataUrlMock, normalizeSquareTextureDataUrlMock } = vi.hoisted(() => ({
  downloadBlobMock: vi.fn(),
  downloadDataUrlMock: vi.fn(),
  normalizeSquareTextureDataUrlMock: vi.fn(async (source: string | Blob) =>
    typeof source === 'string' ? source : '',
  ),
}))

vi.mock('./lib/browser', async () => {
  const actual = await vi.importActual<typeof import('./lib/browser')>('./lib/browser')

  return {
    ...actual,
    downloadBlob: downloadBlobMock,
    downloadDataUrl: downloadDataUrlMock,
    normalizeSquareTextureDataUrl: normalizeSquareTextureDataUrlMock,
  }
})

import App from './App'

function buildJsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response
}

describe('App variant forge ideas', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    let ideaRequestCount = 0

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true })
      }

      if (url === '/api/usage/telemetry') {
        return buildJsonResponse({
          generatedAt: new Date('2026-03-19T12:00:00.000Z').toISOString(),
          rows: [],
          source: 'local',
          timeZone: 'America/Los_Angeles',
        })
      }

      if (url === '/api/variant-forge-ideas') {
        ideaRequestCount += 1

        return buildJsonResponse({
          ideas: [
            `idea-${ideaRequestCount}-alpha`,
            `idea-${ideaRequestCount}-beta`,
            `idea-${ideaRequestCount}-gamma`,
            `idea-${ideaRequestCount}-delta`,
          ],
          source: 'ai',
        })
      }

      return buildJsonResponse({})
    })

    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    downloadBlobMock.mockReset()
    fetchMock.mockReset()
    downloadDataUrlMock.mockReset()
    normalizeSquareTextureDataUrlMock.mockClear()
    window.localStorage.clear()
  })

  it('auto-refreshes variant forge ideas and shows rarity cards only for the rarity family', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /variant forge/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/variant-forge-ideas'),
      ).toHaveLength(1)
    })

    expect(screen.queryByText('Rarity Cards')).not.toBeInTheDocument()
    expect(await screen.findByText('+ idea-1-alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Rarity/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/variant-forge-ideas'),
      ).toHaveLength(2)
    })

    expect(screen.getByText('Rarity Cards')).toBeInTheDocument()
    expect(await screen.findByText('+ idea-2-alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Legendary/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/variant-forge-ideas'),
      ).toHaveLength(3)
    })

    expect(await screen.findByText('+ idea-3-alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /refresh ideas/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/variant-forge-ideas'),
      ).toHaveLength(4)
    })

    expect(await screen.findByText('+ idea-4-alpha')).toBeInTheDocument()
  })
})

describe('App Texture Lab material packs', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const textureBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII='

  beforeEach(() => {
    let materialMapRequestCount = 0

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true })
      }

      if (url === '/api/usage/telemetry') {
        return buildJsonResponse({
          generatedAt: new Date('2026-03-19T12:00:00.000Z').toISOString(),
          rows: [],
          source: 'local',
          timeZone: 'America/Los_Angeles',
        })
      }

      if (url === '/api/variant-forge-ideas') {
        return buildJsonResponse({
          ideas: ['idea-a', 'idea-b', 'idea-c', 'idea-d'],
          source: 'ai',
        })
      }

      if (url === '/api/forge') {
        return buildJsonResponse({
          images: [
            {
              data: textureBase64,
              id: 'texture-result-1',
              mimeType: 'image/png',
              text: 'weathered stone floor',
            },
          ],
          model: 'gemini-3-pro',
          prompt: 'weathered stone floor',
        })
      }

      if (url === '/api/material-maps') {
        materialMapRequestCount += 1

        return buildJsonResponse({
          maps: {
            height: {
              data: textureBase64,
              height: 1,
              id: `height-${materialMapRequestCount}`,
              mimeType: 'image/png',
              width: 1,
            },
            metallic: {
              data: textureBase64,
              height: 1,
              id: `metallic-${materialMapRequestCount}`,
              mimeType: 'image/png',
              width: 1,
            },
            normal: {
              data: textureBase64,
              height: 1,
              id: `normal-${materialMapRequestCount}`,
              mimeType: 'image/png',
              width: 1,
            },
            roughness: {
              data: textureBase64,
              height: 1,
              id: `roughness-${materialMapRequestCount}`,
              mimeType: 'image/png',
              width: 1,
            },
          },
          model: 'gemini-3-pro',
        })
      }

      return buildJsonResponse({})
    })

    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    downloadBlobMock.mockReset()
    downloadDataUrlMock.mockReset()
    normalizeSquareTextureDataUrlMock.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    downloadBlobMock.mockReset()
    fetchMock.mockReset()
    downloadDataUrlMock.mockReset()
    normalizeSquareTextureDataUrlMock.mockClear()
    window.localStorage.clear()
  })

  it('shows Generate Maps for Texture Lab results and supports initial bake and download flows', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Texture Lab/i }))
    fireEvent.change(
      screen.getByPlaceholderText(/Ornate steel longsword/i),
      { target: { value: 'weathered stone floor' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /^FORGE/i }))

    const [generateMapsButton] = await screen.findAllByRole('button', { name: /Generate Maps/i })
    fireEvent.click(generateMapsButton)

    const materialPackTitle = await screen.findByText('Material Pack')
    const materialPack = materialPackTitle.closest('section')

    expect(materialPack).not.toBeNull()
    if (!materialPack) {
      throw new Error('Expected the material pack section to render.')
    }

    await waitFor(() => {
      expect(
        within(materialPack).getByRole('button', { name: /Download All Maps/i }),
      ).toBeEnabled()
    })

    const materialMapRequestsAfterFirstGenerate = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/material-maps',
    )
    const initialMaterialMapRequest = JSON.parse(
      String(materialMapRequestsAfterFirstGenerate[0]?.[1]?.body ?? '{}'),
    )

    expect(initialMaterialMapRequest.heightStrength).toBe(60)
    expect(initialMaterialMapRequest.normalStrength).toBe(60)

    fireEvent.click(within(materialPack).getByRole('button', { name: /Download Height/i }))
    fireEvent.click(within(materialPack).getByRole('button', { name: /Download All Maps/i }))

    await waitFor(() => {
      expect(downloadDataUrlMock).toHaveBeenCalledTimes(5)
    })
  })

  it('queues Texture Lab batch slots one at a time so later requests wait for earlier slots to finish', async () => {
    const forgeRequestResolvers: Array<() => void> = []
    let forgeRequestCount = 0

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true })
      }

      if (url === '/api/usage/telemetry') {
        return buildJsonResponse({
          generatedAt: new Date('2026-03-19T12:00:00.000Z').toISOString(),
          rows: [],
          source: 'local',
          timeZone: 'America/Los_Angeles',
        })
      }

      if (url === '/api/variant-forge-ideas') {
        return buildJsonResponse({
          ideas: ['idea-a', 'idea-b', 'idea-c', 'idea-d'],
          source: 'ai',
        })
      }

      if (url === '/api/forge') {
        forgeRequestCount += 1
        const requestId = forgeRequestCount

        return new Promise<Response>((resolve) => {
          forgeRequestResolvers.push(() => {
            resolve(
              buildJsonResponse({
                images: [
                  {
                    data: textureBase64,
                    id: `texture-result-${requestId}`,
                    mimeType: 'image/png',
                    text: 'weathered stone floor',
                  },
                ],
                model: 'gemini-3-pro',
                prompt: 'weathered stone floor',
              }),
            )
          })
        })
      }

      return buildJsonResponse({})
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Texture Lab/i }))
    fireEvent.change(
      screen.getByPlaceholderText(/Ornate steel longsword/i),
      { target: { value: 'weathered stone floor' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /^FORGE/i }))

    await waitFor(() => {
      expect(forgeRequestCount).toBe(1)
    })

    forgeRequestResolvers.shift()?.()

    await waitFor(() => {
      expect(forgeRequestCount).toBe(2)
    })

    forgeRequestResolvers.shift()?.()

    await waitFor(() => {
      expect(forgeRequestCount).toBe(3)
    })

    forgeRequestResolvers.shift()?.()

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Generate Maps/i }).length).toBeGreaterThanOrEqual(2)
    })
  })
})

describe('App VFX Forge flow', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const textureBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII='

  beforeEach(() => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true })
      }

      if (url === '/api/usage/telemetry') {
        return buildJsonResponse({
          generatedAt: new Date('2026-03-19T12:00:00.000Z').toISOString(),
          rows: [],
          source: 'local',
          timeZone: 'America/Los_Angeles',
        })
      }

      if (url === '/api/variant-forge-ideas') {
        return buildJsonResponse({
          ideas: ['idea-a', 'idea-b', 'idea-c', 'idea-d'],
          source: 'ai',
        })
      }

      if (url === '/api/forge') {
        const requestBody = JSON.parse(String(init?.body ?? '{}'))

        return buildJsonResponse({
          images: [
            {
              data: textureBase64,
              id: `vfx-${requestBody.textureKind}`,
              mimeType: 'image/png',
              text: `${requestBody.textureKind} ready`,
            },
          ],
          model: 'gemini-3-flash',
          prompt: `${requestBody.textureKind} prompt`,
        })
      }

      if (url === '/api/vfx-recipe') {
        return buildJsonResponse({
          recipe: {
            displayName: 'Custom Effect',
            effectLabel: 'Custom Effect',
            exportTarget: 'vfx-graph',
            frameCount: 8,
            importNotes: ['Use the manifest with a future Unity importer.'],
            intensity: 60,
            looping: true,
            materialConfig: {
              blendMode: 'additive',
              materialKey: 'urp_particles_unlit_generic',
              shader: 'Universal Render Pipeline/Particles/Unlit',
              textureBindings: [],
            },
            particleSystemConfig: {
              blendMode: 'additive',
              bursts: [],
              colorOverLife: [],
              emission: {
                rateOverDistance: 0,
                rateOverTime: 0,
              },
              frameCount: 8,
              intensity: 60,
              lifetime: {
                max: 1,
                min: 0.5,
              },
              looping: true,
              rendererMode: 'billboard',
              size: {
                max: 1,
                min: 0.2,
              },
              velocity: {
                direction: [0, 0, 1],
                space: 'local',
                speedMax: 2,
                speedMin: 1,
              },
            },
            previewStrategy: 'flipbook-strip',
            prompt: '',
            recipeKind: 'generic',
            recipeVersion: '1.0.0',
            textures: [],
            unityPipeline: 'urp',
            vfxGraphConfig: {
              exposedProperties: [],
              frameCount: 8,
              intensity: 60,
              looping: true,
              template: 'urp_vfx_generic',
            },
          },
        })
      }

      if (url === '/api/vfx-export') {
        return {
          blob: async () => new Blob(['zip-bytes'], { type: 'application/zip' }),
          ok: true,
        } as Response
      }

      return buildJsonResponse({})
    })

    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    downloadBlobMock.mockReset()
    downloadDataUrlMock.mockReset()
    normalizeSquareTextureDataUrlMock.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    downloadBlobMock.mockReset()
    fetchMock.mockReset()
    downloadDataUrlMock.mockReset()
    normalizeSquareTextureDataUrlMock.mockClear()
    window.localStorage.clear()
  })

  it('supports the generate textures, build recipe, and download bundle flow', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /vfx forge/i }))
    fireEvent.click(screen.getByRole('button', { name: /VFX Graph/i }))
    fireEvent.click(screen.getByRole('button', { name: /GENERATE TEXTURES/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /Build Recipe/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/vfx-recipe')).toHaveLength(1)
    })

    const recipeRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/vfx-recipe')?.[1]?.body ?? '{}'),
    )

    expect(recipeRequest.textureOutputs).toEqual(['flipbook'])
    expect(recipeRequest.exportTarget).toBe('vfx-graph')

    fireEvent.click(screen.getByRole('button', { name: /Download Bundle/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/vfx-export')).toHaveLength(1)
    })
    expect(downloadBlobMock).toHaveBeenCalledTimes(1)
  })
})
