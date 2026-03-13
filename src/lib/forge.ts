import type { LucideIcon } from 'lucide-react'
import {
  Box,
  Camera,
  Clapperboard,
  Flame,
  Gem,
  Hammer,
  IdCard,
  Palette,
  ScanFace,
} from 'lucide-react'

export type ForgeMode =
  | 'armory'
  | 'action-animator'
  | 'loot-leveler'
  | 'portrait-studio'
  | 'texture-lab'
  | 'uv-lab'
  | 'vfx-forge'
  | 'visualizer'
  | 'character-sheet'

export type ReferenceSlot = 'style' | 'subject'
export type CharacterSheetReferenceSlot = 'face' | 'outfit' | 'art-style'
export type CharacterSheetGenerationMode = 'reference' | 'manifest'
export type TextureLabWorkflow = 'generate' | 'expand'
export type TextureExpansionTargetSize = 512 | 1024
export type UvLabAtlasSize = 1024 | 2048 | 4096
export type GenerationCount = 1 | 2 | 3 | 4
export type ForgeStatus = 'idle' | 'loading' | 'success' | 'error'
export type ModelFormat = 'obj' | 'fbx'
export type ActionAnimatorPipeline = 'sprite-strip' | 'veo-video'
export type ActionAnimatorNormalizedSize = 64 | 128 | 256 | 512 | 1080
export type ActionAnimatorActionType =
  | 'idle'
  | 'walk'
  | 'run'
  | 'attack'
  | 'jump'
  | 'custom'
export type LootLevelerRarity = 'common' | 'rare' | 'epic' | 'legendary'

export type ReferenceAsset = {
  file: File
  mimeType: string
  name: string
  sizeLabel: string
}

export type ImageValidationResult =
  | { asset: ReferenceAsset; ok: true }
  | { error: string; ok: false }

export type ModelAsset = {
  file: File
  format: ModelFormat
  mimeType: string
  name: string
  sizeLabel: string
}

export type ActionAnimatorState = {
  actionType: ActionAnimatorActionType
  characterImage: ReferenceAsset | null
  customActionPrompt: string
  frameCount: number
  fps: number
  normalizedSize: ActionAnimatorNormalizedSize
  pipeline: ActionAnimatorPipeline
}

export type CharacterSheetState = {
  consistencyEnabled: boolean
  generationMode: CharacterSheetGenerationMode
  manifestPrompt: string
  parentId: string | null
  references: Record<CharacterSheetReferenceSlot, ReferenceAsset | null>
  referencePrompt: string
}

export type TextureLabState = {
  expansionSource: ReferenceAsset | null
  expansionTargetSize: TextureExpansionTargetSize
  seamlessMode: boolean
  workflow: TextureLabWorkflow
}

export type LootLevelerState = {
  baseAsset: ReferenceAsset | null
  rarity: LootLevelerRarity
}

export type PortraitStudioState = {
  heroImage: ReferenceAsset | null
  prompt: string
}

export type VfxForgeState = {
  frameCount: number
  intensity: number
  prompt: string
  projectileType: string
}

export type UvLabState = {
  atlasSize: UvLabAtlasSize
  mesh: ModelAsset | null
  paddingPx: number
}

export type ForgeState = {
  activeMode: ForgeMode
  actionAnimator: ActionAnimatorState
  characterSheet: CharacterSheetState
  generationCount: GenerationCount
  lootLeveler: LootLevelerState
  portraitStudio: PortraitStudioState
  prompt: string
  references: Record<ReferenceSlot, ReferenceAsset | null>
  textureLab: TextureLabState
  uvLab: UvLabState
  vfxForge: VfxForgeState
}

