import { proxy, wrap } from 'comlink'
import type { BufferAttribute, BufferGeometry, TypedArray } from 'three'

export type ChartOptions = {
  fixWinding?: boolean
  maxBoundaryLength?: number
  maxChartArea?: number
  maxCost?: number
  maxIterations?: number
  normalDeviationWeight?: number
  normalSeamWeight?: number
  roundnessWeight?: number
  straightnessWeight?: number
  textureSeamWeight?: number
  useInputMeshUvs?: boolean
}

export type PackOptions = {
  bilinear?: boolean
  blockAlign?: boolean
  bruteForce?: boolean
  createImage?: boolean
  maxChartSize?: number
  padding?: number
  resolution?: number
  rotateCharts?: boolean
  rotateChartsToAxis?: boolean
  texelsPerUnit?: number
}

type WorkerMode = 'classic' | 'module'
type TypedArrayConstructor = new (length: number) => TypedArray
type XAtlasSubMesh = {
  atlasIndex: number
  count: number
  index: number
}
type XAtlasMeshResult = {
  index?: TypedArray
  mesh: string
  oldIndexes: TypedArray
  subMeshes?: XAtlasSubMesh[]
  vertex: {
    coords?: TypedArray
    coords1?: TypedArray
    normals?: TypedArray
    vertices: TypedArray
  }
}
type XAtlasApi = {
  loaded: boolean
  addMesh: (
    indexes: ArrayLike<number>,
    positions: ArrayLike<number>,
    normals?: ArrayLike<number>,
    uvs?: ArrayLike<number>,
    meshId?: string,
    useNormals?: boolean,
    useUvs?: boolean,
    scale?: number | [number, number, number],
  ) => Promise<unknown>
  createAtlas: () => Promise<void>
  destroyAtlas: () => Promise<void>
  generateAtlas: (
    chartOptions: ChartOptions,
    packOptions: PackOptions,
    includeAtlas: boolean,
  ) => Promise<{
    atlasCount: number
    height: number
    meshCount: number
    meshes: XAtlasMeshResult[]
    texelsPerUnit: number
    width: number
  }>
  setProgressLogging: (enabled: boolean) => Promise<void>
}
type XAtlasWorkerFactory = new (
  onLoad: () => void,
  locateFile: (path: string, dir: string) => string,
  onProgress: (mode: unknown, progress: unknown) => void,
) => Promise<XAtlasApi>

export type Atlas = {
  atlasCount: number
  geometries: BufferGeometry[]
  height: number
  meshCount: number
  meshes: XAtlasMeshResult[]
  texelsPerUnit: number
  width: number
}

export class PatchedUvUnwrapper {
  public chartOptions: ChartOptions
  public logProgress: boolean
  public packOptions: PackOptions
  public timeUnwrap: boolean
  public THREE: {
    BufferAttribute: typeof BufferAttribute
  }
  public useNormals: boolean

  private api: XAtlasApi | null = null
  private isUnwrapping = false
  private libraryLoaded = false

  constructor(
    THREE: {
      BufferAttribute: typeof BufferAttribute
    },
    packOptions: PackOptions = {
      resolution: 2048,
    },
    chartOptions: ChartOptions = {},
    useNormals = false,
    timeUnwrap = false,
    logProgress = false,
  ) {
    this.THREE = THREE
    this.chartOptions = chartOptions
    this.logProgress = logProgress
    this.packOptions = packOptions
    this.timeUnwrap = timeUnwrap
    this.useNormals = useNormals
  }

  async loadLibrary(
    onProgress: (mode: unknown, progress: unknown) => void,
    wasmFilePath: string,
    workerFilePath?: string,
  ): Promise<void> {
    if (this.libraryLoaded) {
      return
    }

    if (!workerFilePath) {
      throw new Error('xatlas workerFilePath is required.')
    }

    await Promise.all([
      validateRuntimeAsset(wasmFilePath, 'WASM'),
      validateRuntimeAsset(workerFilePath, 'worker script'),
    ])

    const startupErrors: string[] = []

    for (const mode of ['classic', 'module'] as const) {
      try {
        const { api } = await this.startWorker(mode, onProgress, wasmFilePath, workerFilePath)
        this.api = api
        this.libraryLoaded = true
        return
      } catch (error) {
        startupErrors.push(`${mode}: ${getErrorMessage(error)}`)
      }
    }

    throw new Error(
      `Failed to start the xatlas worker. ${startupErrors.join(' ')}`.trim(),
    )
  }

