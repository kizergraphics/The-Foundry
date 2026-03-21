import { memo, Suspense, useMemo, useState } from 'react'
import { Bounds, Html, OrbitControls, useTexture } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Lightbulb, Move3d } from 'lucide-react'
import {
  DoubleSide,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'

import type { TextureMaterialMapKey } from '../lib/forge'
import type { MaterialMapResult } from '../modes/execution'

const materialMapOrder: TextureMaterialMapKey[] = [
  'height',
  'normal',
  'roughness',
  'metallic',
]

const materialMapLabels: Record<TextureMaterialMapKey, string> = {
  height: 'Height',
  metallic: 'Metallic',
  normal: 'Normal',
  roughness: 'Roughness',
}

const emptyTextureDataUrl =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

type TextureMaterialViewerProps = {
  maps: Partial<Record<TextureMaterialMapKey, MaterialMapResult>>
  sourceDataUrl: string
}

export const TextureMaterialViewer = memo(function TextureMaterialViewer({
  maps,
  sourceDataUrl,
}: TextureMaterialViewerProps) {
  const [lightAzimuth, setLightAzimuth] = useState(38)
  const [lightElevation, setLightElevation] = useState(42)
  const [lightIntensity, setLightIntensity] = useState(120)
  const hasAnyMaps = materialMapOrder.some((mapKey) => Boolean(maps[mapKey]))
  const supportsViewer = useMemo(() => canRenderMaterialViewer(), [])

  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 border-b border-white/8 pb-4">
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Live Material View
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Drag to orbit the camera, then sweep the key light to inspect how the generated
              maps react as a tiled material.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {materialMapOrder.map((mapKey) => (
              <span
                key={mapKey}
                className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${
                  maps[mapKey]
                    ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
                    : 'border-white/10 bg-black/20 text-zinc-500'
                }`}
              >
                {materialMapLabels[mapKey]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[22px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_35%),linear-gradient(180deg,rgba(7,10,14,0.98),rgba(4,6,10,0.98))]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-zinc-400">
          <span>{hasAnyMaps ? 'Map-driven tiled preview' : 'Source texture preview'}</span>
          <span>Drag to orbit</span>
        </div>

        <div className="h-[380px]">
          {supportsViewer ? (
            <Canvas camera={{ fov: 34, position: [0, 1.15, 3.6] }}>
              <Suspense fallback={<ViewerLoadingState />}>
                <MaterialPreviewScene
                  lightAzimuth={lightAzimuth}
                  lightElevation={lightElevation}
                  lightIntensity={lightIntensity / 100}
                  maps={maps}
                  sourceDataUrl={sourceDataUrl}
                />
              </Suspense>
              <OrbitControls enableDamping makeDefault maxDistance={6} minDistance={1.7} />
            </Canvas>
          ) : (
            <ViewerFallback hasAnyMaps={hasAnyMaps} sourceDataUrl={sourceDataUrl} />
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <LightControl
          label="Light Orbit"
          value={lightAzimuth}
          min={0}
          max={360}
          onChange={setLightAzimuth}
        />
        <LightControl
          label="Light Height"
          value={lightElevation}
          min={10}
          max={85}
          onChange={setLightElevation}
        />
        <LightControl
          label="Light Power"
          value={lightIntensity}
          min={40}
          max={180}
          onChange={setLightIntensity}
        />
      </div>
    </section>
  )
})

type MaterialPreviewSceneProps = {
  lightAzimuth: number
  lightElevation: number
  lightIntensity: number
  maps: Partial<Record<TextureMaterialMapKey, MaterialMapResult>>
  sourceDataUrl: string
}

function MaterialPreviewScene({
  lightAzimuth,
  lightElevation,
  lightIntensity,
  maps,
  sourceDataUrl,
}: MaterialPreviewSceneProps) {
  const [baseColorTexture, heightTexture, normalTexture, roughnessTexture, metallicTexture] =
    useTexture([
      sourceDataUrl,
      maps.height?.dataUrl ?? emptyTextureDataUrl,
      maps.normal?.dataUrl ?? emptyTextureDataUrl,
      maps.roughness?.dataUrl ?? emptyTextureDataUrl,
      maps.metallic?.dataUrl ?? emptyTextureDataUrl,
    ])

  configureMaterialTexture(baseColorTexture, true)
  configureMaterialTexture(heightTexture)
  configureMaterialTexture(normalTexture)
  configureMaterialTexture(roughnessTexture)
  configureMaterialTexture(metallicTexture)

  const lightPosition = buildLightPosition(lightAzimuth, lightElevation, 4.4)

  return (
    <>
      <color attach="background" args={['#05070c']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={lightPosition} intensity={lightIntensity} />
      <directionalLight position={[-2.6, 1.4, -2.4]} intensity={0.35} color="#bfd7ff" />

      <Bounds fit clip observe margin={1.2}>
        <group>
          <mesh rotation={[-0.92, 0.42, 0.04]} position={[0, 0.1, 0]}>
            <planeGeometry args={[3, 3, 256, 256]} />
            <meshStandardMaterial
              displacementMap={maps.height ? heightTexture : null}
              displacementScale={maps.height ? 0.2 : 0}
              map={baseColorTexture}
              metalness={maps.metallic ? 1 : 0.08}
              metalnessMap={maps.metallic ? metallicTexture : null}
              normalMap={maps.normal ? normalTexture : null}
              roughness={maps.roughness ? 1 : 0.84}
              roughnessMap={maps.roughness ? roughnessTexture : null}
              side={DoubleSide}
            />
          </mesh>

          <mesh position={[0, -1.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[4.6, 64]} />
            <meshBasicMaterial color="#0a0f17" />
          </mesh>
        </group>
      </Bounds>
    </>
  )
}

function ViewerLoadingState() {
  return (
    <Html center>
      <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-zinc-200">
        Loading live material view
      </div>
    </Html>
  )
}

type ViewerFallbackProps = {
  hasAnyMaps: boolean
  sourceDataUrl: string
}

function ViewerFallback({ hasAnyMaps, sourceDataUrl }: ViewerFallbackProps) {
  return (
    <div className="flex h-full flex-col justify-center px-5 py-6">
      <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-[20px] border border-white/10 bg-black/30">
        <img
          src={sourceDataUrl}
          alt="Source texture preview"
          className="aspect-square w-full object-cover"
        />
      </div>
      <div className="mx-auto mt-5 max-w-sm text-center">
        <p className="text-sm font-medium text-zinc-100">
          {hasAnyMaps ? 'Live material view is not available in this environment.' : 'Generate maps to preview the surface response here.'}
        </p>
        <p className="mt-2 text-xs leading-6 text-zinc-400">
          The source texture stays visible as a fallback when WebGL is unavailable.
        </p>
      </div>
    </div>
  )
}

type LightControlProps = {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}

function LightControl({
  label,
  max,
  min,
  onChange,
  value,
}: LightControlProps) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
          {label}
        </p>
        <span className="text-xs text-zinc-300">{value}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-300">
          {label === 'Light Orbit' ? (
            <Move3d className="size-4" strokeWidth={1.7} />
          ) : (
            <Lightbulb className="size-4" strokeWidth={1.7} />
          )}
        </span>
        <input
          aria-label={label}
          className="w-full cursor-pointer accent-sky-400"
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={1}
          type="range"
          value={value}
        />
      </div>
    </div>
  )
}

function configureMaterialTexture(texture: Texture, isColorTexture = false) {
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(2.4, 2.4)
  texture.colorSpace = isColorTexture ? SRGBColorSpace : texture.colorSpace
  texture.needsUpdate = true
}

function buildLightPosition(azimuth: number, elevation: number, radius: number) {
  const azimuthRadians = (azimuth * Math.PI) / 180
  const elevationRadians = (elevation * Math.PI) / 180
  const horizontalRadius = Math.cos(elevationRadians) * radius

  return [
    Math.cos(azimuthRadians) * horizontalRadius,
    Math.sin(elevationRadians) * radius,
    Math.sin(azimuthRadians) * horizontalRadius,
  ] as const
}

function canRenderMaterialViewer() {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof WebGLRenderingContext === 'undefined'
  ) {
    return false
  }

  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch {
    return false
  }
}
