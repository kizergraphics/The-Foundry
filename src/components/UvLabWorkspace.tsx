import { memo, useEffect, useMemo, useState } from 'react'
import { Bounds, Html, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import {
  Box,
  Download,
  Grid3X3,
  Layers3,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
} from 'lucide-react'
import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import type { ModelAsset } from '../lib/forge'
import type { UvJobStatusResponse } from '../lib/uvLab'
import {
  formatTriangleCount,
  formatUvCoverage,
  getUvMeshArtifactLabel,
  formatUvStep,
} from '../lib/uvLab'
import { loadModelObject } from '../lib/modelScene'

type UvLabWorkspaceProps = {
  activeModelName: string | null
  job: UvJobStatusResponse | null
  sourceAsset: ModelAsset | null
}

type ModelSource =
  | { asset: ModelAsset; kind: 'source' }
  | { kind: 'glb'; url: string }

const checkerTexture = buildCheckerTexture()

const UvLabWorkspace = memo(function UvLabWorkspace({
  activeModelName,
  job,
  sourceAsset,
}: UvLabWorkspaceProps) {
  const [checkerEnabled, setCheckerEnabled] = useState(false)
  const [previewMode, setPreviewMode] = useState<'source' | 'unwrapped'>('source')
  const hasProcessedPreview = Boolean(job?.artifacts?.previewGlb?.downloadUrl)
  const effectivePreviewMode =
    previewMode === 'unwrapped' && hasProcessedPreview ? 'unwrapped' : 'source'
  const currentSource: ModelSource | null =
    effectivePreviewMode === 'unwrapped' && hasProcessedPreview
      ? {
          kind: 'glb',
          url: job!.artifacts!.previewGlb.downloadUrl,
        }
      : sourceAsset
        ? {
            asset: sourceAsset,
            kind: 'source',
          }
        : null

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.7fr)]">
      <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              3D Preview
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {effectivePreviewMode === 'unwrapped'
                ? 'Processed preview'
                : 'Source mesh preview'}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <WorkspaceToggleButton
              icon={Box}
              isActive={effectivePreviewMode === 'source'}
              label="Source"
              onClick={() => setPreviewMode('source')}
            />
            <WorkspaceToggleButton
              icon={RotateCcw}
              isActive={effectivePreviewMode === 'unwrapped'}
              label="Unwrapped"
              onClick={() => setPreviewMode('unwrapped')}
              disabled={!hasProcessedPreview}
            />
            <WorkspaceToggleButton
              icon={Grid3X3}
              isActive={checkerEnabled}
              label="Checker"
              onClick={() => setCheckerEnabled((previousState) => !previousState)}
              disabled={!currentSource}
            />
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,rgba(8,11,16,0.98),rgba(4,6,10,0.98))]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-zinc-400">
            <span>{sourceAsset ? sourceAsset.name : 'No mesh staged yet'}</span>
            <span>{activeModelName ?? 'browser-uv-engine'}</span>
          </div>
          <div className="h-[440px]">
            {currentSource ? (
              <Canvas camera={{ fov: 40, position: [3.2, 2.3, 4.4] }}>
                <SceneLights />
                <ModelViewportScene
                  checkerEnabled={checkerEnabled}
                  source={currentSource}
                />
                <OrbitControls enableDamping makeDefault />
              </Canvas>
            ) : (
              <EmptyViewport />
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatusMetric
            label="Job Status"
            value={
              job
                ? job.status.charAt(0).toUpperCase() + job.status.slice(1)
                : 'Idle'
            }
          />
          <StatusMetric
            label="Current Step"
            value={job ? formatUvStep(job.step) : 'Awaiting upload'}
          />
          <StatusMetric
            label="Source Format"
            value={sourceAsset ? sourceAsset.format.toUpperCase() : 'None'}
          />
        </div>
      </section>

      <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              UV Atlas
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Layout review and exports
            </h2>
          </div>
          <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-zinc-300">
            {job?.stats?.atlasSize ? `${job.stats.atlasSize}px atlas` : 'Waiting'}
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
          {job?.artifacts?.atlas?.downloadUrl ? (
            <img
              src={job.artifacts.atlas.downloadUrl}
              alt="Generated UV atlas"
              className="aspect-square w-full object-contain"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center px-6 text-center text-sm text-zinc-500">
              {job
                ? `${formatUvStep(job.step)}. The atlas will appear here when processing finishes.`
                : 'Run a UV job to inspect the atlas layout here.'}
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <StatusMetric
            label="Triangles"
            value={formatTriangleCount(job?.stats?.triangleCount)}
          />
          <StatusMetric
            label="UV Islands"
            value={
              typeof job?.stats?.uvIslandCount === 'number'
                ? String(job.stats.uvIslandCount)
                : 'Unavailable'
            }
          />
          <StatusMetric
            label="Coverage"
            value={formatUvCoverage(job?.stats?.uvCoveragePct)}
          />
          <StatusMetric
            label="Format"
            value={job?.stats?.inputFormat?.toUpperCase() ?? 'Unavailable'}
          />
        </div>

        <div className="mt-4 space-y-3">
          <ArtifactDownloadRow
            artifactLabel="UV Atlas PNG"
            artifactUrl={job?.artifacts?.atlas?.downloadUrl ?? null}
            fileName={job?.artifacts?.atlas?.fileName ?? null}
          />
          <ArtifactDownloadRow
            artifactLabel={getUvMeshArtifactLabel(job)}
            artifactUrl={job?.artifacts?.mesh?.downloadUrl ?? null}
            fileName={job?.artifacts?.mesh?.fileName ?? null}
          />
          <ArtifactDownloadRow
            artifactLabel="Preview GLB"
            artifactUrl={job?.artifacts?.previewGlb?.downloadUrl ?? null}
            fileName={job?.artifacts?.previewGlb?.fileName ?? null}
          />
        </div>

        <div className="mt-4 rounded-[22px] border border-white/10 bg-black/20 px-4 py-4 text-sm leading-7 text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            {job && job.status !== 'succeeded' ? (
              <LoaderCircle className="size-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <ScanSearch className="size-4" strokeWidth={1.8} />
            )}
            <span className="font-medium">UV Lab status</span>
          </div>
          <p className="mt-2">
            {job
              ? job.status === 'failed'
                ? job.error?.message ?? 'The local UV engine reported an error.'
                : job.status === 'succeeded'
                  ? 'Artifacts are ready. Review the atlas, inspect the processed preview, and download the mesh.'
                  : `${formatUvStep(job.step)}. Processing runs entirely in your browser.`
              : 'Upload an OBJ or FBX mesh, choose the atlas size and padding, then run One-Click Unwrap.'}
          </p>
        </div>
      </section>
    </div>
  )
})

