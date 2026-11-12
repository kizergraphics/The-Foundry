import { textureDefaults } from '../../shared/textureLab.js'
import type { TextureSettings, TextureMetadata } from '../../shared/textureLab.js'
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
import type { ForgeMode } from '../../shared/modeCatalog.js'
import {
  getVariantForgePresetOptions,
  isVariantForgePresetForFamily,
  variantForgeDefaultPresetByFamily,
  variantForgeFamilies,
  variantForgePresetCatalog,
} from '../../shared/variantForgeCatalog.js'
import {
  defaultVfxExportTarget,
  defaultVfxFrameCount,
  defaultVfxIntensity,
  defaultVfxLooping,
  getDefaultVfxTextureOutputs,
  type VfxExportTarget,
  type VfxTextureKind,
} from '../../shared/vfxForgeCatalog.js'
import type {
  VariantForgeFamily,
  VariantForgePreset,
  VariantForgeRarityPreset,
} from '../../shared/variantForgeCatalog.js'
export type { ForgeMode } from '../../shared/modeCatalog.js'
export type {
  VariantForgeFamily,
  VariantForgePreset,
  VariantForgeRarityPreset,
} from '../../shared/variantForgeCatalog.js'
export type {
  VfxExportTarget,
  VfxTextureKind,
} from '../../shared/vfxForgeCatalog.js'

export type ReferenceSlot = 'style' | 'subject'
export type CharacterSheetReferenceSlot = 'face' | 'outfit' | 'art-style'
export type CharacterSheetGenerationMode = 'reference' | 'manifest'
export type TextureLabWorkflow = 'expand'
export type TextureExpansionTargetSize = 512 | 1024
export type UvLabAtlasSize = 1024 | 2048 | 4096
export type GenerationCount = 1 | 2 | 3 | 4
export type ForgeStatus = 'idle' | 'loading' | 'success' | 'error'
export type ModelFormat = 'obj' | 'fbx'
export type ActionAnimatorPipeline = 'veo-video' | 'image-strip'
export type ActionAnimatorKeyColor = 'green' | 'blue'
export type ActionAnimatorNormalizedSize = 512 | 1080
export type OpenAiImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type ActionAnimatorActionType =
  | 'idle'
  | 'walk'
  | 'run'
  | 'attack'
  | 'jump'
  | 'custom'
export type LootLevelerRarity = VariantForgeRarityPreset
export type VariantForgeOptionState = {
  customSetting: string
  enabled: boolean
}
export type VariantForgeFamilyCustomDirectionMap = Partial<
  Record<VariantForgeFamily, string>
>
export type VariantForgeOptionStateMap = Partial<
  Record<VariantForgePreset, VariantForgeOptionState>
>

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
  firstFrameGuide: ReferenceAsset | null
  fps: number
  keyColor: ActionAnimatorKeyColor
  lastFrameGuide: ReferenceAsset | null
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
  settings: TextureSettings
  expansionSource: ReferenceAsset | null
  expansionTargetSize: TextureExpansionTargetSize
  seamlessMode: boolean
  workflow: TextureLabWorkflow
}

export type VariantForgeState = {
  baseAsset: ReferenceAsset | null
  familyCustomDirections: VariantForgeFamilyCustomDirectionMap
  intensity: number
  optionStates: VariantForgeOptionStateMap
  preservePalette: boolean
  preserveSilhouette: boolean
  variantFamily: VariantForgeFamily
  variantPreset: VariantForgePreset
}

export type PortraitStudioState = {
  heroImage: ReferenceAsset | null
  prompt: string
}

export type VfxForgeState = {
  effectLabel: string
  exportTarget: VfxExportTarget
  frameCount: number
  intensity: number
  looping: boolean
  prompt: string
  textureOutputs: VfxTextureKind[]
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
  portraitStudio: PortraitStudioState
  prompt: string
  references: Record<ReferenceSlot, ReferenceAsset | null>
  textureLab: TextureLabState
  uvLab: UvLabState
  variantForge: VariantForgeState
  vfxForge: VfxForgeState
}

