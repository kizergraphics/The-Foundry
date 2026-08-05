import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultUiLayout } from './lib/uiLayout'

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

function buildReferenceFile(name = 'style-ref.png') {
  return new File(['style-reference-bytes'], name, {
    type: 'image/png',
  })
}

function installImageUploadMocks() {
  vi.stubGlobal('Image', class {
    onerror: null | (() => void) = null
    onload: null | (() => void) = null

    set src(_value: string) {
      setTimeout(() => {
        this.onload?.()
      }, 0)
    }
  })

  class MockUrl extends URL {
    static createObjectURL = vi.fn(() => 'blob:style-reference')
    static revokeObjectURL = vi.fn()
  }

  vi.stubGlobal(
    'URL',
    MockUrl,
  )
}

function getOrderedTestIds(
  container: ParentNode,
  prefix: string,
  excludePrefix?: string,
) {
  return Array.from(container.querySelectorAll(`[data-testid^="${prefix}"]`))
    .map((node) => node.getAttribute('data-testid'))
    .filter(
      (value): value is string =>
        value !== null && (!excludePrefix || !value.startsWith(excludePrefix)),
    )
}

function readPersistedAppState() {
  const rawState = window.localStorage.getItem('kizer-forge-state')

  return rawState ? (JSON.parse(rawState) as Record<string, unknown>) : null
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

    fireEvent.click(screen.getByTestId('mode-tab-button-variant-forge'))

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

describe('App model selection', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const imageBase64 =
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
              data: imageBase64,
              id: 'armory-result-1',
              mimeType: 'image/png',
              text: 'hero sword',
            },
          ],
          model: requestBody.modelId,
          prompt: requestBody.prompt,
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
    fetchMock.mockReset()
    window.localStorage.clear()
  })

  it('keeps the selected Gemini armory model for the forge request and stream label', async () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          activeMode: 'armory',
          generationCount: 1,
          prompt: 'hero sword',
        },
        session: {
          mode: 'armory',
          savedAt: '2026-03-10T00:00:00.000Z',
          serverModel: 'openai-gpt-image-2',
          serverPrompt: 'old openai run',
        },
      }),
    )

    render(<App />)

    fireEvent.click(
      await screen.findByRole('button', { name: /^Gemini 3\.1 Flash Image$/i }),
    )

    expect(screen.getByText('gemini-3-flash response stream')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^FORGE/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(1)
    })

    const forgeRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.body ?? '{}'),
    )

    expect(forgeRequest.modelId).toBe('gemini-3-flash')
    expect(await screen.findByText('gemini-3-flash response stream')).toBeInTheDocument()
  })

  it('retries a failed standard multi-generation slot and completes the batch', async () => {
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

        if (forgeRequestCount === 2) {
          return buildJsonResponse(
            {
              error: {
                code: 'model_output_incompatible',
                message: 'The selected model returned no image candidates.',
                title: 'No Image Output Returned',
              },
            },
            false,
          )
        }

        return buildJsonResponse({
          images: [
            {
              data: imageBase64,
              id: `armory-result-${forgeRequestCount}`,
              mimeType: 'image/png',
              text: 'hero sword',
            },
          ],
          model: 'gemini-3-flash',
          prompt: 'hero sword',
        })
      }

      return buildJsonResponse({})
    })

    render(<App />)

    fireEvent.click(
      await screen.findByRole('button', { name: /^Gemini 3\.1 Flash Image$/i }),
    )
    fireEvent.change(screen.getByPlaceholderText(/Ornate steel longsword/i), {
      target: {
        value: 'hero sword',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /^2$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^FORGE/i }))

    await waitFor(
      () => {
        expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(3)
      },
      {
        timeout: 3500,
      },
    )

    expect(await screen.findByText(/Forge pass completed with 2 candidate outputs/i)).toBeInTheDocument()
  })
})

