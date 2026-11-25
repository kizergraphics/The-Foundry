import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildActionAnimatorPrompt, generateActionAnimator, getActionAnimatorAtlasPreviewFrames, getActionAnimatorPreviewPosition, type ActionAnimatorArtifacts } from './actionAnimator'
import type { ActionAnimatorState } from './forge'

const baseState: ActionAnimatorState = {
  actionType: 'walk',
  characterImage: null,
  customActionPrompt: '',
  fps: 8,
  frameCount: 8,
  firstFrameGuide: null,
  keyColor: 'green',
  lastFrameGuide: null,
  normalizedSize: 512,
  pipeline: 'image-strip',
}

it('uses responsive CSS atlas offsets and falls back for absent or out-of-bounds rectangles', () => {
  const spriteSheet = { dataUrl: 'data:image/png;base64,AAAA', id: 'atlas', mimeType: 'image/png' }
  const artifacts: ActionAnimatorArtifacts = {
    spriteSheet,
    frames: [spriteSheet, spriteSheet],
    metadata: {
      ...baseState, frameCount: 2, prompt: '', sampleStrategy: 'strip', sourceModel: '',
      atlas: { width: 512, height: 384, columns: 4, rows: 3, frames: [
        { x: 0, y: 0, width: 128, height: 128, file: 'first.png', timeSeconds: 0 },
        { x: 128, y: 256, width: 128, height: 128, file: 'second.png', timeSeconds: 1 / 8 },
      ] },
    },
  }
  expect(getActionAnimatorAtlasPreviewFrames(artifacts)).toEqual([
    { backgroundSize: '400% 300%', backgroundPosition: '0% 0%' },
    { backgroundSize: '400% 300%', backgroundPosition: '33.333333333333336% 100%' },
  ])
  artifacts.metadata.atlas!.frames[1].x = 500
  expect(getActionAnimatorAtlasPreviewFrames(artifacts)).toBeNull()
  delete artifacts.metadata.atlas
  expect(getActionAnimatorAtlasPreviewFrames(artifacts)).toBeNull()
})

it('skips late frames, wraps to zero, and resumes from the saved playhead phase', () => {
  expect(getActionAnimatorPreviewPosition(0, 1000, 12, 16)).toBe(12)
  expect(getActionAnimatorPreviewPosition(12, 500, 12, 16)).toBe(2)
  expect(getActionAnimatorPreviewPosition(15.5, 62.5, 8, 16)).toBe(0)
  expect(getActionAnimatorPreviewPosition(4, 0, 12, 16)).toBe(4)
})

describe('action animator prompt helpers', () => {
  it('describes the image strip chroma background', () => {
    expect(buildActionAnimatorPrompt(baseState)).toContain(
      'Use a flat #00FF00 green chroma background',
    )
  })

  it('includes custom direction for preset actions', () => {
    expect(
      buildActionAnimatorPrompt({
        ...baseState,
        customActionPrompt: 'Add heavier footfalls and a slight shoulder dip.',
      }),
    ).toContain('Additional direction: Add heavier footfalls and a slight shoulder dip.')
  })

  it('describes the image-strip flow when selected', () => {
    expect(
      buildActionAnimatorPrompt({
        ...baseState,
        pipeline: 'image-strip',
      }),
    ).toContain('exactly 4 columns by 2 rows of equal-sized rectangular cells')
  })
})

const stateWithImage: ActionAnimatorState = {
  ...baseState,
  frameCount: 4,
  characterImage: { file: new File(['image'], 'hero.png', { type: 'image/png' }), mimeType: 'image/png', name: 'hero.png', sizeLabel: '5 B' },
}
const asset = (id: string) => ({ id, data: 'aW1hZ2U=', mimeType: 'image/png' })
const run = (state = stateWithImage, signal?: AbortSignal) => generateActionAnimator({ state, modelId: 'codex', quality: 'high', signal })
afterEach(() => vi.unstubAllGlobals())
describe('Action Animator request validation', () => {
  it('preserves frame order, image quality and cancellation signal', async () => {
    const frames = [asset('four'), asset('two'), asset('one'), asset('three')]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: { spriteSheet: asset('sheet'), frames } }) })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const result = await run(stateWithImage, controller.signal)
    expect(result.artifacts.frames.map(frame => frame.id)).toEqual(['four', 'two', 'one', 'three'])
    const request = fetchMock.mock.calls[0][1]
    expect(request.signal).toBe(controller.signal)
    expect(JSON.parse(request.body)).toMatchObject({ quality: 'high', pipeline: 'image-strip', frameCount: 4 })
    expect(result.artifacts).not.toHaveProperty('video')
  })
  it('rejects partial frame responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: { spriteSheet: asset('sheet'), frames: [asset('one')] } }) }))
    await expect(run()).rejects.toThrow('expected 4')
  })
  it('does not issue a request for invalid ranges or pre-cancelled work', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(run({ ...stateWithImage, fps: NaN })).rejects.toThrow('FPS')
    await expect(run({ ...stateWithImage, frameCount: 2 })).rejects.toThrow('frame count')
    const controller = new AbortController()
    controller.abort()
    await expect(run(stateWithImage, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reports non-JSON failures clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('invalid JSON') } }))
    await expect(run()).rejects.toThrow('HTTP 502')
  })
})
