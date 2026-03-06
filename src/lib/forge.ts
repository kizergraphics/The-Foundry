import type { LucideIcon } from 'lucide-react'
import { Camera, Hammer, IdCard, Palette } from 'lucide-react'

export type ForgeMode =
  | 'armory'
  | 'texture-lab'
  | 'visualizer'
  | 'character-sheet'

export type ReferenceSlot = 'style' | 'subject'
export type CharacterSheetReferenceSlot = 'face' | 'outfit' | 'art-style'
export type CharacterSheetGenerationMode = 'reference' | 'manifest'
export type TextureLabWorkflow = 'generate' | 'expand'
export type TextureExpansionTargetSize = 1024 | 2048
export type GenerationCount = 1 | 2 | 3 | 4
export type ForgeStatus = 'idle' | 'loading' | 'success' | 'error'

export type ReferenceAsset = {
  file: File
  mimeType: string
  name: string
  sizeLabel: string
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
  workflow: TextureLabWorkflow
}

export type ForgeState = {
  activeMode: ForgeMode
  characterSheet: CharacterSheetState
  generationCount: GenerationCount
  prompt: string
  references: Record<ReferenceSlot, ReferenceAsset | null>
  textureLab: TextureLabState
}

export type ForgeAction =
  | { type: 'set-mode'; mode: ForgeMode }
  | { type: 'set-generation-count'; count: number }
  | { type: 'set-prompt'; prompt: string }
  | { type: 'set-reference'; slot: ReferenceSlot; asset: ReferenceAsset | null }
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
  | {
      type: 'set-texture-expansion-target-size'
      size: TextureExpansionTargetSize
    }

export type ModeDefinition = {
  description: string
  eyebrow: string
  focus: string
  icon: LucideIcon
  instruction: string
  label: string
  previewAspectClassName: string
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
    icon: IdCard,
    focus: 'Identity, outfit, turnaround',
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
    icon: Camera,
    focus: 'Hero shots, callouts, mood frames',
  },
}

export const initialState: ForgeState = {
  activeMode: 'armory',
  generationCount: 3,
  prompt: '',
  references: {
    style: null,
    subject: null,
  },
  textureLab: {
    expansionSource: null,
    expansionTargetSize: 1024,
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
    case 'set-texture-expansion-target-size':
      return {
        ...state,
        textureLab: {
          ...state.textureLab,
          expansionTargetSize: action.size,
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
