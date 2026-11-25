import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { getDefaultUiLayout } from './lib/uiLayout'
import { textureGeometry, validateTextureRequest } from '../shared/textureLab.js'

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
    dataUrlToFile: vi.fn(async (_source: string, name: string) => new File(['image'], name, { type: 'image/png' })),
    dataUrlToBlob: vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
    downloadBlob: downloadBlobMock,
    downloadDataUrl: downloadDataUrlMock,
    normalizeSquareTextureDataUrl: normalizeSquareTextureDataUrlMock,
  }
})

vi.mock('./components/PbrMaterialWorkbench', () => ({ PbrMaterialWorkbench: ({ source }: { source?: string }) => <div data-testid="pbr-workbench" data-source={source}>PBR material tools</div> }))

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
  const rawState = window.localStorage.getItem('foundry-web-state-v1')

  return rawState ? (JSON.parse(rawState) as Record<string, unknown>) : null
}

it('selects images across library tabs and deletes them together after confirmation', async () => {
  window.localStorage.clear()
  const dialogPrototype = HTMLDialogElement.prototype
  const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal')
  Object.defineProperty(dialogPrototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = true },
  })
  const createdAt = '2026-11-19T05:20:03Z'
  let images = [
    { id: 'armory-one', mode: 'armory', title: 'Bronze lantern', createdAt },
    { id: 'armory-two', mode: 'armory', title: 'Stone lantern', createdAt },
    { id: 'texture-one', mode: 'texture-lab', title: 'Stone texture', createdAt },
  ]
  const deletion = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (url === '/api/library') return buildJsonResponse({ images })
    if (url === '/api/library/delete') {
      const { ids } = JSON.parse(String(options?.body))
      deletion(ids)
      images = images.filter(image => !ids.includes(image.id))
    }
    return buildJsonResponse({})
  }))

  try {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Image Library' }))
    const library = within(await screen.findByRole('dialog', { name: 'Image Library' }))
    fireEvent.click(await library.findByRole('checkbox', { name: 'Bronze lantern' }))
    fireEvent.click(library.getByRole('button', { name: 'Texture Lab' }))
    fireEvent.click(library.getByRole('button', { name: 'Select all shown' }))
    expect(library.getByRole('status')).toHaveTextContent('2 selected')
    fireEvent.click(library.getByRole('button', { name: 'Delete selected' }))
    expect(deletion).not.toHaveBeenCalled()
    expect(library.getByRole('alert')).toHaveTextContent('Permanently delete 2 selected images')
    fireEvent.click(library.getByRole('button', { name: 'Confirm deletion' }))
    await waitFor(() => expect(library.queryByRole('checkbox', { name: 'Stone texture' })).not.toBeInTheDocument())
    fireEvent.click(library.getByRole('button', { name: 'All images' }))
    expect(library.getByRole('checkbox', { name: 'Stone lantern' })).toBeInTheDocument()
    expect(deletion).toHaveBeenCalledExactlyOnceWith(['armory-one', 'texture-one'])
  } finally {
    cleanup()
    vi.unstubAllGlobals()
    if (originalShowModal) Object.defineProperty(dialogPrototype, 'showModal', originalShowModal)
    else Reflect.deleteProperty(dialogPrototype, 'showModal')
    window.localStorage.clear()
  }
})