export type ForgeAction =
  | { type: 'hydrate'; state: ForgeState }
  | { type: 'set-mode'; mode: ForgeMode }
  | { type: 'set-generation-count'; count: number }
  | { type: 'set-prompt'; prompt: string }
  | { type: 'set-reference'; slot: ReferenceSlot; asset: ReferenceAsset | null }
  | { type: 'set-action-animator-image'; asset: ReferenceAsset | null }
  | { type: 'set-action-animator-action'; actionType: ActionAnimatorActionType }
  | { type: 'set-action-animator-custom-prompt'; prompt: string }
  | { type: 'set-action-animator-frame-count'; frameCount: number }
  | { type: 'set-action-animator-first-frame-guide'; asset: ReferenceAsset | null }
  | { type: 'set-action-animator-fps'; fps: number }
  | { type: 'set-action-animator-key-color'; keyColor: ActionAnimatorKeyColor }
  | { type: 'set-action-animator-last-frame-guide'; asset: ReferenceAsset | null }
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
  | { type: 'set-texture-settings'; settings: Partial<TextureSettings> }
  | { type: 'set-texture-expansion-source'; asset: ReferenceAsset | null }
  | { type: 'set-texture-lab-seamless-mode'; enabled: boolean }
  | {
      type: 'set-texture-expansion-target-size'
      size: TextureExpansionTargetSize
    }
  | { type: 'set-variant-forge-asset'; asset: ReferenceAsset | null }
  | { type: 'set-variant-forge-family'; family: VariantForgeFamily }
  | { type: 'set-variant-forge-preset'; preset: VariantForgePreset }
  | { type: 'toggle-variant-forge-preset'; preset: VariantForgePreset }
  | {
      type: 'set-variant-forge-preset-custom-setting'
      preset: VariantForgePreset
      customSetting: string
    }
  | { type: 'set-variant-forge-intensity'; intensity: number }
  | { type: 'set-variant-forge-preserve-silhouette'; enabled: boolean }
  | { type: 'set-variant-forge-preserve-palette'; enabled: boolean }
  | { type: 'set-variant-forge-custom-direction'; customDirection: string }
  | { type: 'set-portrait-studio-image'; asset: ReferenceAsset | null }
  | { type: 'set-portrait-studio-prompt'; prompt: string }
  | { type: 'set-vfx-effect-label'; effectLabel: string }
  | { type: 'set-vfx-export-target'; exportTarget: VfxExportTarget }
  | { type: 'set-vfx-frame-count'; frameCount: number }
  | { type: 'set-vfx-intensity'; intensity: number }
  | { type: 'set-vfx-looping'; enabled: boolean }
  | { type: 'set-vfx-prompt'; prompt: string }
  | { type: 'set-vfx-texture-output'; kind: VfxTextureKind; enabled: boolean }
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
  texture?: TextureMetadata
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
      'Turns a locked character image into a video-based motion strip for quick animation blocking.',
    instruction:
      '2D side-view animation strip, locked camera, consistent scale, readable motion spacing',
    surfaceClassName:
      'from-cyan-400/18 via-slate-950/80 to-slate-950/95 ring-cyan-300/20',
    previewAspectClassName: 'aspect-[8/1]',
    previewImageClassName: 'object-contain',
    icon: Clapperboard,
    focus: 'Motion strips, animation loops, frame timing',
  },
  'variant-forge': {
    label: 'Variant Forge',
    eyebrow: 'Progression',
    description:
      'Applies controlled single-asset transformations while keeping the base item identity intact.',
    instruction:
      'Maintain silhouette and core geometry, transform finish, material, and story cues without changing the item type',
    surfaceClassName:
      'from-amber-300/18 via-slate-950/80 to-slate-950/95 ring-amber-200/20',
    previewAspectClassName: 'aspect-[4/5]',
    previewImageClassName: 'object-cover',
    icon: Gem,
    focus: 'Damage, elemental, tech, rarity, and boss-tier variants',
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
      'Builds URP-first VFX texture ingredients plus typed Unity recipe bundles for 3D-space effects.',
    instruction:
      'Generate effect textures for URP particle systems and VFX Graph setups, then export a typed recipe bundle with importer hints.',
    surfaceClassName:
      'from-orange-400/16 via-slate-950/80 to-slate-950/95 ring-orange-300/20',
    previewAspectClassName: 'aspect-[8/1]',
    previewImageClassName: 'object-contain',
    icon: Flame,
    focus: 'Projectile, explosion, portal, and beam recipes for URP',
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

export const actionAnimatorVideoFrameSizes = [512, 1080] as const
export const openAiImageQualityOptions = ['auto', 'low', 'medium', 'high'] as const

export function isOpenAiImageQuality(value: unknown): value is OpenAiImageQuality {
  return typeof value === 'string' && openAiImageQualityOptions.includes(value as OpenAiImageQuality)
}

export function getDefaultOpenAiImageQualityForMode(
  mode: ForgeMode,
): OpenAiImageQuality {
  return mode === 'character-sheet' ? 'low' : 'auto'
}

function buildVariantForgeOptionState(enabled = false, customSetting = ''): VariantForgeOptionState {
  return {
    customSetting,
    enabled,
  }
}

function ensureVariantForgeFamilyHasActivePreset(
  family: VariantForgeFamily,
  optionStates: VariantForgeOptionStateMap,
  preferredPreset: VariantForgePreset = variantForgeDefaultPresetByFamily[family],
) {
  const enabledPresets = getVariantForgePresetOptions(family).filter(
    (preset) => optionStates[preset]?.enabled,
  )

  if (enabledPresets.length > 0) {
    return {
      optionStates,
      variantPreset: enabledPresets.includes(preferredPreset) ? preferredPreset : enabledPresets[0],
    }
  }

  return {
    optionStates,
    variantPreset: preferredPreset,
  }
}

export function getVariantForgeOptionState(
  optionStates: VariantForgeOptionStateMap,
  preset: VariantForgePreset,
): VariantForgeOptionState {
  return optionStates[preset] ?? buildVariantForgeOptionState(false)
}

export function getVariantForgeFamilyCustomDirection(
  family: VariantForgeFamily,
  familyCustomDirections: VariantForgeFamilyCustomDirectionMap,
): string {
  return typeof familyCustomDirections[family] === 'string'
    ? familyCustomDirections[family]
    : ''
}

export function getVariantForgeEnabledPresets(
  family: VariantForgeFamily,
  optionStates: VariantForgeOptionStateMap,
): VariantForgePreset[] {
  return getVariantForgePresetOptions(family).filter((preset) => optionStates[preset]?.enabled)
}

export {
  getVariantForgePresetOptions,
  variantForgeDefaultPresetByFamily,
  variantForgeFamilies,
  variantForgePresetCatalog,
}

export const initialState: ForgeState = {
  activeMode: 'armory',
  actionAnimator: {
    actionType: 'idle',
    characterImage: null,
    customActionPrompt: '',
    frameCount: 8,
    firstFrameGuide: null,
    fps: 8,
    keyColor: 'green',
    lastFrameGuide: null,
    normalizedSize: 512,
    pipeline: 'veo-video',
  },
  generationCount: 3,
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
    settings: { ...textureDefaults },
    expansionSource: null,
    expansionTargetSize: 1024,
    seamlessMode: false,
    workflow: 'expand',
  },
  uvLab: {
    atlasSize: 2048,
    mesh: null,
    paddingPx: 8,
  },
  variantForge: {
    baseAsset: null,
    familyCustomDirections: {},
    intensity: 60,
    optionStates: {
      worn: buildVariantForgeOptionState(true),
    },
    preservePalette: false,
    preserveSilhouette: true,
    variantFamily: 'damage',
    variantPreset: 'worn',
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
    effectLabel: '',
    exportTarget: defaultVfxExportTarget,
    frameCount: defaultVfxFrameCount,
    intensity: defaultVfxIntensity,
    looping: defaultVfxLooping,
    prompt: '',
    textureOutputs: getDefaultVfxTextureOutputs(),
  },
}