describe('App Texture Lab expansion flow', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
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

      return buildJsonResponse({})
    })

    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    window.localStorage.clear()
  })

  it('shows only the expansion workflow and no material preview or map generation actions', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))

    expect(await screen.findByText('Expansion Workflow')).toBeInTheDocument()
    expect(screen.getByText(/Expand an existing texture into a larger, seamless surface/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Generate$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate Maps/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Live Material View/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /EXPAND TEXTURE/i })).toBeDisabled()
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

    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))
    fireEvent.click(screen.getByRole('button', { name: /VFX Graph/i }))
    fireEvent.click(screen.getByRole('button', { name: /GENERATE TEXTURES/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(1)
    })

    const forgeRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.body ?? '{}'),
    )

    expect(forgeRequest.references).toBeUndefined()

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

  it('includes an optional style reference in VFX forge requests', async () => {
    installImageUploadMocks()

    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))

    await waitFor(() => {
      expect(screen.getByTestId('layout-item-style-reference')).toBeInTheDocument()
    })

    const styleReferenceInput = screen
      .getByTestId('layout-item-style-reference')
      .querySelector('input[type="file"]')

    expect(styleReferenceInput).not.toBeNull()
    if (!styleReferenceInput) {
      throw new Error('Expected the VFX style reference upload input to render.')
    }

    fireEvent.change(styleReferenceInput, {
      target: {
        files: [buildReferenceFile()],
      },
    })

    await waitFor(() => {
      expect(
        within(screen.getByTestId('layout-item-style-reference')).getByText('style-ref.png'),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /GENERATE TEXTURES/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(1)
    })

    const forgeRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.body ?? '{}'),
    )

    expect(forgeRequest.references).toEqual([
      expect.objectContaining({
        mimeType: 'image/png',
        name: 'style-ref.png',
        slot: 'style',
      }),
    ])
  })

  it('lets you remove an attached VFX style reference before generation', async () => {
    installImageUploadMocks()

    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))

    await waitFor(() => {
      expect(screen.getByTestId('layout-item-style-reference')).toBeInTheDocument()
    })

    const styleReferenceCard = screen.getByTestId('layout-item-style-reference')
    const styleReferenceInput = styleReferenceCard.querySelector('input[type="file"]')

    expect(styleReferenceInput).not.toBeNull()
    if (!styleReferenceInput) {
      throw new Error('Expected the VFX style reference upload input to render.')
    }

    fireEvent.change(styleReferenceInput, {
      target: {
        files: [buildReferenceFile()],
      },
    })

    await waitFor(() => {
      expect(within(styleReferenceCard).getByText('style-ref.png')).toBeInTheDocument()
    })

    fireEvent.click(within(styleReferenceCard).getByRole('button', { name: /Remove/i }))

    await waitFor(() => {
      expect(within(styleReferenceCard).queryByText('style-ref.png')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /GENERATE TEXTURES/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(1)
    })

    const forgeRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.body ?? '{}'),
    )

    expect(forgeRequest.references).toBeUndefined()
  })

  it('shows a live VFX frame counter beside the slider', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))

    const frameSlider = await screen.findByLabelText('VFX frame count')

    expect(screen.getByTestId('vfx-frame-count-value')).toHaveTextContent('8')

    fireEvent.change(frameSlider, {
      target: {
        value: '12',
      },
    })

    expect(screen.getByTestId('vfx-frame-count-value')).toHaveTextContent('12')
  })
})