export default UvLabWorkspace

type ModelViewportSceneProps = {
  checkerEnabled: boolean
  source: ModelSource
}

function ModelViewportScene({
  checkerEnabled,
  source,
}: ModelViewportSceneProps) {
  const [error, setError] = useState<string | null>(null)
  const [object, setObject] = useState<Object3D | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadModel() {
      try {
        const loadedObject =
          source.kind === 'glb'
            ? await loadGlbScene(source.url)
            : await loadUploadedModel(source.asset)

        if (!cancelled) {
          setObject(loadedObject)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'The preview model could not be loaded.',
          )
          setObject(null)
        }
      }
    }

    void loadModel()

    return () => {
      cancelled = true
    }
  }, [source])

  const displayObject = useMemo(() => {
    if (!object) {
      return null
    }

    return cloneDisplayObject(object, checkerEnabled)
  }, [checkerEnabled, object])

  if (error) {
    return (
      <Html center>
        <div className="rounded-[20px] border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      </Html>
    )
  }

  if (!displayObject) {
    return (
      <Html center>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-200">
          <LoaderCircle className="size-4 animate-spin" strokeWidth={1.8} />
          Loading preview
        </div>
      </Html>
    )
  }

  return (
    <Bounds fit clip observe margin={1.25}>
      <primitive object={displayObject} />
    </Bounds>
  )
}

function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 4, 4]} intensity={1.2} />
      <directionalLight position={[-4, 2, -3]} intensity={0.45} color="#bfd7ff" />
      <gridHelper args={[12, 24, '#374151', '#17202d']} position={[0, -1.35, 0]} />
    </>
  )
}

function EmptyViewport() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-300">
          <Layers3 className="size-6" strokeWidth={1.7} />
        </div>
        <p className="mt-4 text-base font-medium text-white">Stage a mesh to preview it here</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          UV Lab loads OBJ and FBX directly in the browser before the unwrap job runs.
        </p>
      </div>
    </div>
  )
}

type WorkspaceToggleButtonProps = {
  disabled?: boolean
  icon: typeof Box
  isActive: boolean
  label: string
  onClick: () => void
}

function WorkspaceToggleButton({
  disabled = false,
  icon: Icon,
  isActive,
  label,
  onClick,
}: WorkspaceToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
        isActive
          ? 'border-amber-200/35 bg-amber-300/12 text-amber-50'
          : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05]'
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <Icon className="size-4" strokeWidth={1.8} />
      {label}
    </button>
  )
}

type StatusMetricProps = {
  label: string
  value: string
}

function StatusMetric({ label, value }: StatusMetricProps) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-zinc-100">{value}</p>
    </div>
  )
}

type ArtifactDownloadRowProps = {
  artifactLabel: string
  artifactUrl: string | null
  fileName: string | null
}

function ArtifactDownloadRow({
  artifactLabel,
  artifactUrl,
  fileName,
}: ArtifactDownloadRowProps) {
  const content = (
    <>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{artifactLabel}</span>
        <span className="mt-1 block truncate text-xs text-zinc-400">
          {fileName ?? 'Pending'}
        </span>
      </span>
      <span className="inline-flex items-center gap-2 text-sm text-zinc-200">
        <Download className="size-4" strokeWidth={1.8} />
        Download
      </span>
    </>
  )

  if (!artifactUrl) {
    return (
      <div className="flex items-center justify-between rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 opacity-55">
        {content}
      </div>
    )
  }

  return (
    <a
      href={artifactUrl}
      download
      className="flex items-center justify-between rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.05]"
    >
      {content}
    </a>
  )
}

function cloneDisplayObject(source: Object3D, checkerEnabled: boolean) {
  const clone = source.clone(true)

  clone.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return
    }

    if (checkerEnabled) {
      const checkerMaterial = new MeshStandardMaterial({
        map: checkerTexture,
        metalness: 0.08,
        roughness: 0.78,
      })

      child.material = Array.isArray(child.material)
        ? child.material.map(() => checkerMaterial.clone())
        : checkerMaterial
      return
    }

    if (!child.material) {
      child.material = new MeshStandardMaterial({
        color: new Color('#dde7f5'),
        metalness: 0.08,
        roughness: 0.82,
      })
    }
  })

  return clone
}

async function loadUploadedModel(asset: ModelAsset) {
  return loadModelObject(asset)
}

async function loadGlbScene(url: string) {
  const loader = new GLTFLoader()

  return new Promise<Group>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => {
        reject(error instanceof Error ? error : new Error('Failed to load GLB preview.'))
      },
    )
  })
}

function buildCheckerTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is not available for UV checker previews.')
  }

  const tileSize = 32

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? '#f5e9b8' : '#2f3440'
      context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(4, 4)
  texture.colorSpace = SRGBColorSpace
  return texture
}