describe('App variant forge ideas', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    let ideaRequestCount = 0

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true, generationConfigured: true })
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

  it.each([false, true])('explains source texture readiness when generationConfigured=%s', async (generationConfigured) => {
    fetchMock.mockImplementation(async input => String(input) === '/api/health' ? buildJsonResponse({ ok: true, generationConfigured }) : buildJsonResponse({}))
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))
    const button = screen.getByRole('button', { name: 'Generate source texture' })
    expect(button).toBeDisabled()
    await waitFor(() => expect(screen.getByTestId('texture-generation-help')).toHaveTextContent(generationConfigured ? 'Enter a texture description' : 'Codex is not ready'))
    fireEvent.change(screen.getByLabelText('Texture description'), { target: { value: 'Weathered basalt' } })
    if (generationConfigured) expect(button).toBeEnabled()
    else {
      expect(button).toBeDisabled()
      expect(screen.getByTestId('texture-generation-help')).toHaveTextContent('sign in locally')
      expect(screen.getByTestId('texture-generation-help')).toHaveTextContent('recheck status')
    }
    expect(fetchMock.mock.calls.some(([input]) => input === '/api/forge')).toBe(false)
  })

  it('rechecks local Codex sign-in readiness without restarting', async () => {
    let ready = false
    fetchMock.mockImplementation(async input => String(input) === '/api/health'
      ? buildJsonResponse({ ok: true, provider: 'codex', generationConfigured: ready, runtime: { available: true, authenticated: ready, ready, message: ready ? 'Codex is ready.' : 'Sign in to Codex locally with your ChatGPT account.' } })
      : buildJsonResponse({}))
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))
    fireEvent.change(screen.getByLabelText('Texture description'), { target: { value: 'Weathered basalt' } })
    await waitFor(() => expect(screen.getByTestId('texture-generation-help')).toHaveTextContent('Sign in to Codex locally'))
    expect(screen.getByRole('button', { name: 'Generate source texture' })).toBeDisabled()
    ready = true
    fireEvent.click(screen.getByRole('button', { name: 'Recheck Codex status' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate source texture' })).toBeEnabled())
    expect(screen.getByTestId('texture-generation-help')).toHaveTextContent('Codex subscription')
    expect(fetchMock.mock.calls.some(([input]) => input === '/api/forge')).toBe(false)
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
        return buildJsonResponse({ ok: true, generationConfigured: true })
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

  it('uses the fixed web image model without a model picker or telemetry', async () => {
    window.localStorage.setItem(
      'foundry-web-state-v1',
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
          serverModel: 'codex',
          serverPrompt: 'old openai run',
        },
      }),
    )

    render(<App />)

    expect(screen.queryByTestId('layout-item-model-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mode-tab-button-uv-lab')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mode-tab-button-visualizer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^FORGE/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(1)
    })

    const forgeRequest = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.body ?? '{}'),
    )

    expect(forgeRequest.modelId).toBe('codex')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('telemetry'))).toBe(false)
  })

  it.each(['rate_limit_exceeded', 'quota_exceeded'])('preserves three outputs without retrying a fourth-slot %s error', async (errorCode) => {
    window.localStorage.setItem('foundry-web-state-v1', JSON.stringify({
      settings: { activeMode: 'armory', generationCount: 4, prompt: 'weathered sword' },
    }))
    const fallbackFetch = fetchMock.getMockImplementation()!
    const pending: Array<() => void> = []
    let requestCount = 0
    fetchMock.mockImplementation(async (input, init) => {
      if (input !== '/api/forge') return fallbackFetch(input, init)
      const requestNumber = ++requestCount
      const body = JSON.parse(String(init?.body))
      expect(body.generationCount).toBe(1)
      await new Promise<void>((resolve) => pending.push(resolve))
      if (requestNumber === 4) {
        return buildJsonResponse({ error: {
          code: errorCode, title: 'Rate limited', message: 'Please retry this slot.',
          retryAfterSeconds: 1,
        } }, false)
      }
      return buildJsonResponse({
        images: [{ data: imageBase64, id: `texture-${requestNumber}`, mimeType: 'image/png' }],
        model: body.modelId, prompt: body.prompt,
      })
    })
    render(<App />)
    const forgeButton = await screen.findByRole('button', { name: /^FORGE/i })
    await waitFor(() => expect(forgeButton).toBeEnabled())
    fireEvent.click(forgeButton)
    for (let index = 1; index <= 4; index++) {
      await waitFor(() => expect(requestCount).toBe(index))
      pending.shift()!()
    }
    expect(await screen.findByText(/3 of 4 candidate outputs completed/i)).toBeInTheDocument()
    expect(requestCount).toBe(4)
  })

  it('keeps a failed standard slot visible without automatically retrying', async () => {
    let forgeRequestCount = 0

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true, generationConfigured: true })
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
          model: 'codex',
          prompt: 'hero sword',
        })
      }

      return buildJsonResponse({})
    })

    render(<App />)

    fireEvent.change(screen.getByPlaceholderText(/Ornate steel longsword/i), {
      target: {
        value: 'hero sword',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /^2$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^FORGE/i }))

    await waitFor(
      () => {
        expect(fetchMock.mock.calls.filter(([url]) => url === '/api/forge')).toHaveLength(2)
      },
      {
        timeout: 3500,
      },
    )

    expect(await screen.findByText(/1 of 2 candidate outputs completed/i)).toBeInTheDocument()
  })
})

