import JSZip from 'jszip'

import {
  getVfxExportTargetLabel,
  getVfxTextureLabel,
  resolveVfxEffectLabel,
  resolveVfxPreviewStrategy,
  vfxTextureKinds,
} from '../shared/vfxForgeCatalog.js'

const recipeVersion = '1.0.0'
const defaultShader = 'Universal Render Pipeline/Particles/Unlit'
const defaultMaterialKey = 'urp_particles_unlit_generic'
const defaultGraphTemplate = 'urp_vfx_generic'
const baseMapFallbackOrder = ['flipbook', 'swirl', 'noise', 'dissolve-mask']

function sanitizeFileSegment(value, fallback) {
  const normalizedValue = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalizedValue || fallback
}

function normalizeEffectLabel(effectLabel) {
  return resolveVfxEffectLabel(effectLabel)
}

function buildTextureFileName(effectLabel, kind) {
  const effectSlug = sanitizeFileSegment(effectLabel, 'effect')
  const kindSlug = sanitizeFileSegment(kind, 'texture')
  return `textures/${effectSlug}-${kindSlug}.png`
}

function buildPreviewFileName(effectLabel, kind) {
  const effectSlug = sanitizeFileSegment(effectLabel, 'effect')
  const kindSlug = sanitizeFileSegment(kind, 'preview')
  return `preview/${effectSlug}-${kindSlug}.png`
}

function buildTextureSlotMap(kinds) {
  const selectedKinds = new Set(kinds)
  const textureSlots = {
    _DissolveMask: selectedKinds.has('dissolve-mask') ? 'dissolve-mask' : null,
    _NoiseTex: selectedKinds.has('noise') ? 'noise' : null,
    _SwirlTex: selectedKinds.has('swirl') ? 'swirl' : null,
  }
  const baseMapKind = baseMapFallbackOrder.find((kind) => selectedKinds.has(kind)) ?? null

  if (baseMapKind) {
    textureSlots._BaseMap = baseMapKind
  }

  return textureSlots
}

function buildParticleSystemConfig({ frameCount, intensity, looping, hasFlipbook }) {
  const normalizedIntensity = Math.max(0, Math.min(100, Math.round(Number(intensity) || 60)))
  const normalizedFrameCount = Math.max(4, Math.min(30, Math.round(Number(frameCount) || 8)))
  const intensityScale = normalizedIntensity / 100

  return {
    blendMode: 'additive',
    bursts: looping
      ? [{ count: 10 + Math.round(intensityScale * 10), time: 0 }]
      : [
          { count: 22 + Math.round(intensityScale * 22), time: 0 },
          { count: 8 + Math.round(intensityScale * 12), time: 0.06 },
        ],
    colorOverLife: [
      { color: '#FFF5D8FF', time: 0 },
      { color: '#FFAF59FF', time: 0.4 },
      { color: '#FF5A1FCC', time: 0.8 },
      { color: '#00000000', time: 1 },
    ],
    emission: looping
      ? {
          rateOverDistance: 0,
          rateOverTime: 10 + Math.round(intensityScale * 16),
        }
      : {
          rateOverDistance: 0,
          rateOverTime: 0,
        },
    frameCount: normalizedFrameCount,
    intensity: normalizedIntensity,
    lifetime: looping
      ? {
          max: 1.2 + intensityScale * 0.6,
          min: 0.6 + intensityScale * 0.3,
        }
      : {
          max: 1 + intensityScale * 0.5,
          min: 0.35 + intensityScale * 0.2,
        },
    looping,
    rendererMode: hasFlipbook ? 'stretched-billboard' : 'billboard',
    size: hasFlipbook
      ? {
          max: 0.42 + intensityScale * 0.3,
          min: 0.18 + intensityScale * 0.12,
        }
      : {
          max: 0.9 + intensityScale * 0.5,
          min: 0.3 + intensityScale * 0.15,
        },
    velocity: {
      direction: [0, 0, 1],
      space: 'local',
      speedMax: looping ? 2 + intensityScale * 5 : 1.5 + intensityScale * 3,
      speedMin: looping ? 0.6 + intensityScale * 1.5 : 0.2 + intensityScale,
    },
  }
}