export type ForgeAction =
  | { type: 'set-mode'; mode: ForgeMode }
  | { type: 'set-generation-count'; count: number }
  | { type: 'set-prompt'; prompt: string }
  | { type: 'set-reference'; slot: ReferenceSlot; asset: ReferenceAsset | null }
  | { type: 'set-action-animator-image'; asset: ReferenceAsset | null }
  | { type: 'set-action-animator-action'; actionType: ActionAnimatorActionType }
  | { type: 'set-action-animator-custom-prompt'; prompt: string }
  | { type: 'set-action-animator-frame-count'; frameCount: number }
  | { type: 'set-action-animator-fps'; fps: number }
  | { type: 'set-action-animator-normalized-size'; size: ActionAnimatorNormalizedSize }
  | { type: 'set-action-animator-pipeline'; pipeline: ActionAnimatorPipeline }
  | { type: 'set-character-sheet-mode'; mode: CharacterSheetGenerationMode }
  | { type: 'set-character-sheet-manifest'; prompt: string }
  | { type: 'set-character-sheet-reference-prompt'; prompt: string }
  | {
      type: 'set-character-sheet-reference'
      slot: CharacterSheetReferenceSlot
      asset: ReferenceAsset | null
    }
  | { type: 'set-character-sheet-consistency'; enabled: boolean }
  | { type: 'set-character-sheet-parent-id'; parentId: string | null }
  | { type: 'set-texture-lab-workflow'; workflow: TextureLabWorkflow }
  | { type: 'set-texture-expansion-source'; asset: ReferenceAsset | null }
  | { type: 'set-texture-lab-seamless-mode'; enabled: boolean }
  | {
      type: 'set-texture-expansion-target-size'
      size: TextureExpansionTargetSize
    }
  | { type: 'set-loot-leveler-asset'; asset: ReferenceAsset | null }
  | { type: 'set-loot-leveler-rarity'; rarity: LootLevelerRarity }
  | { type: 'set-portrait-studio-image'; asset: ReferenceAsset | null }
  | { type: 'set-portrait-studio-prompt'; prompt: string }
  | { type: 'set-vfx-frame-count'; frameCount: number }
  | { type: 'set-vfx-projectile-type'; projectileType: string }
  | { type: 'set-vfx-intensity'; intensity: number }
  | { type: 'set-vfx-prompt'; prompt: string }
  | { type: 'set-uv-lab-mesh'; asset: ModelAsset | null }
  | { type: 'set-uv-lab-atlas-size'; size: UvLabAtlasSize }
  | { type: 'set-uv-lab-padding-px'; paddingPx: number }

export type ModeDefinition = {
  description: string
  eyebrow: string
  focus: string
  icon: LucideIcon
  instruction: string
  label: string
  previewAspectClassName: string
  previewImageClassName: string
  surfaceClassName: string
}

export type ForgeResult = {
  dataUrl: string
  id: string
  mimeType: string
  paletteHexes?: string[]
  text?: string
}

export type ForgeErrorInfo = {
  code?: string
  details?: string[]
  message: string
  retryAfterSeconds?: number
  title: string
}

