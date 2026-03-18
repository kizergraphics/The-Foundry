import type {
  ActionAnimatorActionType,
  ActionAnimatorNormalizedSize,
  ActionAnimatorPipeline,
  CharacterSheetGenerationMode,
  ForgeMode,
  GenerationCount,
  TextureExpansionTargetSize,
  TextureLabWorkflow,
  UvLabAtlasSize,
  VariantForgeFamily,
  VariantForgeOptionStateMap,
  VariantForgePreset,
} from './forge'
import {
  clampActionAnimatorFps,
  clampActionAnimatorNormalizedSize,
  clampFrameCount,
  clampIntensity,
  clampTextureLabOutputSize,
  clampUvAtlasSize,
  clampUvPaddingPx,
  getVariantForgePresetOptions,
  variantForgeDefaultPresetByFamily,
  variantForgeFamilies,
  type LootLevelerRarity,
} from './forge'
import {
  isVariantForgeFamily,
  isVariantForgePresetForFamily,
} from '../../shared/variantForgeCatalog.js'

type StoredActionAnimatorSettings = {
  actionType: ActionAnimatorActionType
  customActionPrompt: string
  frameCount: number
  fps: number
  normalizedSize: ActionAnimatorNormalizedSize
  pipeline: ActionAnimatorPipeline
}

type StoredCharacterSheetSettings = {
  consistencyEnabled: boolean
  generationMode: CharacterSheetGenerationMode
  manifestPrompt: string
  parentId: string | null
  referencePrompt: string
}

type StoredVariantForgeSettings = {
  customDirection: string
  intensity: number
  optionStates: VariantForgeOptionStateMap
  preservePalette: boolean
  preserveSilhouette: boolean
  variantFamily: VariantForgeFamily
  variantPreset: VariantForgePreset
}

type StoredPortraitStudioSettings = {
  prompt: string
}

type StoredSettings = {
  activeMode: ForgeMode
  actionAnimator: StoredActionAnimatorSettings
  characterSheet: StoredCharacterSheetSettings
  generationCount: GenerationCount
  portraitStudio: StoredPortraitStudioSettings
  prompt: string
  textureLab: {
    expansionTargetSize: TextureExpansionTargetSize
    seamlessMode: boolean
    workflow: TextureLabWorkflow
  }
  uvLab: {
    atlasSize: UvLabAtlasSize
    paddingPx: number
  }
  variantForge: StoredVariantForgeSettings
  vfxForge: {
    frameCount: number
    intensity: number
    prompt: string
    projectileType: string
  }
}