describe('App Action Animator flow', () => {
  const fetchMock = vi.fn<typeof fetch>()

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

      if (url === '/api/action-animator') {
        const body =
          init && typeof init === 'object' && 'body' in init && typeof init.body === 'string'
            ? JSON.parse(init.body)
            : {}

        if (body.pipeline === 'image-strip') {
          return buildJsonResponse({
            artifacts: {
              frames: [
                {
                  data: 'DDDD',
                  id: 'frame-01',
                  mimeType: 'image/png',
                },
                {
                  data: 'EEEE',
                  id: 'frame-02',
                  mimeType: 'image/png',
                },
              ],
              metadata: {
                fps: 10,
                frameCount: 2,
                keyColor: 'green',
                normalizedSize: 1080,
                pipeline: 'image-strip',
                prompt: 'Image strip prompt',
                sampleStrategy: 'strip',
                sourceModel: 'openai-gpt-image-2',
              },
              spriteSheet: {
                data: 'FFFF',
                id: 'sprite-sheet',
                mimeType: 'image/png',
              },
              video: null,
            },
            model: 'openai-gpt-image-2',
            prompt: 'Image strip prompt',
          })
        }

        return buildJsonResponse({
          artifacts: {
            frames: [
              {
                data: 'AAAA',
                id: 'frame-01',
                mimeType: 'image/png',
              },
              {
                data: 'BBBB',
                id: 'frame-02',
                mimeType: 'image/png',
              },
            ],
            metadata: {
              fps: 10,
              frameCount: 2,
              keyColor: 'blue',
              normalizedSize: 512,
              pipeline: 'veo-video',
              prompt: 'Blue key prompt',
              sampleStrategy: 'even',
              sourceModel: 'veo-3.1-fast',
            },
            spriteSheet: {
              data: 'CCCC',
              id: 'sprite-sheet',
              mimeType: 'image/png',
            },
            video: {
              data: 'AAAA',
              mimeType: 'video/mp4',
            },
          },
          model: 'veo-3.1-fast',
          prompt: 'Blue key prompt',
        })
      }

      return buildJsonResponse({})
    })

    vi.stubGlobal('fetch', fetchMock)
    installImageUploadMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    downloadBlobMock.mockReset()
    downloadDataUrlMock.mockReset()
    window.localStorage.clear()
  })

  it('shows Veo as the only model option in Action Animator', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-action-animator'))

    const modelSelector = await screen.findByTestId('layout-item-model-selector')

    expect(within(modelSelector).getByRole('button', { name: /Veo 3 Fast Generate/i })).toBeInTheDocument()
    expect(
      within(modelSelector).queryByRole('button', { name: /Gemini 3 Pro Image/i }),
    ).not.toBeInTheDocument()
    expect(
      within(modelSelector).queryByRole('button', { name: /Gemini 3.1 Flash Lite Image/i }),
    ).not.toBeInTheDocument()
  })

  it('shows OpenAI GPT Image 2 in the default image model selector', async () => {
    render(<App />)

    const modelSelector = await screen.findByTestId('layout-item-model-selector')

    expect(
      within(modelSelector).getByRole('button', { name: /OpenAI GPT Image 2/i }),
    ).toBeInTheDocument()
    expect(
      within(modelSelector).getByRole('button', { name: /Gemini 3.1 Flash Lite Image/i }),
    ).toBeInTheDocument()
  })

  it('submits keyed Veo settings and exposes video and frame downloads', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-action-animator'))

    const animatorPanel = await screen.findByTestId('layout-item-action-animator-panel')
    const characterInput = animatorPanel.querySelector('input[type="file"]')

    expect(characterInput).not.toBeNull()
    if (!characterInput) {
      throw new Error('Expected the Action Animator upload input to render.')
    }

    fireEvent.change(characterInput, {
      target: {
        files: [buildReferenceFile('hero.png')],
      },
    })

    const frameSlider = await screen.findByLabelText('Action Animator frame count')
    const fpsSlider = await screen.findByLabelText('Action Animator fps')

    fireEvent.change(frameSlider, {
      target: {
        value: '12',
      },
    })
    fireEvent.change(fpsSlider, {
      target: {
        value: '10',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Blue$/i }))
    fireEvent.click(screen.getByRole('button', { name: /generate sprites/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/action-animator')).toHaveLength(1)
    })

    const animatorRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/action-animator')?.[1]?.body ?? '{}'),
    )

    expect(animatorRequest).toMatchObject({
      fps: 10,
      frameCount: 12,
      keyColor: 'blue',
      modelId: 'veo-3.1-fast',
      normalizedSize: 512,
      pipeline: 'veo-video',
    })

    await screen.findByRole('button', { name: /Download Video/i })

    fireEvent.click(within(animatorPanel).getByRole('button', { name: /Download Frames/i }))
    fireEvent.click(screen.getByRole('button', { name: /Download Video/i }))

    await waitFor(() => {
      expect(downloadDataUrlMock).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledTimes(1)
    })
  })

  it('switches to image-strip models and submits first and last frame guides', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-action-animator'))
    fireEvent.click(screen.getByRole('button', { name: /Image Strip/i }))

    const modelSelector = await screen.findByTestId('layout-item-model-selector')
    expect(
      within(modelSelector).getByRole('button', { name: /OpenAI GPT Image 2/i }),
    ).toBeInTheDocument()
    expect(
      within(modelSelector).getByRole('button', { name: /Gemini 3 Pro Image/i }),
    ).toBeInTheDocument()
    expect(
      within(modelSelector).queryByRole('button', { name: /Veo 3 Fast Generate/i }),
    ).not.toBeInTheDocument()

    const animatorPanel = await screen.findByTestId('layout-item-action-animator-panel')
    const fileInputs = animatorPanel.querySelectorAll('input[type="file"]')

    expect(fileInputs).toHaveLength(3)

    fireEvent.change(fileInputs[0], {
      target: {
        files: [buildReferenceFile('hero.png')],
      },
    })
    fireEvent.change(fileInputs[1], {
      target: {
        files: [buildReferenceFile('first.png')],
      },
    })
    fireEvent.change(fileInputs[2], {
      target: {
        files: [buildReferenceFile('last.png')],
      },
    })

    await waitFor(() => {
      expect(within(animatorPanel).queryAllByText('hero.png').length).toBeGreaterThan(0)
      expect(within(animatorPanel).queryAllByText('first.png').length).toBeGreaterThan(0)
      expect(within(animatorPanel).queryAllByText('last.png').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /OpenAI GPT Image 2/i }))
    fireEvent.click(screen.getByRole('button', { name: /^1080px$/i }))
    fireEvent.click(screen.getByRole('button', { name: /generate sprites/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/action-animator')).toHaveLength(1)
    })

    const animatorRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/action-animator')?.[1]?.body ?? '{}'),
    )

    expect(animatorRequest).toMatchObject({
      firstFrame: {
        mimeType: 'image/png',
        name: 'first.png',
      },
      lastFrame: {
        mimeType: 'image/png',
        name: 'last.png',
      },
      modelId: 'openai-gpt-image-2',
      normalizedSize: 1080,
      pipeline: 'image-strip',
    })

    expect(screen.queryByRole('button', { name: /Download Video/i })).not.toBeInTheDocument()
  })
})