export const modeDefinitions: Record<ForgeMode, ModeDefinition> = {
  armory: {
    label: 'Armory',
    eyebrow: 'Assets',
    description:
      'Focused on 2D isometric and front-facing game assets with sharp silhouettes.',
    instruction: '2D game asset, transparent-style background, thick outlines',
    surfaceClassName:
      'from-sky-500/18 via-slate-950/80 to-slate-950/95 ring-sky-400/20',
    previewAspectClassName: 'aspect-[4/5]',
    previewImageClassName: 'object-cover',
    icon: Hammer,
    focus: 'Weapons, props, equipables',
  },
  'texture-lab': {
    label: 'Texture Lab',
    eyebrow: 'Tiles',
    description:
      'Focused on square, top-down, seamless surfaces with controlled lighting.',
    instruction: 'square top-down material texture, flat lighting, tile-safe edges',
    surfaceClassName:
      'from-emerald-400/16 via-slate-950/80 to-slate-950/95 ring-emerald-300/20',
    previewAspectClassName: 'aspect-square',
    previewImageClassName: 'object-cover',
    icon: Palette,
    focus: 'Stone, cloth, metal, terrain',
  },
  'uv-lab': {
    label: 'UV Lab',
    eyebrow: 'Meshes',
    description:
      'Focused on automatic UV unwrap and packing for production meshes with paired 3D and atlas review.',
    instruction: 'Automatic UV unwrap, atlas packing, and downloadable mesh export',
    surfaceClassName:
      'from-amber-200/14 via-slate-950/80 to-slate-950/95 ring-amber-100/20',
    previewAspectClassName: 'aspect-[4/3]',
    previewImageClassName: 'object-contain',
    icon: Box,
    focus: 'OBJ and FBX unwrap, packing, atlas review',
  },
  'character-sheet': {
    label: 'Character Sheet',
    eyebrow: 'Sheets',
    description:
      'Focused on multi-view production sheets that lock identity, outfit, and line language into a single presentation.',
    instruction:
      '16:9 character sheet, front profile rear views, gray background, thick line art, cel-shaded',
    surfaceClassName:
      'from-rose-400/14 via-slate-950/80 to-slate-950/95 ring-rose-300/20',
    previewAspectClassName: 'aspect-[16/9]',
    previewImageClassName: 'object-cover',
    icon: IdCard,
    focus: 'Identity, outfit, turnaround',
  },
  'action-animator': {
    label: 'Action Animator',
    eyebrow: 'Motion',
    description:
      'Turns one approved sprite frame into a normalized motion strip, with Veo fallback for looser motion work.',
    instruction:
      '2D sprite strip from a seed frame, shared scale normalization, feet locked to the same horizon',
    surfaceClassName:
      'from-cyan-400/18 via-slate-950/80 to-slate-950/95 ring-cyan-300/20',
    previewAspectClassName: 'aspect-[8/1]',
    previewImageClassName: 'object-contain',
    icon: Clapperboard,
    focus: 'Sprite sheets, motion loops, frame timing',
  },
  'loot-leveler': {
    label: 'Loot Leveler',
    eyebrow: 'Progression',
    description:
      'Applies controlled rarity upgrades while keeping the original asset silhouette and weapon identity intact.',
    instruction:
      'Maintain silhouette and core geometry, apply rarity-driven upgrades without changing the weapon type',
    surfaceClassName:
      'from-amber-300/18 via-slate-950/80 to-slate-950/95 ring-amber-200/20',
    previewAspectClassName: 'aspect-[4/5]',
    previewImageClassName: 'object-cover',
    icon: Gem,
    focus: 'Rarity tiers, upgrades, identity-preserving variants',
  },
  'portrait-studio': {
    label: 'Portrait Studio',
    eyebrow: 'Expressions',
    description:
      'Builds expression packs that keep the same face, hair, and eye identity across a production grid.',
    instruction:
      'Expression sheet, 3 columns by 2 rows, identical facial structure and styling across all portraits',
    surfaceClassName:
      'from-fuchsia-300/16 via-slate-950/80 to-slate-950/95 ring-fuchsia-200/20',
    previewAspectClassName: 'aspect-[3/2]',
    previewImageClassName: 'object-cover',
    icon: ScanFace,
    focus: 'Expression packs, face consistency, hero portraits',
  },
  'vfx-forge': {
    label: 'VFX Forge',
    eyebrow: 'Effects',
    description:
      'Generates horizontal projectile sheets with additive-friendly black backgrounds and clear effect timing.',
    instruction:
      '2D projectile spritesheet, pure black background, 8 horizontal frames, soft glowing particle edges',
    surfaceClassName:
      'from-orange-400/16 via-slate-950/80 to-slate-950/95 ring-orange-300/20',
    previewAspectClassName: 'aspect-[8/1]',
    previewImageClassName: 'object-contain',
    icon: Flame,
    focus: 'Projectile loops, FX timing, engine-ready sheets',
  },
  visualizer: {
    label: 'Visualizer',
    eyebrow: 'Scenes',
    description:
      'Focused on cinematic concept imagery, character sheets, and reference photography.',
    instruction: '8k resolution, cinematic lighting, concept art',
    surfaceClassName:
      'from-amber-300/14 via-slate-950/80 to-slate-950/95 ring-amber-200/20',
    previewAspectClassName: 'aspect-[4/5]',
    previewImageClassName: 'object-cover',
    icon: Camera,
    focus: 'Hero shots, callouts, mood frames',
  },
}

export const actionAnimatorStripNormalizedSizes = [64, 128, 256, 512] as const
export const actionAnimatorVideoFrameSizes = [512, 1080] as const

export const initialState: ForgeState = {
  activeMode: 'armory',
  actionAnimator: {
    actionType: 'idle',
    characterImage: null,
    customActionPrompt: '',
    frameCount: 8,
    fps: 8,
    normalizedSize: 64,
    pipeline: 'sprite-strip',
  },
  generationCount: 3,
  lootLeveler: {
    baseAsset: null,
    rarity: 'common',
  },
  portraitStudio: {
    heroImage: null,
    prompt: '',
  },
  prompt: '',
  references: {
    style: null,
    subject: null,
  },
  textureLab: {
    expansionSource: null,
    expansionTargetSize: 1024,
    seamlessMode: false,
    workflow: 'generate',
  },
  uvLab: {
    atlasSize: 2048,
    mesh: null,
    paddingPx: 8,
  },
  characterSheet: {
    consistencyEnabled: false,
    generationMode: 'reference',
    manifestPrompt: '',
    parentId: null,
    references: {
      'art-style': null,
      face: null,
      outfit: null,
    },
    referencePrompt: '',
  },
  vfxForge: {
    frameCount: 8,
    intensity: 60,
    prompt: '',
    projectileType: 'Fireball',
  },
}

