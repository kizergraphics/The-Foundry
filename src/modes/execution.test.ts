import { afterEach, describe, expect, it, vi } from 'vitest'

import { postForgeRequest } from './execution'

describe('postForgeRequest', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects stalled forge slot requests with a timeout error payload', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(() => {
            // Simulate a provider request that never resolves.
          }),
      ),
    )

    const request = postForgeRequest(
      {
        generationCount: 1,
        mode: 'armory',
        modelId: 'gemini-3-flash',
        prompt: 'hero sword',
      },
      {
        timeoutMs: 1000,
      },
    )
    const assertion = expect(request).rejects.toMatchObject({
      code: 'request_timeout',
      title: 'Output Slot Timed Out',
    })

    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })
})
