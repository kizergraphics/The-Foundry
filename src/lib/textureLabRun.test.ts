import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { expansionTasks, useTextureLabRun } from './textureLabRun'
import type { TextureRequest } from './textureLabRun'
import type { ForgeResult } from './forge'
import {
  textureDefaults,
  validateTextureRequest,
  textureGeometry,
} from '../../shared/textureLab.js'
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../modes/execution', async () => ({
  ...(await vi.importActual('../modes/execution')),
  postForgeRequest: post,
}))
const request: TextureRequest = {
  mode: 'texture-lab',
  workflow: 'expand-texture',
  textureExpansion: {
    ...textureDefaults,
    targetSize: 512,
    factor: 4,
    seamlessMode: true,
    variants: 2,
    sourceImage: { data: 'abc', mimeType: 'image/png' },
  },
}
function result(
  id: string,
  status: 'unfinished' | 'finished' = 'unfinished',
): ForgeResult {
  const options = validateTextureRequest(request.textureExpansion)
  return {
    id,
    dataUrl: 'data:image/png;base64,YWJj',
    mimeType: 'image/png',
    texture: {
      options,
      sourceRect: textureGeometry(40, 40, options),
      generationSize: 1024,
      exportSize: 512,
      status,
      maskMode: 'test',
      elapsedMs: 1,
    },
  }
}
describe('texture operation scheduling', () => {
  it('runs variants sequentially, retains expanded output before finishing, and retries only the failing operation', async () => {
    const publish = vi.fn(),
      send = vi.fn(async () => result('candidate'))
    const tasks = expansionTasks(request, publish, send)
    expect(tasks).toHaveLength(6)
    await tasks.shift()!.run()
    expect(publish).not.toHaveBeenCalled()
    await tasks.shift()!.run()
    expect(publish).toHaveBeenCalledTimes(1)
    send.mockRejectedValueOnce(new Error('finish failed'))
    await expect(tasks[0].run()).rejects.toThrow('finish failed')
    await tasks.shift()!.run()
    expect(
      send.mock.calls.map(
        (call) =>
          (call as unknown as [TextureRequest])[0]?.textureExpansion.operation,
      ),
    ).toEqual(['expand', 'expand', 'finish', 'finish'])
    expect(publish).toHaveBeenCalledTimes(2)
    for (const task of tasks) await task.run()
    expect(send).toHaveBeenCalledTimes(7)
  })
  it('cancels between stages and resumes from the checkpoint', async () => {
    let release: (value: unknown) => void = () => {}
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const publish = vi.fn(),
      { result: hook } = renderHook(() => useTextureLabRun(publish))
    let running: Promise<void>
    act(() => {
      running = hook.current.start({
        ...request,
        textureExpansion: {
          ...request.textureExpansion,
          variants: 1,
          seamlessMode: false,
        },
      })
    })
    act(() => hook.current.cancel())
    const first = result('first')
    await act(async () => {
      release({ ok: true, payload: { images: [{ ...first, data: 'YWJj' }] } })
      await running
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(hook.current.pending).toBe(true)
    expect(publish).not.toHaveBeenCalled()
    post.mockResolvedValueOnce({
      ok: true,
      payload: { images: [{ ...result('second'), data: 'YWJj' }] },
    })
    await act(() => hook.current.resume())
    expect(post).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(hook.current.pending).toBe(false)
  })
})