export function forgeReducer(state: ForgeState, action: ForgeAction): ForgeState {
  switch (action.type) {
    case 'set-mode':
      return {
        ...state,
        activeMode: action.mode,
      }
    case 'set-generation-count':
      return {
        ...state,
        generationCount: clampGenerationCount(action.count),
      }
    case 'set-prompt':
      return {
        ...state,
        prompt: action.prompt,
      }
    case 'set-reference':
      return {
        ...state,
        references: {
          ...state.references,
          [action.slot]: action.asset,
        },
      }
    case 'set-action-animator-image':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          characterImage: action.asset,
        },
      }
    case 'set-action-animator-action':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          actionType: action.actionType,
        },
      }
    case 'set-action-animator-custom-prompt':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          customActionPrompt: action.prompt,
        },
      }
    case 'set-action-animator-frame-count':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          frameCount: clampFrameCount(action.frameCount),
        },
      }
    case 'set-action-animator-fps':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          fps: clampActionAnimatorFps(action.fps),
        },
      }
    case 'set-action-animator-normalized-size':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          normalizedSize: clampActionAnimatorNormalizedSize(
            action.size,
            state.actionAnimator.pipeline,
          ),
        },
      }
    case 'set-action-animator-pipeline':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          pipeline: action.pipeline,
          normalizedSize: clampActionAnimatorNormalizedSize(
            state.actionAnimator.normalizedSize,
            action.pipeline,
          ),
        },
      }
    case 'set-texture-lab-workflow':
      return {
        ...state,
        textureLab: {
          ...state.textureLab,
          workflow: action.workflow,
        },
      }
    case 'set-texture-expansion-source':
      return {
        ...state,
        textureLab: {
          ...state.textureLab,
          expansionSource: action.asset,
        },
      }
    case 'set-texture-lab-seamless-mode':
      return {
        ...state,
        textureLab: {
          ...state.textureLab,
          seamlessMode: action.enabled,
        },
      }
    case 'set-texture-expansion-target-size':
      return {
        ...state,
        textureLab: {
          ...state.textureLab,
          expansionTargetSize: clampTextureLabOutputSize(action.size),
        },
      }
    case 'set-loot-leveler-asset':
      return {
        ...state,
        lootLeveler: {
          ...state.lootLeveler,
          baseAsset: action.asset,
        },
      }
    case 'set-loot-leveler-rarity':
      return {
        ...state,
        lootLeveler: {
          ...state.lootLeveler,
          rarity: action.rarity,
        },
      }
    case 'set-portrait-studio-image':
      return {
        ...state,
        portraitStudio: {
          ...state.portraitStudio,
          heroImage: action.asset,
        },
      }
    case 'set-portrait-studio-prompt':
      return {
        ...state,
        portraitStudio: {
          ...state.portraitStudio,
          prompt: action.prompt,
        },
      }
    case 'set-vfx-projectile-type':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          projectileType: action.projectileType,
        },
      }
    case 'set-vfx-frame-count':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          frameCount: clampFrameCount(action.frameCount),
        },
      }
    case 'set-vfx-intensity':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          intensity: clampIntensity(action.intensity),
        },
      }
    case 'set-vfx-prompt':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          prompt: action.prompt,
        },
      }
    case 'set-uv-lab-mesh':
      return {
        ...state,
        uvLab: {
          ...state.uvLab,
          mesh: action.asset,
        },
      }
    case 'set-uv-lab-atlas-size':
      return {
        ...state,
        uvLab: {
          ...state.uvLab,
          atlasSize: clampUvAtlasSize(action.size),
        },
      }
    case 'set-uv-lab-padding-px':
      return {
        ...state,
        uvLab: {
          ...state.uvLab,
          paddingPx: clampUvPaddingPx(action.paddingPx),
        },
      }
    case 'set-character-sheet-mode':
      return {
        ...state,
        characterSheet: {
          ...state.characterSheet,
          generationMode: action.mode,
        },
      }
    case 'set-character-sheet-manifest':
      return {
        ...state,
        characterSheet: {
          ...state.characterSheet,
          manifestPrompt: action.prompt,
        },
      }
    case 'set-character-sheet-reference-prompt':
      return {
        ...state,
        characterSheet: {
          ...state.characterSheet,
          referencePrompt: action.prompt,
        },
      }
    case 'set-character-sheet-reference':
      return {
        ...state,
        characterSheet: {
          ...state.characterSheet,
          references: {
            ...state.characterSheet.references,
            [action.slot]: action.asset,
          },
        },
      }
    case 'set-character-sheet-consistency':
      return {
        ...state,
        characterSheet: {
          ...state.characterSheet,
          consistencyEnabled: action.enabled,
        },
      }
    case 'set-character-sheet-parent-id':
      return {
        ...state,
        characterSheet: {
          ...state.characterSheet,
          parentId: action.parentId,
        },
      }
    default:
      return state
  }
}