describe('App persistent drag-and-drop layout', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
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

      return buildJsonResponse({})
    })

    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    window.localStorage.clear()
  })

  it('restores persisted mode tab order across rerenders', async () => {
    const view = render(<App />)

    await waitFor(() => {
      expect(readPersistedAppState()).not.toBeNull()
    })

    const storedState = readPersistedAppState() as {
      settings: {
        uiLayout: ReturnType<typeof getDefaultUiLayout>
      }
    }
    const nextLayout = {
      ...storedState.settings.uiLayout,
      global: {
        ...storedState.settings.uiLayout.global,
        modeTabs: [
          'armory',
          'action-animator',
          'variant-forge',
          'portrait-studio',
          'texture-lab',
          'vfx-forge',
          'uv-lab',
          'visualizer',
          'character-sheet',
        ],
      },
    }

    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        ...storedState,
        settings: {
          ...storedState.settings,
          uiLayout: nextLayout,
        },
      }),
    )

    view.unmount()
    render(<App />)

    const tabsContainer = (await screen.findByTestId('shell-item-mode-tabs')).querySelector('nav')

    expect(tabsContainer).not.toBeNull()
    if (!tabsContainer) {
      throw new Error('Expected the mode tabs container after rerender.')
    }

    await waitFor(() => {
      const orderedTabs = getOrderedTestIds(tabsContainer, 'mode-tab-', 'mode-tab-handle-')
      expect(orderedTabs.indexOf('mode-tab-vfx-forge')).toBeLessThan(
        orderedTabs.indexOf('mode-tab-uv-lab'),
      )
    })
  })

  it('keeps vfx panel layout overrides scoped to that tab and persists them', async () => {
    const view = render(<App />)

    await waitFor(() => {
      expect(readPersistedAppState()).not.toBeNull()
    })

    const storedState = readPersistedAppState() as {
      settings: {
        uiLayout: ReturnType<typeof getDefaultUiLayout>
      }
    }
    const nextLayout = {
      ...storedState.settings.uiLayout,
      byMode: {
        ...storedState.settings.uiLayout.byMode,
        'vfx-forge': {
          control: {
            primary: ['vfx-forge-panel', 'model-selector'],
            secondary: ['forge-action'],
          },
          workspace: {
            bottom: [],
            main: ['forge-brief', 'result-grid'],
            top: ['top-panel'],
          },
        },
      },
    }

    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        ...storedState,
        settings: {
          ...storedState.settings,
          uiLayout: nextLayout,
        },
      }),
    )

    view.unmount()
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))

    await waitFor(() => {
      expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-').slice(0, 3)).toEqual([
        'layout-item-vfx-forge-panel',
        'layout-item-model-selector',
        'layout-item-style-reference',
      ])
    })

    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))

    expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-')[0]).toBe(
      'layout-item-model-selector',
    )
  })

  it('resets per-tab and global layouts independently', async () => {
    const view = render(<App />)

    await waitFor(() => {
      expect(readPersistedAppState()).not.toBeNull()
    })

    const storedState = readPersistedAppState() as {
      settings: {
        uiLayout: ReturnType<typeof getDefaultUiLayout>
      }
    }
    const nextLayout = {
      ...storedState.settings.uiLayout,
      byMode: {
        ...storedState.settings.uiLayout.byMode,
        'vfx-forge': {
          control: {
            primary: ['vfx-forge-panel', 'model-selector'],
            secondary: ['forge-action'],
          },
          workspace: {
            bottom: [],
            main: ['forge-brief', 'result-grid'],
            top: ['top-panel'],
          },
        },
      },
      global: {
        ...storedState.settings.uiLayout.global,
        modeTabs: [
          'armory',
          'action-animator',
          'variant-forge',
          'portrait-studio',
          'texture-lab',
          'vfx-forge',
          'uv-lab',
          'visualizer',
          'character-sheet',
        ],
      },
    }

    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        ...storedState,
        settings: {
          ...storedState.settings,
          uiLayout: nextLayout,
        },
      }),
    )

    view.unmount()
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))

    await waitFor(() => {
      expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-').slice(0, 3)).toEqual([
        'layout-item-vfx-forge-panel',
        'layout-item-model-selector',
        'layout-item-style-reference',
      ])
    })

    fireEvent.click(screen.getByRole('button', { name: /reset this tab layout/i }))

    await waitFor(() => {
      expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-').slice(0, 3)).toEqual([
        'layout-item-model-selector',
        'layout-item-vfx-forge-panel',
        'layout-item-style-reference',
      ])
    })

    const tabsContainer = screen.getByTestId('shell-item-mode-tabs').querySelector('nav')

    expect(tabsContainer).not.toBeNull()
    if (!tabsContainer) {
      throw new Error('Expected the mode tabs container to render.')
    }

    let orderedTabs = getOrderedTestIds(tabsContainer, 'mode-tab-', 'mode-tab-handle-')
    expect(orderedTabs.indexOf('mode-tab-vfx-forge')).toBeLessThan(
      orderedTabs.indexOf('mode-tab-uv-lab'),
    )

    fireEvent.click(screen.getByRole('button', { name: /reset all layouts/i }))

    await waitFor(() => {
      orderedTabs = getOrderedTestIds(tabsContainer, 'mode-tab-', 'mode-tab-handle-')
      expect(orderedTabs.indexOf('mode-tab-uv-lab')).toBeLessThan(
        orderedTabs.indexOf('mode-tab-vfx-forge'),
      )
    })
  })
})
