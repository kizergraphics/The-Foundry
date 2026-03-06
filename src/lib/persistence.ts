import type {
  CharacterSheetGenerationMode,
  ForgeMode,
  ForgeResult,
  GenerationCount,
  TextureExpansionTargetSize,
  TextureLabWorkflow,
} from './forge'

type StoredCharacterSheetSettings = {
  consistencyEnabled: boolean
  generationMode: CharacterSheetGenerationMode
  manifestPrompt: string
  parentId: string | null
  referencePrompt: string
}

type StoredSettings = {
  activeMode: ForgeMode
  characterSheet: StoredCharacterSheetSettings
  generationCount: GenerationCount
  prompt: string
  textureLab: {
    expansionTargetSize: TextureExpansionTargetSize
    seamlessMode: boolean
    workflow: TextureLabWorkflow
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
          parsed.settings?.activeMode === 'texture-lab' ||
          parsed.settings?.activeMode === 'visualizer' ||
          parsed.settings?.activeMode === 'character-sheet' ||
          parsed.settings?.activeMode === 'armory'
            ? parsed.settings.activeMode
            : 'armory',
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
