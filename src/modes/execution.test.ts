import { afterEach, describe, expect, it, vi } from 'vitest'

import { postForgeRequest, runForgeBatch } from './execution'

describe('runForgeBatch', () => {
  it.each(['texture-lab', 'variant-forge', 'armory'] as const)('queues four %s slots sequentially and preserves output order', async (mode) => {
    const releases = new Map<number, () => void>()
    const started: number[] = []
    let active = 0
    let peak = 0
    const batch = runForgeBatch(mode, 4, async (slot) => {
      started.push(slot)
      peak = Math.max(peak, ++active)
      await new Promise<void>((resolve) => releases.set(slot, resolve))
      active--
      return `output-${slot}`
    })
    expect(started).toEqual([0])
    releases.get(0)!()
    await vi.waitFor(() => expect(started).toEqual([0, 1]))
    releases.get(1)!()
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
    releases.get(2)!()
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]))
    releases.get(3)!()
    await expect(batch).resolves.toEqual(['output-0', 'output-1', 'output-2', 'output-3'])
    expect(peak).toBe(1)
  })
})

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
