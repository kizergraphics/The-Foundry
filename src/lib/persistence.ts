import type {
  ActionAnimatorActionType,
  CharacterSheetGenerationMode,
  ForgeMode,
  ForgeResult,
  GenerationCount,
  LootLevelerRarity,
  TextureExpansionTargetSize,
  TextureLabWorkflow,
} from './forge'
import { clampActionAnimatorFps, clampFrameCount } from './forge'

type StoredActionAnimatorSettings = {
  actionType: ActionAnimatorActionType
  customActionPrompt: string
  frameCount: number
  fps: number
}

type StoredCharacterSheetSettings = {
  consistencyEnabled: boolean
  generationMode: CharacterSheetGenerationMode
  manifestPrompt: string
  parentId: string | null
  referencePrompt: string
}

type StoredLootLevelerSettings = {
  rarity: LootLevelerRarity
}

type StoredPortraitStudioSettings = Record<string, never>

type StoredSettings = {
  activeMode: ForgeMode
  actionAnimator: StoredActionAnimatorSettings
  characterSheet: StoredCharacterSheetSettings
  generationCount: GenerationCount
  lootLeveler: StoredLootLevelerSettings
  portraitStudio: StoredPortraitStudioSettings
  prompt: string
  textureLab: {
    expansionTargetSize: TextureExpansionTargetSize
    seamlessMode: boolean
    workflow: TextureLabWorkflow
  }
  vfxForge: {
    intensity: number
    projectileType: string
  }
}

type StoredSession = {
  results: ForgeResult[]
  serverModel: string | null
  serverPrompt: string | null
  savedAt: string
}

type StoredState = {
  recentPrompts: string[]
  settings: StoredSettings
  session: StoredSession | null
}

const storageKey = 'kizer-forge-state'
const maxRecentPrompts = 6