function buildVfxGraphExposedProperties(textures, { intensity, looping }) {
  const properties = []
  const fileNameByKind = Object.fromEntries(textures.map((texture) => [texture.kind, texture.fileName]))

  if (fileNameByKind.flipbook) {
    properties.push({
      fileName: fileNameByKind.flipbook,
      name: 'MainFlipbook',
      type: 'Texture2D',
    })
  }

  if (fileNameByKind.swirl) {
    properties.push({
      fileName: fileNameByKind.swirl,
      name: 'SwirlMap',
      type: 'Texture2D',
    })
  }

  if (fileNameByKind.noise) {
    properties.push({
      fileName: fileNameByKind.noise,
      name: 'NoiseMap',
      type: 'Texture2D',
    })
  }

  if (fileNameByKind['dissolve-mask']) {
    properties.push({
      fileName: fileNameByKind['dissolve-mask'],
      name: 'DissolveMask',
      type: 'Texture2D',
    })
  }

  properties.push(
    {
      defaultValue: looping ? 22 : 0,
      name: 'SpawnRate',
      type: 'float',
    },
    {
      defaultValue: 0.7 + Math.max(0, Math.min(100, Math.round(Number(intensity) || 60))) / 100,
      name: 'Lifetime',
      type: 'float',
    },
    {
      defaultValue: 0.35,
      name: 'QuadSize',
      type: 'float',
    },
    {
      defaultValue: Math.max(0, Math.min(100, Math.round(Number(intensity) || 60))),
      name: 'Intensity',
      type: 'float',
    },
  )

  return properties
}

function buildVfxImportNotes({
  effectLabel,
  exportTarget,
  frameCount,
  looping,
  previewStrategy,
  textures,
}) {
  const selectedOutputLabels = textures.map((texture) => getVfxTextureLabel(texture.kind))

  return [
    `Target Unity pipeline: URP. Preferred importer path: ${getVfxExportTargetLabel(exportTarget)}.`,
    `Effect label: ${effectLabel}.`,
    `Selected outputs: ${selectedOutputLabels.join(', ')}.`,
    `Looping: ${looping ? 'Yes' : 'No'}. Flipbook frame count: ${frameCount}.`,
    previewStrategy === 'flipbook-strip'
      ? 'The bundle includes flipbook content prepared as a horizontal sprite strip on a pure black background.'
      : 'The bundle contains standalone utility textures without a sprite-strip flipbook.',
    exportTarget === 'particle-system'
      ? 'Create a URP Particles Unlit material and bind the exported textures to the listed slots before tuning the particle system values.'
      : 'Use the exported VFX Graph property names as importer bindings; v1 does not emit a native .vfx asset.',
  ]
}