  async packAtlas(
    nodeList: BufferGeometry[],
    outputUv: 'uv' | 'uv2' = 'uv2',
    inputUv: 'uv' | 'uv2' = 'uv',
  ): Promise<Atlas> {
    if (!this.libraryLoaded || !this.api) {
      throw new Error('xatlas runtime is not loaded.')
    }

    if (!nodeList) {
      throw new Error('xatlas nodeList argument not provided.')
    }

    if (nodeList.length < 1) {
      throw new Error('xatlas nodeList must have non-zero length.')
    }

    const useUvs = this.chartOptions.useInputMeshUvs

    while (this.isUnwrapping) {
      console.log('xatlas: unwrapping another mesh, waiting 100 ms')
      await sleep(100)
    }

    this.isUnwrapping = true

    try {
      await this.api.setProgressLogging(this.logProgress)
      await this.api.createAtlas()

      const meshAdded: string[] = []
      let tag = ''

      for (const mesh of nodeList) {
        const { uuid, index, attributes } = mesh
        const scaled = mesh.userData.worldScale || 1

        meshAdded.push(uuid)
        if (!index || !attributes.position || attributes.position.itemSize !== 3) {
          console.warn('xatlas: geometry not supported:', mesh)
          continue
        }

        tag = `Mesh${meshAdded.length} added to atlas: ${uuid}`
        if (this.timeUnwrap) {
          console.time(tag)
        }

        await this.api.addMesh(
          index.array,
          (attributes.position as BufferAttribute).array,
          attributes.normal ? (attributes.normal as BufferAttribute).array : undefined,
          attributes.uv ? (attributes.uv as BufferAttribute).array : undefined,
          uuid,
          this.useNormals,
          useUvs,
          scaled,
        )

        if (this.timeUnwrap) {
          console.timeEnd(tag)
        }
      }

      tag = `Generated atlas with ${meshAdded.length} meshes`
      if (this.timeUnwrap) {
        console.time(tag)
      }
      const atlas = await this.api.generateAtlas(this.chartOptions, this.packOptions, true)
      if (this.timeUnwrap) {
        console.timeEnd(tag)
      }

      const geometries: BufferGeometry[] = []

      for (const result of atlas.meshes) {
        const mesh = nodeList.find((candidate) => candidate.uuid === result.mesh)
        if (!mesh) {
          console.error('xatlas: geometry not found:', result.mesh)
          continue
        }

        if (result.vertex.vertices) {
          mesh.setAttribute(
            'position',
            new this.THREE.BufferAttribute(result.vertex.vertices, 3, false),
          )
        }
        if (result.vertex.normals) {
          mesh.setAttribute(
            'normal',
            new this.THREE.BufferAttribute(result.vertex.normals, 3, true),
          )
        }
        if (result.vertex.coords1) {
          mesh.setAttribute(
            outputUv,
            new this.THREE.BufferAttribute(result.vertex.coords1, 2, false),
          )
        }
        if (result.vertex.coords && outputUv !== inputUv) {
          mesh.setAttribute(
            inputUv,
            new this.THREE.BufferAttribute(result.vertex.coords, 2, false),
          )
        }
        if (result.index) {
          mesh.setIndex(new this.THREE.BufferAttribute(result.index, 1, false))
        }
        if (result.subMeshes) {
          mesh.userData.xAtlasSubMeshes = structuredClone(result.subMeshes)
        }

        const oldIndexes = result.oldIndexes
        const attributes = mesh.attributes
        for (const key in attributes) {
          if (key === 'position' || key === 'normal' || key === outputUv || key === inputUv) {
            continue
          }

          const oldAttribute = attributes[key] as BufferAttribute
          const bufferConstructor = oldAttribute.array.constructor as TypedArrayConstructor
          const itemSize = oldAttribute.itemSize
          const oldArray = oldAttribute.array
          const newArray = new bufferConstructor(oldIndexes.length * itemSize)
          const newAttribute = new this.THREE.BufferAttribute(
            newArray,
            itemSize,
            oldAttribute.normalized,
          )

          newAttribute.gpuType = oldAttribute.gpuType

          for (let attributeIndex = 0; attributeIndex < oldIndexes.length; attributeIndex += 1) {
            const oldIndex = Number(oldIndexes[attributeIndex])
            for (let componentIndex = 0; componentIndex < itemSize; componentIndex += 1) {
              newArray[attributeIndex * itemSize + componentIndex] =
                oldArray[oldIndex * itemSize + componentIndex]
            }
          }

          mesh.setAttribute(key, newAttribute)
        }

        geometries.push(mesh)
      }

      await this.api.destroyAtlas()

      return {
        atlasCount: atlas.atlasCount,
        geometries,
        height: atlas.height,
        meshCount: atlas.meshCount,
        meshes: atlas.meshes,
        texelsPerUnit: atlas.texelsPerUnit,
        width: atlas.width,
      }
    } finally {
      this.isUnwrapping = false
    }
  }

