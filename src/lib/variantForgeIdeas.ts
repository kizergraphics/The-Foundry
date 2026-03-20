import {
  pickVariantForgeIdeaSuggestions,
  type VariantForgeFamily,
} from '../../shared/variantForgeCatalog.js'
import {
  variantForgeIdeaSuggestionCount,
  type VariantForgeIdeaRequest,
  type VariantForgeIdeaResponse,
  type VariantForgeIdeaResponseSource,
} from '../../shared/variantForgeIdeas.js'
import type { VariantForgeState } from './forge'

type VariantForgeIdeaError =
  | string
  | {
      code?: string
      details?: string[]
      message?: string
      retryAfterSeconds?: number
      title?: string
    }

type VariantForgeIdeaApiResponse =
  | VariantForgeIdeaResponse
  | {
      error?: VariantForgeIdeaError
      ideas?: string[]
      source?: VariantForgeIdeaResponseSource
    }

export type VariantForgeIdeaState = {
  ideas: string[]
  loading: boolean
  source: VariantForgeIdeaResponseSource
}

function sanitizeIdeaList(ideas: string[]) {
  const uniqueIdeas: string[] = []
  const seenIdeas = new Set<string>()

  ideas.forEach((idea) => {
    const normalizedIdea = typeof idea === 'string' ? idea.trim() : ''
    const normalizedKey = normalizedIdea.toLowerCase()

    if (!normalizedIdea || seenIdeas.has(normalizedKey)) {
      return
    }

    seenIdeas.add(normalizedKey)
    uniqueIdeas.push(normalizedIdea)
  })

  return uniqueIdeas.slice(0, variantForgeIdeaSuggestionCount)
}

export function buildVariantForgeFallbackIdeas(family: VariantForgeFamily) {
  return sanitizeIdeaList(
    pickVariantForgeIdeaSuggestions(family, variantForgeIdeaSuggestionCount),
  )
}

export function buildVariantForgeFallbackIdeaState(
  family: VariantForgeFamily,
): VariantForgeIdeaState {
  return {
    ideas: buildVariantForgeFallbackIdeas(family),
    loading: false,
    source: 'fallback',
  }
}

export function buildVariantForgeIdeaRequest({
  activeVariantOptions,
  customDirection,
  state,
  styleText,
}: {
  activeVariantOptions: VariantForgeIdeaRequest['variantOptions']
  customDirection: string
  state: VariantForgeState
  styleText: string
}): VariantForgeIdeaRequest {
  return {
    customDirection: customDirection.trim(),
    preservePalette: state.preservePalette,
    preserveSilhouette: state.preserveSilhouette,
    styleText: styleText.trim(),
    variantFamily: state.variantFamily,
    variantIntensity: state.intensity,
    variantOptions: activeVariantOptions,
    variantPreset: state.variantPreset,
  }
}

export async function postVariantForgeIdeaRequest(body: VariantForgeIdeaRequest) {
  const response = await fetch('/api/variant-forge-ideas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as VariantForgeIdeaApiResponse | undefined

  return {
    ok: response.ok,
    payload,
  }
}

export function normalizeVariantForgeIdeaState(
  payload:
    | Partial<VariantForgeIdeaResponse>
    | {
        ideas?: string[]
        source?: VariantForgeIdeaResponseSource
      }
    | undefined,
  family: VariantForgeFamily,
): VariantForgeIdeaState {
  const fallbackState = buildVariantForgeFallbackIdeaState(family)
  const normalizedIdeas = sanitizeIdeaList(Array.isArray(payload?.ideas) ? payload.ideas : [])
  const source = payload?.source === 'ai' ? 'ai' : 'fallback'

  if (normalizedIdeas.length < variantForgeIdeaSuggestionCount) {
    return fallbackState
  }

  return {
    ideas: normalizedIdeas,
    loading: false,
    source,
  }
}
