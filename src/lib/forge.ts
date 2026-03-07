import type { LucideIcon } from 'lucide-react'
import {
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
  | 'vfx-forge'
  | 'visualizer'
  | 'character-sheet'

export type ReferenceSlot = 'style' | 'subject'
export type CharacterSheetReferenceSlot = 'face' | 'outfit' | 'art-style'
export type CharacterSheetGenerationMode = 'reference' | 'manifest'
export type TextureLabWorkflow = 'generate' | 'expand'
export type TextureExpansionTargetSize = 1024 | 2048
export type GenerationCount = 1 | 2 | 3 | 4
export type ForgeStatus = 'idle' | 'loading' | 'success' | 'error'
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

export type ActionAnimatorState = {
  actionType: ActionAnimatorActionType
  characterImage: ReferenceAsset | null
  customActionPrompt: string
  frameCount: number
  fps: number
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
    instruction: 'seamless texture, flat lighting, 1024x1024',
    surfaceClassName:
      'from-emerald-400/16 via-slate-950/80 to-slate-950/95 ring-emerald-300/20',
    previewAspectClassName: 'aspect-[4/5]',
    previewImageClassName: 'object-cover',
    icon: Palette,
    focus: 'Stone, cloth, metal, terrain',
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
      'Turns a locked character image into a spritesheet-ready motion pass with evenly spaced frames.',
    instruction:
      '2D sprite animation sheet, side profile, feet locked to the same horizon, consistent lighting',
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

export const initialState: ForgeState = {
  activeMode: 'armory',
  actionAnimator: {
    actionType: 'idle',
    characterImage: null,
    customActionPrompt: '',
    frameCount: 8,
    fps: 8,
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
          expansionTargetSize: action.size,
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

export function clampIntensity(value: number) {
  if (value <= 0) {
    return 0
  }

  if (value >= 100) {
    return 100
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