  private async startWorker(
    mode: WorkerMode,
    onProgress: (mode: unknown, progress: unknown) => void,
    wasmFilePath: string,
    workerFilePath: string,
  ) {
    const workerResponse = await fetch(workerFilePath, {
      credentials: 'same-origin',
    })

    if (!workerResponse.ok) {
      throw new Error(
        `Unable to fetch the xatlas worker script (${workerResponse.status}) from ${workerFilePath}.`,
      )
    }

    const workerContentType = workerResponse.headers.get('content-type')?.toLowerCase() ?? ''
    if (workerContentType.includes('text/html')) {
      throw new Error(
        `Received HTML instead of JavaScript for the xatlas worker script at ${workerFilePath}.`,
      )
    }

    const workerBlobUrl = URL.createObjectURL(await workerResponse.blob())
    let worker: Worker | null = null

    try {
      worker =
        mode === 'module'
          ? new Worker(workerBlobUrl, { name: 'xatlas-worker', type: 'module' })
          : new Worker(workerBlobUrl, { name: 'xatlas-worker' })

      const workerApiFactory = wrap(worker) as unknown as XAtlasWorkerFactory
      let settled = false
      let resolveStartup: (() => void) | null = null
      let rejectStartup: ((message: string, cause?: unknown) => void) | null = null
      const startupPromise = new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          worker?.removeEventListener('error', handleWorkerError)
          worker?.removeEventListener('messageerror', handleMessageError)
        }

        rejectStartup = (message: string, cause?: unknown) => {
          if (settled) {
            return
          }

          settled = true
          cleanup()
          reject(new Error(cause ? `${message} ${getErrorMessage(cause)}` : message))
        }

        resolveStartup = () => {
          if (settled) {
            return
          }

          settled = true
          cleanup()
          resolve()
        }

        const handleWorkerError = (event: ErrorEvent) => {
          rejectStartup?.(
            `The xatlas worker failed while starting in ${mode} mode.${
              event.message ? ` ${event.message}` : ''
            }`,
            event.error,
          )
        }

        const handleMessageError = () => {
          rejectStartup?.(`The xatlas worker emitted a messageerror in ${mode} mode.`)
        }

        worker?.addEventListener('error', handleWorkerError)
        worker?.addEventListener('messageerror', handleMessageError)
      })

      const apiPromise = new workerApiFactory(
        proxy(() => {
          resolveStartup?.()
        }),
        proxy((path: string, dir: string) => {
          if (path === 'xatlas.wasm') {
            return wasmFilePath
          }

          return `${dir}${path}`
        }),
        proxy((progressMode: unknown, progress: unknown) => {
          onProgress(progressMode, progress)
        }),
      )

      void apiPromise.catch((error) => {
        rejectStartup?.(`Failed to construct the xatlas worker API in ${mode} mode.`, error)
      })

      await startupPromise
      const api = await apiPromise

      while (!(await api.loaded)) {
        await sleep(100)
      }

      return {
        api,
        worker,
      }
    } catch (error) {
      worker?.terminate()
      throw error
    } finally {
      URL.revokeObjectURL(workerBlobUrl)
    }
  }
}

async function validateRuntimeAsset(url: string, label: string) {
  const response = await fetch(url, {
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch the xatlas ${label} (${response.status}) from ${url}.`)
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('text/html')) {
    throw new Error(`Received HTML instead of the xatlas ${label} from ${url}.`)
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function sleep(durationMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
