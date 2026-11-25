import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three'
import JSZip from 'jszip'
import { DEFAULT_PBR_SETTINGS, MAP_NAMES, deriveMaterial, loadMaterialImage, packMaterial, pixelsCanvas, pixelsPng } from '../lib/pbrMaterial'
import type { MapName, MaterialMaps, PbrSettings } from '../lib/pbrMaterial'
import './PbrMaterialWorkbench.css'

interface Props { source?: string; sourceRevision?: number; materialName?: string }
type SourceInputs = {
  revision: number
  importedSource?: string
  replacements: Partial<Record<MapName, string>>
}
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p>3D preview unavailable on this device. Map editing and export remain available.</p> : this.props.children }
}
function MaterialObject({ maps, tiles, convention, shape, relief }: { maps: MaterialMaps; tiles: number; convention: PbrSettings['normalConvention']; shape: string; relief: number }) {
  const textures = useMemo(() => Object.fromEntries(MAP_NAMES.map(name => {
    const texture = new CanvasTexture(pixelsCanvas(maps[name])); texture.colorSpace = name === 'albedo' ? SRGBColorSpace : NoColorSpace
    texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(tiles, tiles)
    return [name, texture]
  })) as Record<MapName, CanvasTexture>, [maps, tiles])
  useEffect(() => () => Object.values(textures).forEach(texture => texture.dispose()), [textures])
  return <mesh rotation={shape === 'plane' ? [-.5, 0, 0] : [0, .4, 0]}>
    {shape === 'sphere' ? <sphereGeometry args={[1.35, 96, 64]} /> : <planeGeometry args={[2.7, 2.7, 128, 128]} />}
    <meshStandardMaterial map={textures.albedo} normalMap={textures.normal} normalScale={new Vector2(1, convention === 'DirectX' ? -1 : 1)} roughnessMap={textures.roughness} roughness={1} metalnessMap={textures.metallic} metalness={1} aoMap={textures.ao} displacementMap={textures.height} displacementScale={relief} displacementBias={-relief / 2} />
  </mesh>
}
function MapThumbnail({ maps, name }: { maps: MaterialMaps; name: MapName }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const scale = 160 / Math.max(maps[name].width, maps[name].height)
    canvas.width = Math.max(1, Math.round(maps[name].width * scale)); canvas.height = Math.max(1, Math.round(maps[name].height * scale))
    canvas.getContext('2d')?.drawImage(pixelsCanvas(maps[name]), 0, 0, canvas.width, canvas.height)
  }, [maps, name])
  return <canvas ref={canvasRef} aria-label={`${name} map preview`} />
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export function PbrMaterialWorkbench({ source, sourceRevision = 0, materialName = 'foundry-material' }: Props) {
  const [inputs, setInputs] = useState<SourceInputs>({ revision: sourceRevision, replacements: {} })
  if (inputs.revision !== sourceRevision) {
    setInputs({ revision: sourceRevision, replacements: {} })
  }
  const { importedSource, replacements } = inputs
  const [settings, setSettings] = useState<PbrSettings>(DEFAULT_PBR_SETTINGS)
  const [snapshot, setSnapshot] = useState<{ maps: MaterialMaps; source: string; settings: PbrSettings; replacements: Partial<Record<MapName, string>> }>()
  const [status, setStatus] = useState('Import an approved texture to start.')
  const [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false)
  const [tiles, setTiles] = useState(2), [shape, setShape] = useState('sphere'), [relief, setRelief] = useState(.04)
  const importVersions = useRef<Record<string, number>>({}), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const activeSource = importedSource || source
  const maps = snapshot?.source === activeSource && snapshot?.settings === settings && snapshot?.replacements === replacements ? snapshot?.maps : undefined
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      if (!activeSource) { setSnapshot(undefined); setBusy(false); setStatus('Import an approved texture to start.'); return }
      setBusy(true); setSnapshot(undefined); setStatus('Deriving material maps locally…')
      try {
        const input = await loadMaterialImage(activeSource, settings.resolution)
        controller.signal.throwIfAborted()
        const loaded: Partial<MaterialMaps> = {}
        for (const name of MAP_NAMES) if (replacements[name]) {
          loaded[name] = await loadMaterialImage(replacements[name]!, settings.resolution, input)
          controller.signal.throwIfAborted()
        }
        const result = await deriveMaterial(input, settings, loaded, controller.signal)
        if (!controller.signal.aborted) { setSnapshot({ maps: result, source: activeSource, settings, replacements }); setStatus(`${input.width} × ${input.height} · Ready to export lossless 8-bit PNG maps.`) }
      } catch (error) { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Could not process this image.') }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [activeSource, replacements, settings])
  function change<K extends keyof PbrSettings>(key: K, value: PbrSettings[K]) { setSnapshot(undefined); setSettings(previous => ({ ...previous, [key]: value })) }
  function cancelPendingImports() { for (const key of Object.keys(importVersions.current)) importVersions.current[key]++ }
  async function importFile(file: File | undefined, name: MapName | 'source') {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { setStatus('Choose a PNG, JPEG, or WebP image under 20 MB.'); return }
    if (name === 'source') cancelPendingImports()
    const version = (importVersions.current[name] ?? 0) + 1; importVersions.current[name] = version
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(file)
      })
      if (!mounted.current || importVersions.current[name] !== version) return
      setInputs(previous => {
        if (previous.revision !== sourceRevision) return previous
        return name === 'source'
          ? { revision: sourceRevision, importedSource: result, replacements: {} }
          : { ...previous, replacements: { ...previous.replacements, [name]: result } }
      })
    } catch (error) { if (mounted.current) setStatus(error instanceof Error ? error.message : 'Import failed') }
  }
  async function exportMaterial(single?: MapName) {
    if (!maps || busy || exporting) return
    setExporting(true)
    const safeName = materialName.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'material'
    try {
      if (single) { download(await pixelsPng(maps[single]), `${safeName}-${single}.png`); return }
      const zip = new JSZip()
      for (const name of MAP_NAMES) zip.file(`${safeName}-${name}.png`, await (await pixelsPng(maps[name])).arrayBuffer())
      for (const format of ['orm', 'unity-mask', 'unity-metallic'] as const) zip.file(`${safeName}-${format}.png`, await (await pixelsPng(packMaterial(maps, format))).arrayBuffer())
      zip.file('material.json', JSON.stringify({ version: 1, name: safeName, width: maps.albedo.width, height: maps.albedo.height, settings,
        overrides: Object.keys(replacements), colorSpaces: { albedo: 'sRGB', otherMaps: 'linear / non-color' },
        normalConvention: settings.normalConvention, bitDepth: 8, packing: { orm: 'R=AO G=roughness B=metallic A=1', 'unity-mask': 'R=metallic G=AO B=detail mask (1) A=smoothness', 'unity-metallic': 'R=metallic G=0 B=0 A=smoothness' },
        note: 'Height, normals, roughness and AO are artistic luminance-derived estimates, not physical recovery. Metallic defaults to zero. Imported maps replace estimates without processing; supplied normal map must match the selected convention. Height imports use red-channel data for derived normals. Preview height relief and tiling do not alter exported pixels.' }, null, 2))
      zip.file('README.txt', 'The Foundry PBR material\nAlbedo: sRGB. All other maps: linear/non-color.\nNormal convention is recorded in material.json; set it correctly for imported normals.\nUnity HDRP: unity-mask (metallic, AO, detail=1, smoothness).\nUnity Standard/URP: unity-metallic (metallic R, smoothness A).\nORM: AO R, roughness G, metallic B.\nAll maps are lossless 8-bit PNG. Replacement maps are resized to match albedo.\nDerived estimates are not physically measured materials. Source lighting and seams may remain.\n')
      download(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `${safeName}-pbr.zip`)
    } catch (error) { if (mounted.current) setStatus(error instanceof Error ? error.message : 'Export failed') }
    finally { if (mounted.current) setExporting(false) }
  }
  const sliders: { key: 'brightness' | 'saturation' | 'heightContrast' | 'normalStrength' | 'roughness' | 'roughnessDetail' | 'metallic' | 'aoStrength'; label: string; max: number }[] = [
    { key: 'brightness', label: 'Albedo brightness', max: 2 }, { key: 'saturation', label: 'Albedo saturation', max: 2 },
    { key: 'heightContrast', label: 'Height contrast', max: 3 }, { key: 'normalStrength', label: 'Normal strength', max: 12 },
    { key: 'roughness', label: 'Base roughness', max: 1 }, { key: 'roughnessDetail', label: 'Roughness variation', max: 1 },
    { key: 'metallic', label: 'Metallic', max: 1 }, { key: 'aoStrength', label: 'AO strength', max: 2 },
  ]
  return <section className="pbr-workbench" aria-label="PBR material finishing">
    <header><h2>PBR material finishing</h2><p>Approve your albedo first, then create and tune a material locally. Derived maps are artistic estimates, not recovered physical properties. Replace any map with your own measured or authored map.</p></header>
    <div className="pbr-toolbar">
      <label className="pbr-file">Import albedo<input aria-label="Import albedo source" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void importFile(event.target.files?.[0], 'source'); event.target.value = '' }} /></label>
      {importedSource && source && <button onClick={() => { setSnapshot(undefined); cancelPendingImports(); setInputs({ revision: sourceRevision, replacements: {} }) }}>Use approved texture</button>}
      <label>Max dimension<select aria-label="PBR resolution" value={settings.resolution} onChange={event => change('resolution', Number(event.target.value))}>{[256, 512, 1024, 2048].map(n => <option key={n} value={n}>{n}px</option>)}</select></label>
      <button disabled={!maps || busy || exporting} onClick={() => void exportMaterial()}>{exporting ? 'Packaging…' : 'Download PBR ZIP'}</button>
      <button onClick={() => { setSnapshot(undefined); cancelPendingImports(); setSettings(DEFAULT_PBR_SETTINGS); setInputs(previous => ({ ...previous, replacements: {} })) }}>Reset adjustments</button>
    </div>
    <p role="status" aria-label="Material processing status" aria-live="polite">{status}</p>
    <div className="pbr-layout"><div className="pbr-controls">
      {sliders.map(({ key, label, max }) => <label key={key}>{label}<output>{settings[key].toFixed(2)}</output><input aria-label={label} type="range" min={0} max={max} step={.05} value={settings[key]} onChange={event => change(key, Number(event.target.value))} /></label>)}
      <label><input type="checkbox" checked={settings.invertHeight} onChange={event => change('invertHeight', event.target.checked)} /> Invert estimated height</label>
      <label>Normal convention<select value={settings.normalConvention} onChange={event => change('normalConvention', event.target.value as PbrSettings['normalConvention'])}><option>OpenGL</option><option>DirectX</option></select></label>
      <p>Overrides bypass that map’s controls. Normal imports must already use the selected convention. Imported height also drives estimated normals/AO. Inputs retain their aspect ratio; replacements fit the albedo dimensions.</p>
    </div><div>
      <div className="pbr-preview">{maps ? <PreviewBoundary><Suspense fallback={<p>Loading preview…</p>}><Canvas camera={{ position: [0, 0, 4.5], fov: 42 }} frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true }}>
        <color attach="background" args={['#171a23']} /><ambientLight intensity={1.5} /><directionalLight position={[3, 4, 5]} intensity={4} /><directionalLight position={[-4, 1, 2]} intensity={2} />
        <MaterialObject maps={maps} tiles={tiles} convention={settings.normalConvention} shape={shape} relief={relief} /><OrbitControls enablePan={false} minDistance={2} maxDistance={7} />
      </Canvas></Suspense></PreviewBoundary> : <p>{busy ? 'Processing bounded-resolution maps…' : 'Import a texture to preview your material.'}</p>}</div>
      <div className="pbr-toolbar"><label>Shape<select value={shape} onChange={event => setShape(event.target.value)}><option value="sphere">Sphere</option><option value="plane">Plane</option></select></label><label>Tiling<select value={tiles} onChange={event => setTiles(Number(event.target.value))}>{[1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label><label>Preview relief<input type="range" min={0} max={.25} step={.01} value={relief} onChange={event => setRelief(Number(event.target.value))} /></label></div>
      <p>Drag to orbit; scroll to zoom. Tiling checks seams but does not make a non-seamless source seamless. Preview relief is not baked into maps.</p>
    </div></div>
    <div className="pbr-map-grid">{MAP_NAMES.map(name => <article key={name}><h3>{name}{replacements[name] ? ' · imported' : ' · derived'}</h3>{maps && <MapThumbnail maps={maps} name={name} />}<label className="pbr-file">Replace {name}<input aria-label={`Replace ${name} map`} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void importFile(event.target.files?.[0], name); event.target.value = '' }} /></label>{replacements[name] && <button onClick={() => { importVersions.current[name] = (importVersions.current[name] ?? 0) + 1; setSnapshot(undefined); setInputs(previous => { const next = { ...previous.replacements }; delete next[name]; return { ...previous, replacements: next } }) }}>Use derived</button>}<button disabled={!maps || busy || exporting} onClick={() => void exportMaterial(name)}>PNG</button></article>)}</div>
  </section>
}
export default PbrMaterialWorkbench