export function buildVfxForgePrompt({
  effectLabel,
  exportTarget,
  frameCount,
  hasStyleReference,
  intensity,
  looping,
  prompt,
  styleText,
  textureKind,
}) {
  const normalizedEffectLabel = normalizeEffectLabel(effectLabel)
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  const normalizedStyleText = typeof styleText === 'string' ? styleText.trim() : ''
  const normalizedFrameCount = Math.max(4, Math.min(30, Math.round(Number(frameCount) || 8)))
  const normalizedIntensity = Math.max(0, Math.min(100, Math.round(Number(intensity) || 60)))
  const exportTargetLine =
    exportTarget && exportTarget !== 'none'
      ? `Planned export target: ${getVfxExportTargetLabel(exportTarget)}.`
      : null
  const styleReferenceLine = hasStyleReference
    ? 'A style reference image is attached; match its rendering language, finish treatment, and palette energy.'
    : null

  if (textureKind === 'dissolve-mask') {
    return [
      'Generate a grayscale dissolve mask utility texture for a stylized game VFX effect.',
      `Effect label: ${normalizedEffectLabel}.`,
      'Use a clean black background with bright white breakup zones and readable value transitions.',
      looping ? 'Design the mask to support looping playback.' : 'Design the mask for a one-shot reveal and decay.',
      `Intensity target: ${normalizedIntensity} out of 100.`,
      exportTargetLine,
      styleReferenceLine,
      normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
      normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (textureKind === 'flipbook') {
    return [
      'Generate a stylized 2D VFX flipbook for game-ready sprite sheet usage.',
      `Effect label: ${normalizedEffectLabel}.`,
      `Layout: exactly ${normalizedFrameCount} frames in one horizontal row.`,
      'Each frame must stay fully inside its own equally sized slot.',
      'Do not overlap adjacent frames, stack frames vertically, or turn the strip into one continuous panorama.',
      'Use a pure #000000 black background and bright additive-friendly energy.',
      looping
        ? 'Make the first and last frames connect cleanly for looping playback.'
        : 'Show a clear one-shot arc from birth through peak energy into dissipation.',
      `Intensity target: ${normalizedIntensity} out of 100.`,
      exportTargetLine,
      styleReferenceLine,
      normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
      normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (textureKind === 'swirl') {
    return [
      'Generate a stylized swirl utility texture for a game VFX effect.',
      `Effect label: ${normalizedEffectLabel}.`,
      'Fill the frame with readable directional energy and clean negative space, without scene objects.',
      looping ? 'Make the texture read cleanly in a looping scroll.' : 'Allow the motion language to feel directional and event-driven.',
      `Intensity target: ${normalizedIntensity} out of 100.`,
      exportTargetLine,
      styleReferenceLine,
      normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
      normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return [
    'Generate a stylized breakup noise utility texture for a game VFX effect.',
    `Effect label: ${normalizedEffectLabel}.`,
    'Fill the frame with production-friendly breakup noise and no empty border.',
    looping ? 'Make the noise tile cleanly on both axes.' : 'The noise can prioritize dramatic breakup over perfect tiling.',
    `Intensity target: ${normalizedIntensity} out of 100.`,
    exportTargetLine,
    styleReferenceLine,
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
    normalizedStyleText ? `Style guidance: ${normalizedStyleText}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export function resolveVfxForgeSystemInstruction(
  customInstruction,
  { frameCount, looping, textureKind },
) {
  const normalizedFrameCount = Math.max(4, Math.min(30, Math.round(Number(frameCount) || 8)))
  const normalizedLooping = Boolean(looping)
  const textureRules =
    textureKind === 'flipbook'
      ? [
          'Generate a 2D effect flipbook on a pure #000000 black background.',
          `Layout: ${normalizedFrameCount} frames in a single horizontal row.`,
          'Each frame must be isolated inside an equally sized slot.',
          'Do not let the effect cross frame boundaries or read like one continuous panoramic image.',
          'Do not include props, characters, floor planes, or UI.',
          'Keep the effect centered with clean frame-to-frame timing.',
        ]
      : textureKind === 'dissolve-mask'
        ? [
            'Generate a grayscale utility texture only.',
            'Keep the image free of color and background props.',
            'Use black for empty space and bright values for breakup regions.',
          ]
        : textureKind === 'swirl'
          ? [
              'Generate a stylized swirl utility texture only.',
              'Do not stage the texture like a scene or illustration.',
              'Fill the frame with readable directional energy.',
            ]
          : [
              'Generate a stylized noise utility texture only.',
              'Do not stage the texture like a scene or illustration.',
              'Fill the frame with consistent production-friendly breakup.',
            ]

  return [
    'Never include text, logos, or watermarks in the image.',
    'Ensure the effect fills the intended frame without introducing scene composition.',
    normalizedLooping
      ? 'Bias the texture toward looping playback and seamless reuse.'
      : 'Bias the texture toward a one-shot event arc.',
    textureRules.join('\n'),
    customInstruction,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
}

export function buildVfxRecipeManifest(request) {
  const effectLabel = normalizeEffectLabel(request.effectLabel)
  const textures = [...request.textures]
    .sort(
      (left, right) => vfxTextureKinds.indexOf(left.kind) - vfxTextureKinds.indexOf(right.kind),
    )
    .map((texture) => ({
      fileName: buildTextureFileName(effectLabel, texture.kind),
      kind: texture.kind,
      materialSlots: [],
      mimeType: texture.mimeType,
      previewFileName: buildPreviewFileName(effectLabel, texture.kind),
    }))
  const textureSlots = buildTextureSlotMap(textures.map((texture) => texture.kind))

  textures.forEach((texture) => {
    texture.materialSlots = Object.entries(textureSlots)
      .filter(([, kind]) => kind === texture.kind)
      .map(([slot]) => slot)
  })

  const previewStrategy = resolveVfxPreviewStrategy(textures.map((texture) => texture.kind))
  const hasFlipbook = textures.some((texture) => texture.kind === 'flipbook')

  return {
    displayName: effectLabel,
    effectLabel,
    exportTarget: request.exportTarget,
    frameCount: request.frameCount,
    importNotes: buildVfxImportNotes({
      effectLabel,
      exportTarget: request.exportTarget,
      frameCount: request.frameCount,
      looping: request.looping,
      previewStrategy,
      textures,
    }),
    intensity: request.intensity,
    looping: request.looping,
    materialConfig: {
      blendMode: 'additive',
      materialKey: defaultMaterialKey,
      shader: defaultShader,
      textureBindings: textures.flatMap((texture) =>
        texture.materialSlots.map((slot) => ({
          fileName: texture.fileName,
          kind: texture.kind,
          slot,
        })),
      ),
    },
    particleSystemConfig: buildParticleSystemConfig({
      frameCount: request.frameCount,
      hasFlipbook,
      intensity: request.intensity,
      looping: request.looping,
    }),
    previewStrategy,
    prompt: request.prompt,
    recipeKind: 'generic',
    recipeVersion,
    textures,
    unityPipeline: request.unityPipeline,
    vfxGraphConfig: {
      exposedProperties: buildVfxGraphExposedProperties(textures, {
        intensity: request.intensity,
        looping: request.looping,
      }),
      frameCount: request.frameCount,
      intensity: request.intensity,
      looping: request.looping,
      template: defaultGraphTemplate,
    },
  }
}

export async function buildVfxExportBundle(request) {
  const effectLabel = normalizeEffectLabel(request.effectLabel)
  const recipeManifest = buildVfxRecipeManifest({
    ...request,
    effectLabel,
  })
  const zip = new JSZip()
  const previewEntries =
    request.previews.length > 0
      ? request.previews.map((preview, index) => ({
          data: preview.data,
          fileName: `preview/preview-${String(index + 1).padStart(2, '0')}.png`,
          label: preview.label || `Preview ${index + 1}`,
        }))
      : request.textures.map((texture) => ({
          data: texture.data,
          fileName: buildPreviewFileName(effectLabel, texture.kind),
          label: getVfxTextureLabel(texture.kind),
        }))

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        bundleKind: 'vfx-forge-export',
        effectLabel,
        exportTarget: request.exportTarget,
        previewFiles: previewEntries.map((entry) => entry.fileName),
        recipeFile: 'recipe.json',
        recipeVersion,
        textureFiles: recipeManifest.textures.map((texture) => texture.fileName),
        unityPipeline: request.unityPipeline,
      },
      null,
      2,
    ),
  )
  zip.file('recipe.json', JSON.stringify(recipeManifest, null, 2))

  request.textures.forEach((texture) => {
    zip.file(buildTextureFileName(effectLabel, texture.kind), texture.data, {
      base64: true,
    })
  })

  previewEntries.forEach((preview) => {
    zip.file(preview.fileName, preview.data, {
      base64: true,
    })
  })

  zip.file(
    'README.md',
    [
      '# VFX Forge Export Bundle',
      '',
      'This bundle contains generic Unity config data and generated texture ingredients.',
      '',
      'Included files:',
      '- `recipe.json`: generic Unity recipe manifest',
      '- `manifest.json`: bundle metadata',
      '- `textures/*.png`: generated effect textures',
      '- `preview/*.png`: preview images for quick inspection',
      '',
      'Import notes:',
      ...recipeManifest.importNotes.map((note) => `- ${note}`),
    ].join('\n'),
  )

  return zip.generateAsync({
    compression: 'DEFLATE',
    type: 'nodebuffer',
  })
}