export function clampGenerationCount(value: number): GenerationCount {
  if (value <= 1) {
    return 1
  }

  if (value >= 4) {
    return 4
  }

  return value as GenerationCount
}

export function clampFrameCount(value: number) {
  if (value <= 4) {
    return 4
  }

  if (value >= 30) {
    return 30
  }

  return Math.round(value)
}

export function clampActionAnimatorFps(value: number) {
  if (value <= 1) {
    return 1
  }

  if (value >= 30) {
    return 30
  }

  return Math.round(value)
}

export function clampActionAnimatorNormalizedSize(
  value: number,
  pipeline: ActionAnimatorPipeline = 'sprite-strip',
): ActionAnimatorNormalizedSize {
  if (pipeline === 'veo-video') {
    return Number(value) === 1080 ? 1080 : 512
  }

  const normalizedValue = Number.isFinite(value) ? value : 64
  let nearestSize: ActionAnimatorNormalizedSize = actionAnimatorStripNormalizedSizes[0]
  let nearestDistance = Math.abs(normalizedValue - nearestSize)

  for (const candidate of actionAnimatorStripNormalizedSizes.slice(1)) {
    const candidateDistance = Math.abs(normalizedValue - candidate)

    if (candidateDistance < nearestDistance) {
      nearestSize = candidate
      nearestDistance = candidateDistance
    }
  }

  return nearestSize
}

export function getActionAnimatorNormalizedSizeOptions(
  pipeline: ActionAnimatorPipeline,
): readonly ActionAnimatorNormalizedSize[] {
  return pipeline === 'veo-video'
    ? actionAnimatorVideoFrameSizes
    : actionAnimatorStripNormalizedSizes
}

export function clampIntensity(value: number) {
  if (value <= 0) {
    return 0
  }

  if (value >= 100) {
    return 100
  }

  return Math.round(value)
}

export function clampUvAtlasSize(value: number): UvLabAtlasSize {
  if (value >= 4096) {
    return 4096
  }

  if (value <= 1024) {
    return 1024
  }

  return 2048
}

export function clampTextureLabOutputSize(
  value: number,
): TextureExpansionTargetSize {
  if (value <= 512) {
    return 512
  }

  return 1024
}

export function clampUvPaddingPx(value: number) {
  if (value <= 0) {
    return 0
  }

  if (value >= 64) {
    return 64
  }

  return Math.round(value)
}

export function composePrompt(state: ForgeState): string {
  const activeMode = modeDefinitions[state.activeMode]
  const prompt = state.prompt.trim()

  if (!prompt) {
    return activeMode.instruction
  }

  return `${prompt}. ${activeMode.instruction}`
}

export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeInBytes / 1024))} KB`
  }

  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function toReferenceAsset(file: File): ReferenceAsset {
  return {
    file,
    mimeType: file.type || 'image/png',
    name: file.name,
    sizeLabel: formatFileSize(file.size),
  }
}

export const maxReferenceImageBytes = 10 * 1024 * 1024
export const allowedReferenceImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export async function validateReferenceImageUpload(
  file: File,
  maxBytes = maxReferenceImageBytes,
): Promise<ImageValidationResult> {
  if (!allowedReferenceImageMimeTypes.has(file.type)) {
    return {
      error: 'Only PNG, JPEG, and WebP images are supported.',
      ok: false,
    }
  }

  if (file.size > maxBytes) {
    return {
      error: `Images must be ${Math.round(Math.max(1, maxBytes / (1024 * 1024)))} MB or smaller.`,
      ok: false,
    }
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve()
      image.onerror = () =>
        reject(new Error('The selected image could not be decoded in this browser.'))
      image.src = objectUrl
    })

    return {
      asset: toReferenceAsset(file),
      ok: true,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'The selected image could not be decoded in this browser.',
      ok: false,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function detectModelFormat(fileName: string): ModelFormat | null {
  const normalizedName = fileName.trim().toLowerCase()

  if (normalizedName.endsWith('.obj')) {
    return 'obj'
  }

  if (normalizedName.endsWith('.fbx')) {
    return 'fbx'
  }

  return null
}

export function toModelAsset(file: File): ModelAsset {
  const format = detectModelFormat(file.name)

  if (!format) {
    throw new Error('UV Lab only accepts .obj or .fbx files.')
  }

  return {
    file,
    format,
    mimeType: file.type || 'application/octet-stream',
    name: file.name,
    sizeLabel: formatFileSize(file.size),
  }
}
