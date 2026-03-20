import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    fetchMock.mockReset()
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