type StoredSession = {
  mode: ForgeMode | null
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

function normalizeStoredMode(value: unknown): ForgeMode {
  if (value === 'loot-leveler') {
    return 'variant-forge'
  }

  return value === 'action-animator' ||
    value === 'portrait-studio' ||
    value === 'texture-lab' ||
    value === 'uv-lab' ||
    value === 'vfx-forge' ||
    value === 'visualizer' ||
    value === 'character-sheet' ||
    value === 'variant-forge' ||
    value === 'armory'
    ? value
    : 'armory'
}

function readLegacyLootLevelerRarity(
  value: unknown,
): LootLevelerRarity | undefined {
  return value === 'common' ||
    value === 'rare' ||
    value === 'epic' ||
    value === 'legendary'
    ? value
    : undefined
}

function readStoredVariantForgeOptionStates(value: unknown): VariantForgeOptionStateMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const rawValue = value as Record<string, unknown>
  const normalizedStates: VariantForgeOptionStateMap = {}

  for (const family of variantForgeFamilies) {
    for (const preset of getVariantForgePresetOptions(family)) {
      const entry = rawValue[preset]

      if (!entry || typeof entry !== 'object') {
        continue
      }

      normalizedStates[preset] = {
        customSetting:
          typeof (entry as { customSetting?: unknown }).customSetting === 'string'
            ? (entry as { customSetting: string }).customSetting
            : '',
        enabled: Boolean((entry as { enabled?: unknown }).enabled),
      }
    }
  }

  return normalizedStates
}

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
    const actionAnimatorPipeline: ActionAnimatorPipeline =
      parsed.settings?.actionAnimator?.pipeline === 'veo-video'
        ? 'veo-video'
        : 'sprite-strip'
    const legacyLootLevelerRarity = readLegacyLootLevelerRarity(
      (parsed.settings as { lootLeveler?: { rarity?: unknown } } | undefined)?.lootLeveler
        ?.rarity,
    )
    const storedVariantFamily = isVariantForgeFamily(parsed.settings?.variantForge?.variantFamily)
      ? parsed.settings.variantForge.variantFamily
      : legacyLootLevelerRarity
        ? 'rarity'
        : 'damage'
    const storedVariantPreset = isVariantForgePresetForFamily(
      storedVariantFamily,
      parsed.settings?.variantForge?.variantPreset,
    )
      ? parsed.settings.variantForge.variantPreset
      : legacyLootLevelerRarity && storedVariantFamily === 'rarity'
        ? legacyLootLevelerRarity
        : variantForgeDefaultPresetByFamily[storedVariantFamily]
    const storedVariantOptionStates = readStoredVariantForgeOptionStates(
      parsed.settings?.variantForge?.optionStates,
    )
    const shouldHydrateLegacyVariantPreset =
      parsed.settings?.variantForge?.optionStates === undefined
    const hydratedVariantOptionStates = shouldHydrateLegacyVariantPreset
      ? {
          ...storedVariantOptionStates,
          [storedVariantPreset]: {
            customSetting: storedVariantOptionStates[storedVariantPreset]?.customSetting ?? '',
            enabled: true,
          },
        }
      : storedVariantOptionStates

    return {
      recentPrompts: Array.isArray(parsed.recentPrompts)
        ? parsed.recentPrompts.filter(
            (prompt): prompt is string =>
              typeof prompt === 'string' && prompt.trim().length > 0,
          )
        : [],
      settings: {
        activeMode: normalizeStoredMode(parsed.settings?.activeMode),
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
          normalizedSize:
            typeof parsed.settings?.actionAnimator?.normalizedSize === 'number' &&
            Number.isFinite(parsed.settings.actionAnimator.normalizedSize)
              ? clampActionAnimatorNormalizedSize(
                  parsed.settings.actionAnimator.normalizedSize,
                  actionAnimatorPipeline,
                )
              : clampActionAnimatorNormalizedSize(64, actionAnimatorPipeline),
          pipeline: actionAnimatorPipeline,
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
        portraitStudio: {
          prompt:
            typeof parsed.settings?.portraitStudio?.prompt === 'string'
              ? parsed.settings.portraitStudio.prompt
              : '',
        },
        prompt:
          typeof parsed.settings?.prompt === 'string' ? parsed.settings.prompt : '',
        textureLab: {
          expansionTargetSize: clampTextureLabOutputSize(
            parsed.settings?.textureLab?.expansionTargetSize ?? 1024,
          ),
          seamlessMode: Boolean(parsed.settings?.textureLab?.seamlessMode),
          workflow:
            parsed.settings?.textureLab?.workflow === 'expand'
              ? 'expand'
              : 'generate',
        },
        uvLab: {
          atlasSize: clampUvAtlasSize(parsed.settings?.uvLab?.atlasSize ?? 2048),
          paddingPx: clampUvPaddingPx(parsed.settings?.uvLab?.paddingPx ?? 8),
        },
        variantForge: {
          customDirection:
            typeof parsed.settings?.variantForge?.customDirection === 'string'
              ? parsed.settings.variantForge.customDirection
              : '',
          intensity:
            typeof parsed.settings?.variantForge?.intensity === 'number' &&
            Number.isFinite(parsed.settings.variantForge.intensity)
              ? clampIntensity(parsed.settings.variantForge.intensity)
              : 60,
          optionStates: hydratedVariantOptionStates,
          preservePalette: Boolean(parsed.settings?.variantForge?.preservePalette),
          preserveSilhouette:
            typeof parsed.settings?.variantForge?.preserveSilhouette === 'boolean'
              ? parsed.settings.variantForge.preserveSilhouette
              : true,
          variantFamily: storedVariantFamily,
          variantPreset: storedVariantPreset,
        },
        vfxForge: {
          frameCount:
            typeof parsed.settings?.vfxForge?.frameCount === 'number' &&
            Number.isFinite(parsed.settings.vfxForge.frameCount)
              ? clampFrameCount(parsed.settings.vfxForge.frameCount)
              : 8,
          intensity:
            typeof parsed.settings?.vfxForge?.intensity === 'number' &&
            Number.isFinite(parsed.settings.vfxForge.intensity)
              ? Math.max(0, Math.min(100, Math.round(parsed.settings.vfxForge.intensity)))
              : 60,
          prompt:
            typeof parsed.settings?.vfxForge?.prompt === 'string'
              ? parsed.settings.vfxForge.prompt
              : '',
          projectileType:
            typeof parsed.settings?.vfxForge?.projectileType === 'string' &&
            parsed.settings.vfxForge.projectileType.trim().length > 0
              ? parsed.settings.vfxForge.projectileType
              : 'Fireball',
        },
      },
      session:
        parsed.session &&
        (parsed.session.mode === null || typeof parsed.session.mode === 'string') &&
        (parsed.session.serverModel === null ||
          typeof parsed.session.serverModel === 'string') &&
        (parsed.session.serverPrompt === null ||
          typeof parsed.session.serverPrompt === 'string') &&
          typeof parsed.session.savedAt === 'string'
          ? {
              mode:
                typeof parsed.session.mode === 'string'
                  ? normalizeStoredMode(parsed.session.mode)
                  : null,
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

  const fallbackState: StoredState = {
    ...state,
    session: state.session
      ? {
          ...state.session,
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
