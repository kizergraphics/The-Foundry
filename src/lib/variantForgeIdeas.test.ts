import { describe, expect, it } from 'vitest'

import {
  appendVariantForgeIdeaToDirection,
  getVariantForgeIdeaOptions,
  pickVariantForgeIdeaSuggestions,
} from '../../shared/variantForgeCatalog.js'

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
})
