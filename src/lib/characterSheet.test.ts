import { describe, expect, it } from 'vitest'

import { buildCharacterSheetPrompt } from './characterSheet'
import { initialState } from './forge'

describe('buildCharacterSheetPrompt', () => {
  it('keeps manifest sheets free of weapons and blocking props', () => {
    const prompt = buildCharacterSheetPrompt({
      ...initialState.characterSheet,
      generationMode: 'manifest',
      manifestPrompt: 'Desert scout with layered wraps and segmented leather armor.',
    })

    expect(prompt).toContain('Do not show weapons, shields, handheld props')
    expect(prompt).toContain('Preserve outfit and armor details')
  })

  it('keeps reference sheets free of weapons and blocking props', () => {
    const prompt = buildCharacterSheetPrompt({
      ...initialState.characterSheet,
      generationMode: 'reference',
      referencePrompt: 'Keep the scout calm and upright.',
    })

    expect(prompt).toContain('Do not show weapons, shields, handheld props')
    expect(prompt).toContain('Exclude weapons, shields, handheld props')
  })
})
