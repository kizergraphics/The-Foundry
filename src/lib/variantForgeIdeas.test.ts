import { describe, expect, it } from 'vitest'

import {
  appendVariantForgeIdeaToDirection,
  getVariantForgeIdeaOptions,
  pickVariantForgeIdeaSuggestions,
} from '../../shared/variantForgeCatalog.js'
import { initialState } from './forge'
import {
  buildVariantForgeIdeaRequest,
  normalizeVariantForgeIdeaState,
} from './variantForgeIdeas'

describe('variant forge idea helpers', () => {
  it('returns curated idea pools that are separate from preset names', () => {
    const elementalIdeas = getVariantForgeIdeaOptions('elemental')

    expect(elementalIdeas).toContain('wind')
    expect(elementalIdeas).toContain('flora')
    expect(elementalIdeas).not.toContain('frozen')
    expect(elementalIdeas).not.toContain('burning')
  })

  it('picks a unique suggestion subset from the requested family pool', () => {
    const deterministicValues = [0.12, 0.86, 0.43, 0.68, 0.27, 0.91, 0.35, 0.54]
    let index = 0
    const suggestions = pickVariantForgeIdeaSuggestions('tech', 4, () => {
      const value = deterministicValues[index % deterministicValues.length]
      index += 1
      return value
    })
    const techIdeas = getVariantForgeIdeaOptions('tech')

    expect(suggestions).toHaveLength(4)
    expect(new Set(suggestions).size).toBe(4)
    suggestions.forEach((suggestion) => {
      expect(techIdeas).toContain(suggestion)
    })
  })

  it('appends idea chips to the custom direction without duplicating them', () => {
    expect(appendVariantForgeIdeaToDirection('', 'wind')).toBe('wind')
    expect(
      appendVariantForgeIdeaToDirection('weathered grip wrap', 'flora'),
    ).toBe('weathered grip wrap, flora')
    expect(
      appendVariantForgeIdeaToDirection('weathered grip wrap, flora', 'flora'),
    ).toBe('weathered grip wrap, flora')
    expect(
      appendVariantForgeIdeaToDirection('Weathered grip wrap.', 'flora'),
    ).toBe('Weathered grip wrap. flora')
  })

  it('builds idea-refresh requests from the current variant forge state', () => {
    expect(
      buildVariantForgeIdeaRequest({
        activeVariantOptions: [
          {
            customSetting: 'Keep the finish noble and restrained.',
            preset: 'rare',
          },
        ],
        customDirection: '  jewel sockets and quiet prestige  ',
        state: {
          ...initialState.variantForge,
          intensity: 74,
          preservePalette: true,
          variantFamily: 'rarity',
          variantPreset: 'epic',
        },
        styleText: '  painted inventory render  ',
      }),
    ).toEqual({
      customDirection: 'jewel sockets and quiet prestige',
      preservePalette: true,
      preserveSilhouette: true,
      styleText: 'painted inventory render',
      variantFamily: 'rarity',
      variantIntensity: 74,
      variantOptions: [
        {
          customSetting: 'Keep the finish noble and restrained.',
          preset: 'rare',
        },
      ],
      variantPreset: 'epic',
    })
  })

  it('normalizes ai-backed idea responses and falls back when the payload is incomplete', () => {
    expect(
      normalizeVariantForgeIdeaState(
        {
          ideas: ['wind-carved fuller', 'drifting pollen halo', 'seedpod pommel wrap', 'thorn-vein filigree'],
          source: 'ai',
        },
        'elemental',
      ),
    ).toEqual({
      ideas: [
        'wind-carved fuller',
        'drifting pollen halo',
        'seedpod pommel wrap',
        'thorn-vein filigree',
      ],
      loading: false,
      source: 'ai',
    })

    const fallbackState = normalizeVariantForgeIdeaState(
      {
        ideas: ['wind-carved fuller', 'drifting pollen halo'],
        source: 'ai',
      },
      'elemental',
    )

    expect(fallbackState.source).toBe('fallback')
    expect(fallbackState.loading).toBe(false)
    expect(fallbackState.ideas).toHaveLength(4)
    fallbackState.ideas.forEach((idea) => {
      expect(getVariantForgeIdeaOptions('elemental')).toContain(idea)
    })
  })
})
