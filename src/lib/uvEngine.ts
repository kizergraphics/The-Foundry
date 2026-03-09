import type { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { PatchedUvUnwrapper } from './patchedUvUnwrapper'
import {
  BufferAttribute,
  Color,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
  Vector3,
} from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { ModelAsset } from './forge'
import { getModelAnimationClips, loadModelObject, validateStaticModelObject } from './modelScene'
import type {
  UvArtifactManifest,
  UvJobArtifact,
  UvJobStatusResponse,
  UvJobStep,
} from './uvLab'

type AssimpConvert = typeof import('@sruim/mesh-flow').convert
type ReadableIndexAttribute = Pick<BufferAttribute, 'count' | 'getX'>
type ReadableUvAttribute = Pick<BufferAttribute, 'getX' | 'getY'>
type UvProgressCallback = (step: UvJobStep, detail?: string | null) => void
type UvRuntime = {
  convert: AssimpConvert
  unwrapper: PatchedUvUnwrapper
}
type UvRuntimeProgressState = {
  detail: string | null
  step: UvJobStep
}

const atlasBackground = '#0b1120'
const atlasStroke = '#e5e7eb'
const browserEngineId = 'browser-uv-engine'
const runtimeBootstrapTimeoutMs = 45000
const meshLoadTimeoutMs = 20000
const scenePrepTimeoutMs = 10000
const unwrapTimeoutMs = 60000
const exportTimeoutMs = 30000
const artifactTimeoutMs = 5000
let gltfExporterPromise: Promise<GLTFExporter> | null = null
let uvRuntimePromise: Promise<UvRuntime> | null = null
let uvRuntimeProgressState: UvRuntimeProgressState | null = null
const uvRuntimeProgressListeners = new Set<UvProgressCallback>()

export async function primeUvEngine(onProgress?: UvProgressCallback) {
  await getUvRuntime(onProgress)
}

export function getBrowserUvEngineId() {
  return browserEngineId
}

export async function runLocalUvJob({
  asset,
  atlasSize,
  paddingPx,
  onProgress,
}: {
  asset: ModelAsset
  atlasSize: number
  onProgress?: UvProgressCallback
  paddingPx: number
}): Promise<UvJobStatusResponse> {
  const runtime = await runUvStage({
    detail: 'Loading xatlas and the local mesh converter.',
    onProgress,
    step: 'importing',
    timeoutMs: runtimeBootstrapTimeoutMs,
    work: () => getUvRuntime(onProgress),
  })
  const sourceObject = await runUvStage({
    detail: `Parsing ${asset.format.toUpperCase()} mesh data.`,
    onProgress,
    step: 'importing',
    timeoutMs: meshLoadTimeoutMs,
    work: () => loadModelObject(asset),
  })
  reportUvProgress(onProgress, 'importing', 'Validating mesh content for static unwrap.')
  validateStaticModelObject(sourceObject)

  const preparedScene = await runUvStage({
    detail: 'Preparing a static export scene for unwrap.',
    onProgress,
    step: 'importing',
    timeoutMs: scenePrepTimeoutMs,
    work: () => Promise.resolve(buildExportScene(sourceObject)),
  })

  if (!preparedScene.meshes.length) {
    throw new Error('The selected file did not contain any static mesh geometry to unwrap.')
  }

  runtime.unwrapper.logProgress = true
  runtime.unwrapper.packOptions = {
    ...runtime.unwrapper.packOptions,
    padding: Math.max(0, Math.round(paddingPx)),
    resolution: atlasSize,
    rotateCharts: true,
    rotateChartsToAxis: true,
  }
  runtime.unwrapper.chartOptions = {
    ...runtime.unwrapper.chartOptions,
    fixWinding: true,
    useInputMeshUvs: false,
  }

  await runUvStage({
    detail: 'Generating UV charts with xatlas.',
    onProgress,
    step: 'unwrapping',
    timeoutMs: unwrapTimeoutMs,
    work: () =>
      runtime.unwrapper.packAtlas(
        preparedScene.meshes.map((mesh) => mesh.geometry),
        'uv',
        'uv2',
      ),
  })

  const stats = await runUvStage({
    detail: 'Measuring UV coverage and island count.',
    onProgress,
    step: 'packing',
    timeoutMs: artifactTimeoutMs,
    work: () => Promise.resolve(computeUvStats(preparedScene.meshes, atlasSize, asset.format)),
  })
  const atlasBlob = await runUvStage({
    detail: 'Rendering the packed atlas preview.',
    onProgress,
    step: 'packing',
    timeoutMs: exportTimeoutMs,
    work: () => renderUvLayout(preparedScene.meshes, atlasSize),
  })

  const previewBytes = await runUvStage({
    detail: 'Exporting GLB preview.',
    onProgress,
    step: 'exporting',
    timeoutMs: exportTimeoutMs,
    work: () => exportSceneToGlb(preparedScene.scene),
  })
  const meshBytes = await runUvStage({
    detail: `Converting the processed preview back to ${asset.format.toUpperCase()}.`,
    onProgress,
    step: 'exporting',
    timeoutMs: exportTimeoutMs,
    work: () =>
      runtime.convert(
        {
          data: previewBytes,
          name: `${stripExtension(asset.name)}.glb`,
        },
        asset.format,
        {
          binary: asset.format === 'fbx',
          name: stripExtension(asset.name),
        },
      ),
  })

  const artifacts = await runUvStage({
    detail: 'Creating downloadable UV artifacts.',
    onProgress,
    step: 'exporting',
    timeoutMs: artifactTimeoutMs,
    work: () =>
      Promise.resolve(
        createArtifacts({
          asset,
          atlasBlob,
          meshBytes,
          previewBytes,
        }),
      ),
  })
  reportUvProgress(onProgress, 'complete', 'UV artifacts are ready.')

  return {
    artifacts,
    error: null,
    id: `local-${crypto.randomUUID()}`,
    stats,
    status: 'succeeded',
    step: 'complete',
  }
}

async function getUvRuntime(onProgress?: UvProgressCallback) {
  const detachListener = attachUvRuntimeProgressListener(onProgress)

  if (!uvRuntimePromise) {
    uvRuntimePromise = createUvRuntime().catch((error) => {
      uvRuntimePromise = null
      throw error
    })
  }

  try {
    return await uvRuntimePromise
  } finally {
    detachListener()
  }
}

async function createUvRuntime(): Promise<UvRuntime> {
  emitUvRuntimeProgress('importing', 'Loading UV runtime modules.')
  const [{ createAssimp, convert }, { PatchedUvUnwrapper }] = await withTimeout(
    Promise.all([import('@sruim/mesh-flow'), import('./patchedUvUnwrapper')]),
    runtimeBootstrapTimeoutMs,
    'Timed out while loading the UV runtime modules.',
  )
  const unwrapper = new PatchedUvUnwrapper({ BufferAttribute })
  const xatlasWasmUrl = getUvRuntimeAssetUrl('xatlas.wasm')
  const xatlasWorkerUrl = getUvRuntimeAssetUrl('xatlas.js')

  emitUvRuntimeProgress('importing', 'Starting UV runtime assets.')
  await Promise.all([
    withTimeout(
      createAssimp(),
      runtimeBootstrapTimeoutMs,
      'Timed out while starting the local mesh converter runtime.',
    ),
    withTimeout(
      unwrapper.loadLibrary(
        (mode, progress) => {
          if (typeof mode === 'string' || typeof progress === 'number') {
            emitUvRuntimeProgress(
              'importing',
              `Loading UV engine assets${buildRuntimeProgressSuffix(mode, progress)}`,
            )
          }
        },
        xatlasWasmUrl,
        xatlasWorkerUrl,
      ),
      runtimeBootstrapTimeoutMs,
      'Timed out while starting the xatlas worker.',
    ),
  ])
  emitUvRuntimeProgress('importing', 'UV runtime ready.')

  return {
    convert,
    unwrapper,
  }
}

function getUvRuntimeAssetUrl(assetName: string) {
  const basePath = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`

  return `${window.location.origin}${basePath}wasm/${assetName}`
}

function attachUvRuntimeProgressListener(onProgress?: UvProgressCallback) {
  if (!onProgress) {
    return () => {}
  }

  uvRuntimeProgressListeners.add(onProgress)

  if (uvRuntimeProgressState) {
    onProgress(uvRuntimeProgressState.step, uvRuntimeProgressState.detail)
  }

  return () => {
    uvRuntimeProgressListeners.delete(onProgress)
  }
}

function emitUvRuntimeProgress(step: UvJobStep, detail: string | null) {
  uvRuntimeProgressState = {
    detail,
    step,
  }

  for (const listener of uvRuntimeProgressListeners) {
    listener(step, detail)
  }
}

function reportUvProgress(
  onProgress: UvProgressCallback | undefined,
  step: UvJobStep,
  detail: string,
) {
  onProgress?.(step, detail)
  console.info(`[UV Lab] ${detail}`)
}

async function runUvStage<T>({
  detail,
  onProgress,
  step,
  timeoutMs,
  work,
}: {
  detail: string
  onProgress?: UvProgressCallback
  step: UvJobStep
  timeoutMs: number
  work: () => Promise<T>
}) {
  reportUvProgress(onProgress, step, detail)
  const startedAt = performance.now()

  try {
    const result = await withTimeout(work(), timeoutMs, buildStageTimeoutMessage(detail, timeoutMs))
    console.info(`[UV Lab] Completed ${detail} in ${Math.round(performance.now() - startedAt)}ms`)
    return result
  } catch (error) {
    console.error(`[UV Lab] Failed during stage: ${detail}`, error)
    throw error
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise
      .then((result) => {
        window.clearTimeout(timeoutId)
        resolve(result)
      })
      .catch((error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function buildStageTimeoutMessage(detail: string, timeoutMs: number) {
  return `${detail} timed out after ${Math.round(timeoutMs / 1000)}s. Open the browser console and look for [UV Lab] stage logs to see where processing stopped.`
}

function buildRuntimeProgressSuffix(mode: unknown, progress: unknown) {
  const progressText =
    typeof progress === 'number' && Number.isFinite(progress)
      ? ` ${Math.round(progress * 100)}%`
      : ''
  const modeText =
    typeof mode === 'string' && mode.trim().length > 0 ? ` (${mode})` : ''

  return `${modeText}${progressText}`
}

function buildExportScene(sourceObject: Object3D) {
  const scene = new Scene()
  scene.background = null
  sourceObject.updateMatrixWorld(true)
  const meshes: Mesh[] = []

  sourceObject.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return
    }

    const clonedGeometry = child.geometry.clone()
    const indexedGeometry = clonedGeometry.index ? clonedGeometry : mergeVertices(clonedGeometry)
    const bakedGeometry = indexedGeometry.clone()
    bakedGeometry.applyMatrix4(child.matrixWorld)
    bakedGeometry.computeBoundingBox()
    bakedGeometry.computeBoundingSphere()
    bakedGeometry.deleteAttribute('skinIndex')
    bakedGeometry.deleteAttribute('skinWeight')

    const bakedMesh = new Mesh(
      bakedGeometry,
      cloneMaterial(child.material),
    )
    bakedMesh.name = child.name
    bakedMesh.matrixAutoUpdate = false
    bakedMesh.matrix = new Matrix4()
    bakedMesh.matrixWorld = new Matrix4()
    scene.add(bakedMesh)
    meshes.push(bakedMesh)
  })

  if (meshes.length === 0 && sourceObject instanceof Group && getModelAnimationClips(sourceObject).length === 0) {
    sourceObject.children.forEach((child) => {
      child.updateMatrixWorld(true)
    })
  }

  return {
    meshes,
    scene,
  }
}

function cloneMaterial(material: Material | Material[] | undefined) {
  if (!material) {
    return new MeshStandardMaterial({
      color: new Color('#dce6f5'),
      metalness: 0.08,
      roughness: 0.84,
    })
  }

  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone())
  }

  return material.clone()
}

async function exportSceneToGlb(scene: Scene) {
  const exporter = await getGltfExporter()

  return new Promise<Uint8Array>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result))
          return
        }

        reject(new Error('GLB export returned an unexpected payload type.'))
      },
      (error) => {
        reject(error instanceof Error ? error : new Error('Failed to export GLB preview.'))
      },
      {
        binary: true,
        onlyVisible: true,
        trs: false,
      },
    )
  })
}

async function getGltfExporter() {
  if (!gltfExporterPromise) {
    gltfExporterPromise = import('three/examples/jsm/exporters/GLTFExporter.js').then(
      ({ GLTFExporter }) => new GLTFExporter(),
    )
  }

  return gltfExporterPromise
}

function computeUvStats(meshes: Mesh[], atlasSize: number, inputFormat: ModelAsset['format']) {
  let triangleCount = 0
  let totalUvArea = 0
  let uvIslandCount = 0

  for (const mesh of meshes) {
    const geometry = mesh.geometry
    const uvAttribute = geometry.getAttribute('uv')
    const indexAttribute = geometry.getIndex()

    if (!uvAttribute || !indexAttribute) {
      continue
    }

    triangleCount += indexAttribute.count / 3
    totalUvArea += computeUvArea(uvAttribute, indexAttribute)
    uvIslandCount += computeUvIslands(uvAttribute, indexAttribute)
  }

  return {
    atlasSize,
    inputFormat,
    triangleCount: Math.round(triangleCount),
    uvCoveragePct: Math.min(totalUvArea, 1) * 100,
    uvIslandCount,
  }
}

function computeUvArea(
  uvAttribute: ReadableUvAttribute,
  indexAttribute: ReadableIndexAttribute,
) {
  let area = 0

  for (let index = 0; index < indexAttribute.count; index += 3) {
    const i0 = indexAttribute.getX(index)
    const i1 = indexAttribute.getX(index + 1)
    const i2 = indexAttribute.getX(index + 2)
    const uv0 = readUv(uvAttribute, i0)
    const uv1 = readUv(uvAttribute, i1)
    const uv2 = readUv(uvAttribute, i2)

    area += Math.abs(
      (uv0.x * (uv1.y - uv2.y) + uv1.x * (uv2.y - uv0.y) + uv2.x * (uv0.y - uv1.y)) *
        0.5,
    )
  }

  return area
}

function computeUvIslands(
  uvAttribute: ReadableUvAttribute,
  indexAttribute: ReadableIndexAttribute,
) {
  const triangleCount = indexAttribute.count / 3
  const triangles = Array.from({ length: triangleCount }, (_, triangleIndex) => {
    const offset = triangleIndex * 3
    return [
      indexAttribute.getX(offset),
      indexAttribute.getX(offset + 1),
      indexAttribute.getX(offset + 2),
    ]
  })
  const edgeToTriangles = new Map<string, number[]>()

  triangles.forEach((triangle, triangleIndex) => {
    getTriangleEdges(triangle).forEach((edge) => {
      const key = edge.join(':')
      const connectedTriangles = edgeToTriangles.get(key) ?? []
      connectedTriangles.push(triangleIndex)
      edgeToTriangles.set(key, connectedTriangles)
    })
  })

  const visited = new Set<number>()
  let islandCount = 0

  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    if (visited.has(triangleIndex)) {
      continue
    }

    islandCount += 1
    const stack = [triangleIndex]

    while (stack.length > 0) {
      const current = stack.pop()

      if (current === undefined || visited.has(current)) {
        continue
      }

      visited.add(current)

      for (const edge of getTriangleEdges(triangles[current])) {
        const connectedTriangles = edgeToTriangles.get(edge.join(':')) ?? []

        for (const nextTriangle of connectedTriangles) {
          if (nextTriangle === current || visited.has(nextTriangle)) {
            continue
          }

          if (trianglesShareEdgeUvs(edge, uvAttribute)) {
            stack.push(nextTriangle)
          }
        }
      }
    }
  }

  return islandCount
}

function getTriangleEdges(triangle: number[]) {
  return [
    sortEdge(triangle[0], triangle[1]),
    sortEdge(triangle[1], triangle[2]),
    sortEdge(triangle[2], triangle[0]),
  ]
}

function sortEdge(a: number, b: number) {
  return a < b ? [a, b] : [b, a]
}

function trianglesShareEdgeUvs(edge: number[], uvAttribute: ReadableUvAttribute) {
  const uvA0 = readUv(uvAttribute, edge[0])
  const uvA1 = readUv(uvAttribute, edge[1])
  const uvB0 = readUv(uvAttribute, edge[0])
  const uvB1 = readUv(uvAttribute, edge[1])

  return approximatelyEqualUv(uvA0, uvB0) && approximatelyEqualUv(uvA1, uvB1)
}

function approximatelyEqualUv(left: Vector3 | { x: number; y: number }, right: Vector3 | { x: number; y: number }) {
  return Math.abs(left.x - right.x) <= 0.0001 && Math.abs(left.y - right.y) <= 0.0001
}

function readUv(uvAttribute: ReadableUvAttribute, index: number) {
  return {
    x: uvAttribute.getX(index),
    y: uvAttribute.getY(index),
  }
}

async function renderUvLayout(meshes: Mesh[], atlasSize: number) {
  const canvas = document.createElement('canvas')
  canvas.width = atlasSize
  canvas.height = atlasSize
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available for UV atlas export.')
  }

  context.fillStyle = atlasBackground
  context.fillRect(0, 0, atlasSize, atlasSize)
  context.strokeStyle = atlasStroke
  context.lineWidth = Math.max(1, atlasSize / 1024)
  context.globalAlpha = 0.95

  for (const mesh of meshes) {
    const geometry = mesh.geometry
    const uvAttribute = geometry.getAttribute('uv')
    const indexAttribute = geometry.getIndex()

    if (!uvAttribute || !indexAttribute) {
      continue
    }

    for (let index = 0; index < indexAttribute.count; index += 3) {
      const i0 = indexAttribute.getX(index)
      const i1 = indexAttribute.getX(index + 1)
      const i2 = indexAttribute.getX(index + 2)
      const uv0 = readUv(uvAttribute, i0)
      const uv1 = readUv(uvAttribute, i1)
      const uv2 = readUv(uvAttribute, i2)

      context.beginPath()
      context.moveTo(uv0.x * atlasSize, (1 - uv0.y) * atlasSize)
      context.lineTo(uv1.x * atlasSize, (1 - uv1.y) * atlasSize)
      context.lineTo(uv2.x * atlasSize, (1 - uv2.y) * atlasSize)
      context.closePath()
      context.stroke()
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Failed to encode the UV atlas preview.'))
    }, 'image/png')
  })
}

function createArtifacts({
  asset,
  atlasBlob,
  meshBytes,
  previewBytes,
}: {
  asset: ModelAsset
  atlasBlob: Blob
  meshBytes: Uint8Array
  previewBytes: Uint8Array
}): UvArtifactManifest {
  const baseName = stripExtension(asset.name)
  const meshExtension = asset.format

  return {
    atlas: createArtifact({
      blob: atlasBlob,
      fileName: `${baseName}-uv-layout.png`,
      mimeType: 'image/png',
    }),
    mesh: createArtifact({
      blob: new Blob([Uint8Array.from(meshBytes)], {
        type: meshExtension === 'obj' ? 'model/obj' : 'application/octet-stream',
      }),
      fileName: `${baseName}-unwrapped.${meshExtension}`,
      mimeType: meshExtension === 'obj' ? 'model/obj' : 'application/octet-stream',
    }),
    previewGlb: createArtifact({
      blob: new Blob([Uint8Array.from(previewBytes)], {
        type: 'model/gltf-binary',
      }),
      fileName: `${baseName}-preview.glb`,
      mimeType: 'model/gltf-binary',
    }),
  }
}

function createArtifact({
  blob,
  fileName,
  mimeType,
}: {
  blob: Blob
  fileName: string
  mimeType: string
}): UvJobArtifact {
  return {
    downloadUrl: URL.createObjectURL(blob),
    fileName,
    mimeType,
  }
}

function stripExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf('.')

  if (extensionIndex <= 0) {
    return fileName
  }

  return fileName.slice(0, extensionIndex)
}