describe('App Texture Lab expansion flow', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : String(input)

      if (url === '/api/health') {
        return buildJsonResponse({ ok: true, generationConfigured: true })
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

  it('keeps expansion controls and exposes source generation and PBR finishing', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))

    expect(await screen.findByText('Expansion Workflow')).toBeInTheDocument()
    expect(screen.getByText(/Expand an existing texture into a larger surface/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Generate$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate Maps/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Generate source texture/i })).toBeDisabled()
    expect(await screen.findByTestId('pbr-workbench')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /EXPAND TEXTURE/i })).toBeDisabled()
  })
  it('keeps source slots separate from expansion, retains partial outputs, and selects a source', async () => {
    installImageUploadMocks()
    const fallbackFetch = fetchMock.getMockImplementation()!
    let count = 0
    const requests: Record<string, unknown>[] = []
    fetchMock.mockImplementation(async (input, init) => {
      if (input !== '/api/forge') return fallbackFetch(input, init)
      requests.push(JSON.parse(String(init?.body)))
      count++
      if (count === 2 || count > 3) return buildJsonResponse({ error: { title: 'Failed', message: 'Source slot failed.' } }, false)
      return buildJsonResponse({ images: [{ id: `source-${count}`, mimeType: 'image/png', data: `candidate${count}` }] })
    })
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))
    fireEvent.change(screen.getByLabelText('Texture description'), { target: { value: 'Basalt' } })
    fireEvent.change(screen.getByLabelText('Variants'), { target: { value: '2' } })
    fireEvent.click(within(screen.getByTestId('texture-source-count')).getByRole('button', { name: '3' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate source texture' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Generate source texture' }))
    expect(await screen.findByText(/2 of 3 source textures ready/)).toBeInTheDocument()
    expect(screen.getByText('Source slot failed.')).toBeInTheDocument()
    expect(screen.getByLabelText('Variants')).toHaveValue('2')
    expect(requests).toHaveLength(3)
    requests.forEach(request => expect(request).toMatchObject({ mode: 'texture-lab', generationCount: 1, workflow: 'generate', textureSize: 1024 }))
    fireEvent.click(screen.getByRole('button', { name: 'Use source for expansion and PBR' }))
    await waitFor(() => expect(screen.getByTestId('pbr-workbench')).toHaveAttribute('data-source', 'data:image/png;base64,candidate3'))
    fireEvent.click(screen.getByTestId('mode-tab-button-armory'))
    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))
    expect(screen.getAllByRole('button', { name: /Download source/ })).toHaveLength(2)
    // Failed slots belong to the new batch, while the separately staged source stays available.
    fireEvent.click(screen.getByRole('button', { name: 'Generate source texture' }))
    await waitFor(() => expect(requests).toHaveLength(6))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate source texture' })).toBeEnabled())
    expect(screen.queryAllByRole('button', { name: /Download source/ })).toHaveLength(0)
    expect(screen.getByTestId('pbr-workbench')).toHaveAttribute('data-source', 'data:image/png;base64,candidate3')
  })

  it('replaces a one-source batch with exactly two slots and deletes a selected source', async () => {
    installImageUploadMocks()
    const fallbackFetch = fetchMock.getMockImplementation()!
    const requests: Record<string, unknown>[] = []
    fetchMock.mockImplementation(async (input, init) => {
      if (input !== '/api/forge') return fallbackFetch(input, init)
      requests.push(JSON.parse(String(init?.body)))
      return buildJsonResponse({ images: [{ id: `source-${requests.length}`, mimeType: 'image/png', data: `candidate${requests.length}` }] })
    })
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))
    fireEvent.change(screen.getByLabelText('Texture description'), { target: { value: 'Basalt' } })
    const generate = screen.getByRole('button', { name: 'Generate source texture' })
    const seamless = screen.getByRole('checkbox', { name: 'Seamless Mode for generated sources' })
    expect(seamless).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Seamless Mode$/ })).not.toBeChecked()
    await waitFor(() => expect(generate).toBeEnabled())
    fireEvent.click(generate)
    await screen.findByText(/1 of 1 source textures ready/)
    expect(requests[0]).toMatchObject({ seamlessMode: true, generationCount: 1 })

    fireEvent.click(seamless)
    fireEvent.click(within(screen.getByTestId('texture-source-count')).getByRole('button', { name: '2' }))
    fireEvent.click(generate)
    await screen.findByText(/2 of 2 source textures ready/)
    expect(requests.slice(1)).toEqual([
      expect.objectContaining({ seamlessMode: false, generationCount: 1 }),
      expect.objectContaining({ seamlessMode: false, generationCount: 1 }),
    ])
    expect(screen.getAllByRole('button', { name: /Download source/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Delete source 3' })).not.toBeInTheDocument()
    expect(screen.getByAltText('Generated source texture')).toHaveAttribute('src', 'data:image/png;base64,candidate2')
    fireEvent.click(screen.getAllByRole('button', { name: 'Use source for expansion and PBR' })[0])
    await waitFor(() => expect(screen.getByTestId('pbr-workbench')).toHaveAttribute('data-source', 'data:image/png;base64,candidate2'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete source 1' }))
    expect(screen.getAllByRole('button', { name: /Download source/ })).toHaveLength(1)
    expect(screen.getByTestId('pbr-workbench')).not.toHaveAttribute('data-source')
    expect(screen.getByRole('button', { name: /EXPAND TEXTURE/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete source 1' }))
    expect(screen.queryByRole('button', { name: /Download source/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Source texture slot needs attention')).not.toBeInTheDocument()
  })

  it('runs Variant Forge output slots sequentially and keeps a partial success', async () => {
    installImageUploadMocks()
    const fallbackFetch = fetchMock.getMockImplementation()!
    const requests: Record<string, unknown>[] = []
    let releaseFirst: (() => void) | undefined
    fetchMock.mockImplementation(async (input, init) => {
      if (input !== '/api/forge') return fallbackFetch(input, init)
      requests.push(JSON.parse(String(init?.body)))
      if (requests.length === 1) {
        await new Promise<void>(resolve => { releaseFirst = resolve })
        return buildJsonResponse({ images: [{ id: 'variant-one', mimeType: 'image/png', data: 'variant1' }] })
      }
      return buildJsonResponse({ error: { title: 'Failed', message: 'Variant slot failed.' } }, false)
    })
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-variant-forge'))
    fireEvent.change(screen.getByTestId('layout-item-variant-forge-panel').querySelector('input[type="file"]')!, { target: { files: [buildReferenceFile('base.png')] } })
    fireEvent.click(within(screen.getByTestId('layout-item-batch-panel')).getByRole('button', { name: '2' }))
    const forgeButton = screen.getByRole('button', { name: /FORGE VARIANT/i })
    await waitFor(() => expect(forgeButton).toBeEnabled())
    fireEvent.click(forgeButton)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.getByRole('slider', { name: 'Generation Count' })).toBeDisabled()
    releaseFirst!()
    expect(await screen.findByText(/1 of 2 candidate outputs completed/)).toBeInTheDocument()
    expect(requests).toHaveLength(2)
    requests.forEach(request => expect(request).toMatchObject({ mode: 'variant-forge', generationCount: 1, references: [expect.objectContaining({ name: 'base.png', slot: 'subject' })] }))
    expect(screen.getByText('Variant slot failed.')).toBeInTheDocument()
  })

  it('generates a source texture and sends its expanded result to PBR', async () => {
    installImageUploadMocks()
    const fallbackFetch = fetchMock.getMockImplementation()!
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII='
    const options = validateTextureRequest({ targetSize: 512 })
    const expandedData = 'ZXhwYW5kZWQ='
    fetchMock.mockImplementation(async (input, init) => {
      if (input !== '/api/forge') return fallbackFetch(input, init)
      if (JSON.parse(String(init?.body)).workflow === 'expand-texture') {
        return buildJsonResponse({ images: [{
          id: 'expanded-texture', mimeType: 'image/png', data: expandedData,
          texture: { options, sourceRect: textureGeometry(40, 40, options), generationSize: 1024, exportSize: 512, status: 'expanded', maskMode: 'test', elapsedMs: 1 },
        }] })
      }
      return buildJsonResponse({ images: [{ id: 'source-texture', mimeType: 'image/png', data }], model: 'codex', prompt: 'Weathered basalt' })
    })
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))
    fireEvent.change(screen.getByLabelText('Texture description'), { target: { value: 'Weathered basalt' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Generate source texture/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Generate source texture/i }))
    expect(await screen.findByAltText('Generated source texture')).toHaveAttribute('src', `data:image/png;base64,${data}`)
    const body = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.body))
    expect(body).toMatchObject({ mode: 'texture-lab', workflow: 'generate', modelId: 'codex', prompt: 'Weathered basalt', generationCount: 1 })
    expect(fetchMock.mock.calls.find(([url]) => url === '/api/forge')?.[1]?.headers).toMatchObject({ 'X-Foundry-Request': '1' })
    expect(screen.getByRole('button', { name: /Download source/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /EXPAND TEXTURE/i })).toBeEnabled()
    await waitFor(() => expect(screen.getByTestId('pbr-workbench')).toHaveAttribute('data-source', `data:image/png;base64,${data}`))
    fireEvent.click(screen.getByRole('button', { name: /EXPAND TEXTURE/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use selected texture for PBR' }))
    expect(screen.getByTestId('pbr-workbench')).toHaveAttribute('data-source', `data:image/png;base64,${expandedData}`)
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
        return buildJsonResponse({ ok: true, generationConfigured: true })
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
          model: 'codex',
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

    await waitFor(() => expect(screen.getByRole('button', { name: /Build Recipe/i })).toBeEnabled())
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

  it.each([false, true])('generates four VFX outputs serially and preserves successes when failure=%s', async failOne => {
    const fallbackFetch = fetchMock.getMockImplementation()!
    const pending: Array<() => void> = []
    const requestedKinds: string[] = []
    let active = 0
    let peakActive = 0
    fetchMock.mockImplementation(async (input, init) => {
      if (input !== '/api/forge') return fallbackFetch(input, init)
      const body = JSON.parse(String(init?.body))
      requestedKinds.push(body.textureKind)
      active += 1
      peakActive = Math.max(peakActive, active)
      await new Promise<void>(resolve => pending.push(resolve))
      active -= 1
      if (failOne && body.textureKind === 'noise') return buildJsonResponse({ error: { code: 'invalid_request', message: 'Synthetic noise failure' } }, false)
      return fallbackFetch(input, init)
    })
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))
    fireEvent.click(screen.getByRole('button', { name: /VFX Graph/i }))
    for (const label of ['Dissolve Mask', 'Swirl', 'Noise']) fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(label, 'i') }))
    fireEvent.click(screen.getByRole('button', { name: /GENERATE TEXTURES/i }))
    for (let index = 0; index < 4; index++) {
      await waitFor(() => expect(pending).toHaveLength(index + 1))
      expect(requestedKinds).toHaveLength(index + 1)
      pending[index]()
    }
    await waitFor(() => expect(screen.getByRole('button', { name: /GENERATE TEXTURES/i })).toBeEnabled())
    expect(peakActive).toBe(1)
    expect(new Set(requestedKinds).size).toBe(4)
    await waitFor(() => expect(screen.getByRole('button', { name: /Build Recipe/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Build Recipe/i }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/vfx-recipe')).toHaveLength(1))
    const recipe = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/vfx-recipe')?.[1]?.body))
    expect(recipe.textures).toHaveLength(failOne ? 3 : 4)
    if (failOne) expect(recipe.textures.map((t: { kind: string }) => t.kind)).not.toContain('noise')
  })

  it('exports captured VFX run settings even after controls change', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-vfx-forge'))
    fireEvent.click(screen.getByRole('button', { name: /VFX Graph/i }))
    fireEvent.change(screen.getByPlaceholderText('Ex: Rift Bloom, Ember Ring, Ion Lance'), { target: { value: 'Original Run' } })
    fireEvent.change(screen.getByLabelText('VFX frame count'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERATE TEXTURES/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Build Recipe/i })).toBeEnabled())
    fireEvent.change(screen.getByPlaceholderText('Ex: Rift Bloom, Ember Ring, Ion Lance'), { target: { value: 'Later Controls' } })
    fireEvent.change(screen.getByLabelText('VFX frame count'), { target: { value: '24' } })
    fireEvent.click(screen.getByRole('button', { name: /Particle System/i }))
    fireEvent.click(screen.getByRole('button', { name: /Build Recipe/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Download Bundle/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Download Bundle/i }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/vfx-export')).toHaveLength(1))
    const exported = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/vfx-export')?.[1]?.body))
    expect(exported).toMatchObject({ effectLabel: 'Original Run', frameCount: 12, exportTarget: 'vfx-graph' })
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
        return buildJsonResponse({ ok: true, generationConfigured: true })
      }


      if (url === '/api/action-animator') {
        const body =
          init && typeof init === 'object' && 'body' in init && typeof init.body === 'string'
            ? JSON.parse(init.body)
            : {}

        if (body.pipeline === 'image-strip') {
          return buildJsonResponse({
            artifacts: {
              frames: Array.from({ length: body.frameCount }, (_, index) => ({ data: 'DDDD', id: `frame-${index + 1}`, mimeType: 'image/png' })),
              metadata: {
                fps: 10,
                frameCount: body.frameCount,
                keyColor: 'green',
                normalizedSize: 1080,
                pipeline: 'image-strip',
                prompt: 'Image strip prompt',
                sampleStrategy: 'strip',
                sourceModel: 'codex',
              },
              spriteSheet: {
                data: 'FFFF',
                id: 'sprite-sheet',
                mimeType: 'image/png',
              },
              video: null,
            },
            model: 'codex',
            prompt: 'Image strip prompt',
          })
        }

        throw new Error('Action Animator must submit image-strip requests in the web edition.')
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

  it('has no model picker, video pipeline, or video download controls', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('mode-tab-button-action-animator'))
    await screen.findByTestId('layout-item-action-animator-panel')
    expect(screen.queryByTestId('layout-item-model-selector')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Veo Video|Download Video/i })).not.toBeInTheDocument()
  })

  it('submits keyed grid settings and bundles frames, atlas and timing without video', async () => {
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

    fireEvent.change(frameSlider, {
      target: {
        value: '12',
      },
    })
    fireEvent.change(screen.getByLabelText('Action Animator fps'), {
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
      modelId: 'codex',
      normalizedSize: 512,
      pipeline: 'image-strip',
    })

    await waitFor(() => expect(within(screen.getByTestId('layout-item-action-animator-panel')).getByRole('button', { name: /Download Frames/i })).toBeEnabled())

    fireEvent.click(within(screen.getByTestId('layout-item-action-animator-panel')).getByRole('button', { name: /Download Frames/i }))
    expect(screen.queryByRole('button', { name: /Download Video/i })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledTimes(1)
      expect(downloadBlobMock.mock.calls[0][1]).toBe('foundry-animation-frames.zip')
      expect(downloadDataUrlMock).not.toHaveBeenCalled()
    })
    const zip = await JSZip.loadAsync(downloadBlobMock.mock.calls[0][0])
    expect(Object.keys(zip.files).filter(name => name.startsWith('frames/') && name.endsWith('.png'))).toHaveLength(12)
    expect(zip.file('atlas.png')).not.toBeNull()
    expect(JSON.parse(await zip.file('animation.json')!.async('string'))).toMatchObject({ frameCount: 12, fps: 10, pipeline: 'image-strip' })
  })

  it('submits first and last frame guides with the fixed image-strip model', async () => {
    render(<App />)

    fireEvent.click(screen.getByTestId('mode-tab-button-action-animator'))
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
      modelId: 'codex',
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
        return buildJsonResponse({ ok: true, generationConfigured: true })
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
          'vfx-forge',
          'armory',
          'action-animator',
          'variant-forge',
          'portrait-studio',
          'texture-lab',
          'character-sheet',
        ],
      },
    }

    window.localStorage.setItem(
      'foundry-web-state-v1',
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
        orderedTabs.indexOf('mode-tab-armory'),
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
            primary: ['style-reference', 'vfx-forge-panel'],
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
      'foundry-web-state-v1',
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
      expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-').slice(0, 2)).toEqual([
        'layout-item-style-reference',
        'layout-item-vfx-forge-panel',
      ])
    })

    fireEvent.click(screen.getByTestId('mode-tab-button-texture-lab'))

    expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-')[0]).toBe('layout-item-image-quality')
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
            primary: ['style-reference', 'vfx-forge-panel'],
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
          'vfx-forge',
          'armory',
          'action-animator',
          'variant-forge',
          'portrait-studio',
          'texture-lab',
          'character-sheet',
        ],
      },
    }

    window.localStorage.setItem(
      'foundry-web-state-v1',
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
      expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-').slice(0, 2)).toEqual([
        'layout-item-style-reference',
        'layout-item-vfx-forge-panel',
      ])
    })

    fireEvent.click(screen.getByRole('button', { name: /reset this tab layout/i }))

    await waitFor(() => {
      expect(getOrderedTestIds(screen.getByTestId('control-zone-primary'), 'layout-item-').slice(0, 2)).toEqual([
        'layout-item-image-quality',
        'layout-item-vfx-forge-panel',
      ])
    })

    const tabsContainer = screen.getByTestId('shell-item-mode-tabs').querySelector('nav')

    expect(tabsContainer).not.toBeNull()
    if (!tabsContainer) {
      throw new Error('Expected the mode tabs container to render.')
    }

    let orderedTabs = getOrderedTestIds(tabsContainer, 'mode-tab-', 'mode-tab-handle-')
    expect(orderedTabs.indexOf('mode-tab-vfx-forge')).toBeLessThan(
      orderedTabs.indexOf('mode-tab-armory'),
    )

    fireEvent.click(screen.getByRole('button', { name: /reset all layouts/i }))

    await waitFor(() => {
      orderedTabs = getOrderedTestIds(tabsContainer, 'mode-tab-', 'mode-tab-handle-')
      expect(orderedTabs.filter(id => !id.startsWith('mode-tab-button-'))).toEqual(getDefaultUiLayout().global.modeTabs.map(mode => `mode-tab-${mode}`))
    })
  })
})