export function loadStoredState(): StoredState | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.localStorage.getItem(storageKey)

  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredState>

    return {
      recentPrompts: Array.isArray(parsed.recentPrompts)
        ? parsed.recentPrompts.filter(
            (prompt): prompt is string =>
              typeof prompt === 'string' && prompt.trim().length > 0,
          )
        : [],
      settings: {
        activeMode:
          parsed.settings?.activeMode === 'action-animator' ||
          parsed.settings?.activeMode === 'loot-leveler' ||
          parsed.settings?.activeMode === 'portrait-studio' ||
          parsed.settings?.activeMode === 'texture-lab' ||
          parsed.settings?.activeMode === 'vfx-forge' ||
          parsed.settings?.activeMode === 'visualizer' ||
          parsed.settings?.activeMode === 'character-sheet' ||
          parsed.settings?.activeMode === 'armory'
            ? parsed.settings.activeMode
            : 'armory',
        actionAnimator: {
          actionType:
            parsed.settings?.actionAnimator?.actionType === 'walk' ||
            parsed.settings?.actionAnimator?.actionType === 'run' ||
            parsed.settings?.actionAnimator?.actionType === 'attack' ||
            parsed.settings?.actionAnimator?.actionType === 'jump' ||
            parsed.settings?.actionAnimator?.actionType === 'custom'
              ? parsed.settings.actionAnimator.actionType
              : 'idle',
          customActionPrompt:
            typeof parsed.settings?.actionAnimator?.customActionPrompt === 'string'
              ? parsed.settings.actionAnimator.customActionPrompt
              : '',
          frameCount:
            typeof parsed.settings?.actionAnimator?.frameCount === 'number' &&
            Number.isFinite(parsed.settings.actionAnimator.frameCount)
              ? clampFrameCount(parsed.settings.actionAnimator.frameCount)
              : 8,
          fps:
            typeof parsed.settings?.actionAnimator?.fps === 'number' &&
            Number.isFinite(parsed.settings.actionAnimator.fps)
              ? clampActionAnimatorFps(parsed.settings.actionAnimator.fps)
              : 8,
        },
        characterSheet: {
          consistencyEnabled: Boolean(
            parsed.settings?.characterSheet?.consistencyEnabled,
          ),
          generationMode:
            parsed.settings?.characterSheet?.generationMode === 'manifest'
              ? 'manifest'
              : 'reference',
          manifestPrompt:
            typeof parsed.settings?.characterSheet?.manifestPrompt === 'string'
              ? parsed.settings.characterSheet.manifestPrompt
              : '',
          parentId:
            parsed.settings?.characterSheet?.parentId === null ||
            typeof parsed.settings?.characterSheet?.parentId === 'string'
              ? parsed.settings.characterSheet.parentId
              : null,
          referencePrompt:
            typeof parsed.settings?.characterSheet?.referencePrompt === 'string'
              ? parsed.settings.characterSheet.referencePrompt
              : '',
        },
        generationCount:
          parsed.settings?.generationCount === 1 ||
          parsed.settings?.generationCount === 2 ||
          parsed.settings?.generationCount === 3 ||
          parsed.settings?.generationCount === 4
            ? parsed.settings.generationCount
            : 3,
        lootLeveler: {
          rarity:
            parsed.settings?.lootLeveler?.rarity === 'rare' ||
            parsed.settings?.lootLeveler?.rarity === 'epic' ||
            parsed.settings?.lootLeveler?.rarity === 'legendary'
              ? parsed.settings.lootLeveler.rarity
              : 'common',
        },
        portraitStudio: {},
        prompt:
          typeof parsed.settings?.prompt === 'string' ? parsed.settings.prompt : '',
        textureLab: {
          expansionTargetSize:
            parsed.settings?.textureLab?.expansionTargetSize === 2048 ? 2048 : 1024,
          seamlessMode: Boolean(parsed.settings?.textureLab?.seamlessMode),
          workflow:
            parsed.settings?.textureLab?.workflow === 'expand'
              ? 'expand'
              : 'generate',
        },
        vfxForge: {
          intensity:
            typeof parsed.settings?.vfxForge?.intensity === 'number' &&
            Number.isFinite(parsed.settings.vfxForge.intensity)
              ? Math.max(0, Math.min(100, Math.round(parsed.settings.vfxForge.intensity)))
              : 60,
          projectileType:
            typeof parsed.settings?.vfxForge?.projectileType === 'string' &&
            parsed.settings.vfxForge.projectileType.trim().length > 0
              ? parsed.settings.vfxForge.projectileType
              : 'Fireball',
        },
      },
      session:
        parsed.session &&
        Array.isArray(parsed.session.results) &&
        (parsed.session.serverModel === null ||
          typeof parsed.session.serverModel === 'string') &&
        (parsed.session.serverPrompt === null ||
          typeof parsed.session.serverPrompt === 'string') &&
        typeof parsed.session.savedAt === 'string'
          ? {
              results: parsed.session.results.filter(isStoredResult),
              serverModel: parsed.session.serverModel,
              serverPrompt: parsed.session.serverPrompt,
              savedAt: parsed.session.savedAt,
            }
          : null,
    }
  } catch {
    return null
  }
}

export function persistStoredState(state: StoredState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
    return
  } catch {
    // Large batch outputs can exceed localStorage quota.
    // Retry with lightweight state so runtime does not crash.
  }

  const fallbackState: StoredState = {
    ...state,
    session: state.session
      ? {
          ...state.session,
          results: [],
        }
      : null,
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(fallbackState))
  } catch {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Ignore storage failures: persistence should never break rendering.
    }
  }
}

export function buildRecentPrompts(nextPrompt: string, previousPrompts: string[]) {
  const trimmedPrompt = nextPrompt.trim()

  if (!trimmedPrompt) {
    return previousPrompts
  }

  return [
    trimmedPrompt,
    ...previousPrompts.filter((prompt) => prompt !== trimmedPrompt),
  ].slice(0, maxRecentPrompts)
}

function isStoredResult(result: unknown): result is ForgeResult {
  if (!result || typeof result !== 'object') {
    return false
  }

  const candidate = result as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.dataUrl === 'string' &&
    typeof candidate.mimeType === 'string' &&
    (typeof candidate.text === 'string' || typeof candidate.text === 'undefined') &&
    (Array.isArray(candidate.paletteHexes) || typeof candidate.paletteHexes === 'undefined')
  )
}