export function forgeReducer(state: ForgeState, action: ForgeAction): ForgeState {
  switch (action.type) {
    case 'hydrate':
      return action.state
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
    case 'set-action-animator-first-frame-guide':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          firstFrameGuide: action.asset,
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
    case 'set-action-animator-key-color':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          keyColor: action.keyColor,
        },
      }
    case 'set-action-animator-last-frame-guide':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          lastFrameGuide: action.asset,
        },
      }
    case 'set-action-animator-normalized-size':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          normalizedSize: clampActionAnimatorNormalizedSize(action.size),
        },
      }
    case 'set-action-animator-pipeline':
      return {
        ...state,
        actionAnimator: {
          ...state.actionAnimator,
          normalizedSize: clampActionAnimatorNormalizedSize(state.actionAnimator.normalizedSize),
          pipeline: action.pipeline,
        },
      }
    case 'set-texture-settings':
      return { ...state, textureLab: { ...state.textureLab, settings: { ...state.textureLab.settings, ...action.settings } } }
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
    case 'set-variant-forge-asset':
      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          baseAsset: action.asset,
        },
      }
    case 'set-variant-forge-family':
      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          ...ensureVariantForgeFamilyHasActivePreset(
            action.family,
            state.variantForge.optionStates,
            variantForgeDefaultPresetByFamily[action.family],
          ),
          variantFamily: action.family,
        },
      }
    case 'set-variant-forge-preset':
      if (!isVariantForgePresetForFamily(state.variantForge.variantFamily, action.preset)) {
        return {
          ...state,
          variantForge: {
            ...state.variantForge,
            variantPreset: variantForgeDefaultPresetByFamily[state.variantForge.variantFamily],
          },
        }
      }

      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          optionStates: {
            ...state.variantForge.optionStates,
            [action.preset]: buildVariantForgeOptionState(
              true,
              state.variantForge.optionStates[action.preset]?.customSetting ?? '',
            ),
          },
          variantPreset: action.preset,
        },
      }
    case 'toggle-variant-forge-preset':
      if (!isVariantForgePresetForFamily(state.variantForge.variantFamily, action.preset)) {
        return state
      }

      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          ...ensureVariantForgeFamilyHasActivePreset(
            state.variantForge.variantFamily,
            {
              ...state.variantForge.optionStates,
              [action.preset]: buildVariantForgeOptionState(
                !state.variantForge.optionStates[action.preset]?.enabled,
                state.variantForge.optionStates[action.preset]?.customSetting ?? '',
              ),
            },
            state.variantForge.variantPreset === action.preset
              ? variantForgeDefaultPresetByFamily[state.variantForge.variantFamily]
              : state.variantForge.variantPreset,
          ),
        },
      }
    case 'set-variant-forge-preset-custom-setting':
      if (!isVariantForgePresetForFamily(state.variantForge.variantFamily, action.preset)) {
        return state
      }

      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          optionStates: {
            ...state.variantForge.optionStates,
            [action.preset]: buildVariantForgeOptionState(
              state.variantForge.optionStates[action.preset]?.enabled ?? false,
              action.customSetting,
            ),
          },
        },
      }
    case 'set-variant-forge-intensity':
      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          intensity: clampIntensity(action.intensity),
        },
      }
    case 'set-variant-forge-preserve-silhouette':
      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          preserveSilhouette: action.enabled,
        },
      }
    case 'set-variant-forge-preserve-palette':
      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          preservePalette: action.enabled,
        },
      }
    case 'set-variant-forge-custom-direction':
      return {
        ...state,
        variantForge: {
          ...state.variantForge,
          familyCustomDirections: {
            ...state.variantForge.familyCustomDirections,
            [state.variantForge.variantFamily]: action.customDirection,
          },
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
    case 'set-vfx-effect-label':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          effectLabel: action.effectLabel,
        },
      }
    case 'set-vfx-export-target':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          exportTarget: action.exportTarget,
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
    case 'set-vfx-looping':
      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          looping: action.enabled,
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
    case 'set-vfx-texture-output': {
      const nextTextureOutputs = action.enabled
        ? Array.from(new Set([...state.vfxForge.textureOutputs, action.kind]))
        : state.vfxForge.textureOutputs.filter((kind) => kind !== action.kind)

      return {
        ...state,
        vfxForge: {
          ...state.vfxForge,
          textureOutputs: nextTextureOutputs,
        },
      }
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
): ActionAnimatorNormalizedSize {
  return Number(value) === 1080 ? 1080 : 512
}

export function getActionAnimatorNormalizedSizeOptions(): readonly ActionAnimatorNormalizedSize[] {
  return actionAnimatorVideoFrameSizes
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
