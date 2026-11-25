import { describe, expect, it } from 'vitest'
import { DEFAULT_PBR_SETTINGS, deriveMaterial, materialDimensions, packMaterial } from './pbrMaterial'
import type { Pixels } from './pbrMaterial'
function image(width = 3, height = 3, value = 128): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255 }
  return { width, height, data }
}
describe('PBR material derivation', () => {
  it('preserves aspect ratio, never upscales and caps allocations', () => {
    expect(materialDimensions(4096, 2048, 1024)).toEqual({ width: 1024, height: 512 })
    expect(materialDimensions(100, 50, 2048)).toEqual({ width: 100, height: 50 })
    expect(materialDimensions(8192, 8192, 9000)).toEqual({ width: 2048, height: 2048 })
    expect(() => materialDimensions(0, 10, 512)).toThrow()
  })
  it('produces neutral normals and fully open AO from a constant surface', async () => {
    const maps = await deriveMaterial(image(), DEFAULT_PBR_SETTINGS)
    expect([...maps.normal.data.slice(0, 4)]).toEqual([128, 128, 255, 255])
    expect([...maps.ao.data.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect(maps.metallic.data[0]).toBe(0)
    expect(maps.albedo.data).toEqual(image().data)
  })
  it('flips only the normal green direction for DirectX', async () => {
    const input = image(); input.data.fill(255, 12, 24)
    const gl = await deriveMaterial(input, DEFAULT_PBR_SETTINGS)
    const dx = await deriveMaterial(input, { ...DEFAULT_PBR_SETTINGS, normalConvention: 'DirectX' })
    expect(gl.normal.data[0]).toBe(dx.normal.data[0])
    expect(gl.normal.data[1] + dx.normal.data[1]).toBe(255)
    expect(gl.normal.data[2]).toBe(dx.normal.data[2])
  })
  it('preserves explicit replacements and derives normals from imported height', async () => {
    const normal = image(3, 3, 27), height = image(3, 3, 100)
    const maps = await deriveMaterial(image(), DEFAULT_PBR_SETTINGS, { normal, height })
    expect(maps.normal).toBe(normal); expect(maps.height).toBe(height)
    const flat = await deriveMaterial(image(), DEFAULT_PBR_SETTINGS, { height })
    expect([...flat.normal.data.slice(0, 4)]).toEqual([128, 128, 255, 255])
    await expect(deriveMaterial(image(), DEFAULT_PBR_SETTINGS, { normal: image(1, 1) })).rejects.toThrow('dimensions')
  })
  it('packs ORM, Unity HDRP mask, and Unity metallic-smoothness exactly', async () => {
    const maps = await deriveMaterial(image(1, 1), DEFAULT_PBR_SETTINGS, { ao: image(1, 1, 40), roughness: image(1, 1, 60), metallic: image(1, 1, 80) })
    expect([...packMaterial(maps, 'orm').data]).toEqual([40, 60, 80, 255])
    expect([...packMaterial(maps, 'unity-mask').data]).toEqual([80, 40, 255, 195])
    expect([...packMaterial(maps, 'unity-metallic').data]).toEqual([80, 0, 0, 195])
  })
  it('cancels obsolete work and rejects oversized inputs', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(deriveMaterial(image(), DEFAULT_PBR_SETTINGS, {}, controller.signal)).rejects.toThrow()
    await expect(deriveMaterial({ width: 3000, height: 1, data: new Uint8ClampedArray(12000) }, DEFAULT_PBR_SETTINGS)).rejects.toThrow('2048')
  })
  it('is deterministic and preserves source alpha', async () => {
    const input = image(); input.data[3] = 42
    const first = await deriveMaterial(input, DEFAULT_PBR_SETTINGS), second = await deriveMaterial(input, DEFAULT_PBR_SETTINGS)
    expect(first).toEqual(second); expect(first.albedo.data[3]).toBe(42)
  })
})
