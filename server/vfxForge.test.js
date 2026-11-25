import { describe, expect, it } from 'vitest'

import {
  buildVfxForgePrompt,
  resolveVfxForgeSystemInstruction,
} from './vfxForge.js'

describe('VFX flipbook prompting', () => {
  it('tells the image model to keep each flipbook frame inside its own slot', () => {
    const prompt = buildVfxForgePrompt({
      effectLabel: 'Sci-Fi Explosion',
      exportTarget: 'none',
      frameCount: 10,
      hasStyleReference: false,
      intensity: 70,
      looping: false,
      prompt: '',
      styleText: '',
      textureKind: 'flipbook',
    })

    expect(prompt).toContain('Each frame must stay fully inside its own equally sized slot.')
    expect(prompt).toContain(
      'Do not overlap adjacent frames, stack frames vertically, or turn the strip into one continuous panorama.',
    )
  })

  it('hardens the flipbook system instruction against cross-frame bleed', () => {
    const instruction = resolveVfxForgeSystemInstruction('', {
      frameCount: 10,
      looping: true,
      textureKind: 'flipbook',
    })

    expect(instruction).toContain('Each frame must be isolated inside an equally sized slot.')
    expect(instruction).toContain(
      'Do not let the effect cross frame boundaries or read like one continuous panoramic image.',
    )
  })
})

import JSZip from 'jszip'
import sharp from 'sharp'
import { buildVfxExportBundle, buildVfxRecipeManifest } from './vfxForge.js'

const request = (overrides = {}) => ({
  effectLabel: 'Arcane / Gate', exportTarget: 'particle-system', frameCount: 8,
  intensity: 0, looping: false, unityPipeline: 'urp', prompt: '', previews: [],
  textures: [{ kind: 'flipbook', mimeType: 'image/png', data: 'unused' }], ...overrides,
})
async function image(format = 'png', width = 64, height = 8) {
  return sharp({ create: { width, height, channels: 4, background: '#ff8000' } })[format]().toBuffer().then(b => b.toString('base64'))
}

describe('VFX recipe consistency', () => {
  it('preserves zero intensity throughout prompt and recipe', () => {
    expect(buildVfxForgePrompt({ ...request(), textureKind: 'flipbook' })).toContain('Intensity target: 0 out of 100.')
    const recipe = buildVfxRecipeManifest(request())
    expect(recipe.intensity).toBe(0)
    expect(recipe.particleSystemConfig.intensity).toBe(0)
    expect(recipe.vfxGraphConfig.exposedProperties.find(p => p.name === 'Intensity').defaultValue).toBe(0)
    expect(recipe.vfxGraphConfig.exposedProperties.find(p => p.name === 'Lifetime').defaultValue).toBe(0.7)
  })
  it('normalizes invalid numeric metadata consistently', () => {
    const recipe = buildVfxRecipeManifest(request({ frameCount: Infinity, intensity: NaN }))
    expect(recipe.frameCount).toBe(8)
    expect(recipe.particleSystemConfig.frameCount).toBe(8)
    expect(recipe.intensity).toBe(60)
    expect(recipe.vfxGraphConfig.intensity).toBe(60)
  })
  it('only binds shader-supported slots and uses undistorted billboard flipbooks', () => {
    const recipe = buildVfxRecipeManifest(request({ textures: ['noise', 'flipbook', 'swirl', 'dissolve-mask'].map(kind => ({ kind, mimeType: 'image/png' })) }))
    expect(recipe.materialConfig.textureBindings).toEqual([{ fileName: 'textures/arcane-gate-flipbook.png', kind: 'flipbook', slot: '_BaseMap' }])
    expect(recipe.particleSystemConfig.rendererMode).toBe('billboard')
    expect(recipe.particleSystemConfig.colorOverLife.every(key => key.color.startsWith('#FFFFFF'))).toBe(true)
    expect(recipe.particleSystemConfig.textureSheetAnimation).toEqual({ columns: 8, rows: 1, cycles: 1 })
  })
  it.each([[], [{ kind: 'invalid' }], [{ kind: 'noise' }, { kind: 'noise' }]])('rejects invalid texture lists: %j', textures => {
    expect(() => buildVfxRecipeManifest(request({ textures }))).toThrow('unique supported')
  })
})

describe('VFX exported artifacts', () => {
  it.each(['png', 'jpeg', 'webp'])('exports real PNG bytes from %s input and all recipe paths resolve', async format => {
    const data = await image(format)
    const zip = await JSZip.loadAsync(await buildVfxExportBundle(request({
      textures: [{ kind: 'flipbook', mimeType: `image/${format}`, data }],
      previews: [{ data: await image('jpeg', 8, 8), mimeType: 'image/jpeg' }],
    })))
    const recipe = JSON.parse(await zip.file('recipe.json').async('string'))
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
    for (const file of [...manifest.textureFiles, ...manifest.previewFiles, ...recipe.textures.map(t => t.previewFileName)]) {
      const bytes = await zip.file(file).async('nodebuffer')
      expect((await sharp(bytes).metadata()).format).toBe('png')
    }
    expect(recipe.textures[0]).toMatchObject({ mimeType: 'image/png', width: 64, height: 8 })
    const importer = await zip.file('Editor/FoundryVfxImporter.cs').async('string')
    expect(importer).toContain('sheet.numTilesX = recipe.frameCount;')
    expect(importer).toContain('TextureImporterNPOTScale.None')
    expect(importer).toContain('GenerateUniqueAssetPath')
    expect(importer).toContain('BlendMode.One')
    expect(importer).toContain('#if UNITY_EDITOR')
  })
  it('rejects corrupt bytes with actionable validation errors', async () => {
    await expect(buildVfxExportBundle(request({ textures: [{ kind: 'noise', data: Buffer.from('not an image').toString('base64') }] }))).rejects.toMatchObject({ status: 400 })
  })
  it('rejects inconsistent flipbook dimensions instead of shipping a broken strip', async () => {
    await expect(buildVfxExportBundle(request({ textures: [{ kind: 'flipbook', data: await image('png', 65, 8) }] }))).rejects.toThrow('evenly divisible')
  })
  it('bounds auxiliary preview count', async () => {
    await expect(buildVfxExportBundle(request({ previews: Array(5).fill({}) }))).rejects.toThrow('At most four')
  })
  it('isolates concurrent exports and labels graph output as guidance', async () => {
    const data = await image()
    const bundles = await Promise.all(['First', 'Second'].map(effectLabel => buildVfxExportBundle(request({ effectLabel, exportTarget: 'vfx-graph', textures: [{ kind: 'flipbook', data }] }))))
    for (const [index, bundle] of bundles.entries()) {
      const zip = await JSZip.loadAsync(bundle)
      expect(JSON.parse(await zip.file('recipe.json').async('string')).effectLabel).toBe(['First', 'Second'][index])
      expect(await zip.file('README.md').async('string')).toContain('not a native .vfx graph')
    }
  })
})
