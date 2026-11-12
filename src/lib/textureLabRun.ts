import { useRef, useState } from 'react'
import type { ForgeResult } from './forge'
import type { TextureOptions, TextureRect } from '../../shared/textureLab.js'
import { normalizeForgeApiResults, postForgeRequest } from '../modes/execution'
import { parseBase64DataUrl } from './browser'
export type TextureRequest = Record<string, unknown> & {
  textureExpansion: Partial<TextureOptions> & {
    sourceImage: { data: string; mimeType: string }
    baseImage?: { data: string; mimeType: string }
  }
}
export type TextureTask = { label: string; run: () => Promise<void> }
function inline(result: ForgeResult) {
  const p = parseBase64DataUrl(result.dataUrl)
  return { data: p.base64, mimeType: p.mimeType }
}
export async function requestTexture(
  request: TextureRequest,
): Promise<ForgeResult> {
  const { ok, payload } = await postForgeRequest(request)
  if (!ok || !payload?.images?.length)
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : (payload?.error?.message ?? 'Texture operation failed.'),
    )
  const result = normalizeForgeApiResults(payload)[0]
  if (!result.texture)
    throw new Error('The server did not return texture processing metadata.')
  return result
}
export function expansionTasks(
  request: TextureRequest,
  publish: (result: ForgeResult, request: TextureRequest) => void,
  send = requestTexture,
): TextureTask[] {
  const tasks: TextureTask[] = []
  for (let v = 0; v < (request.textureExpansion.variants ?? 1); v++) {
    const variant = {
      ...request,
      textureExpansion: {
        ...request.textureExpansion,
        seed: (Date.now() + v) >>> 0,
      },
    }
    let current: ForgeResult
    const stages = variant.textureExpansion.factor === 4 ? 2 : 1
    for (let stage = 1; stage <= stages; stage++)
      tasks.push({
        label: `Variant ${v + 1}: expansion ${stage}/${stages}`,
        run: async () => {
          current = await send({
            ...variant,
            textureExpansion: {
              ...variant.textureExpansion,
              operation: 'expand',
              stage: stage as 1 | 2,
              ...(stage === 2 ? { baseImage: inline(current) } : {}),
            },
          })
          if (stage === stages) publish(current, variant)
        },
      })
    if (variant.textureExpansion.seamlessMode)
      tasks.push({
        label: `Variant ${v + 1}: seamless finishing`,
        run: async () => {
          const finished = await send({
            ...variant,
            textureExpansion: {
              ...variant.textureExpansion,
              operation: 'finish',
              baseImage: inline(current),
            },
          })
          current = { ...finished, id: current.id }
          publish(current, variant)
        },
      })
  }
  return tasks
}
export function useTextureLabRun(onCandidate: (result: ForgeResult) => void) {
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const queue = useRef<TextureTask[]>([]),
    stop = useRef(false),
    running = useRef(false)
  const requests = useRef(new Map<string, TextureRequest>())
  function publish(result: ForgeResult, request: TextureRequest) {
    requests.current.set(result.id, request)
    onCandidate(result)
  }
  async function drain() {
    if (running.current) return
    running.current = true
    stop.current = false
    setBusy(true)
    setError('')
    try {
      while (queue.current.length && !stop.current) {
        const task = queue.current[0]
        setProgress(task.label)
        await task.run()
        queue.current.shift()
      }
      setProgress(
        queue.current.length
          ? 'Stopped between operations. Completed candidates are retained.'
          : 'Texture operations complete.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      running.current = false
      setBusy(false)
      setPending(queue.current.length > 0)
    }
  }
  async function start(request: TextureRequest) {
    if (running.current) return
    queue.current = expansionTasks(request, publish)
    await drain()
  }
  async function edit(result: ForgeResult, region?: TextureRect) {
    if (running.current) return
    const request = requests.current.get(result.id)
    if (!request || !result.texture) {
      setError('Re-run this texture to restore its source editing context.')
      return
    }
    let current = result
    queue.current = [
      {
        label: region
          ? 'Regenerating selected region'
          : 'Retrying seamless finish',
        run: async () => {
          current = await requestTexture({
            ...request,
            textureExpansion: {
              ...request.textureExpansion,
              operation: region ? 'region' : 'finish',
              baseImage: inline(result),
              region,
              seed: Date.now() >>> 0,
            },
          })
          if (!region) current = { ...current, id: result.id }
          if (region && result.texture?.status === 'finished') {
            const b = result.texture.sourceRect.seamBand / 2,
              n = result.texture.exportSize
            if (
              region.x >= b &&
              region.y >= b &&
              region.x + region.width <= n - b &&
              region.y + region.height <= n - b
            )
              current.texture = { ...current.texture!, status: 'finished' }
          }
          publish(current, request)
        },
      },
    ]
    if (region && request.textureExpansion.seamlessMode)
      queue.current.push({
        label: 'Finishing edited edge region',
        run: async () => {
          if (current.texture?.status === 'finished') return
          const finished = await requestTexture({
            ...request,
            textureExpansion: {
              ...request.textureExpansion,
              operation: 'finish',
              baseImage: inline(current),
            },
          })
          current = { ...finished, id: current.id }
          publish(current, request)
        },
      })
    await drain()
  }
  return {
    busy,
    progress,
    error,
    pending,
    start,
    edit,
    resume: drain,
    discard: () => {
      if (running.current) return
      queue.current = []
      setPending(false)
      setError('')
      setProgress(
        'Remaining operations discarded. Completed candidates are retained.',
      )
    },
    cancel: () => {
      stop.current = true
      setProgress('Stopping after the current operation…')
    },
  }
}
