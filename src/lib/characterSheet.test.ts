import { describe, expect, it } from 'vitest'

import { createDataUrl } from './browser'
import { buildCharacterSheetPrompt, buildCharacterSheetRequest } from './characterSheet'
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

  it('stages the latest sheet as an inline consistency reference when enabled', async () => {
    const request = await buildCharacterSheetRequest(
      {
        ...initialState.characterSheet,
        consistencyEnabled: true,
        parentId: 'sheet-1',
      },
      'gemini-3-pro',
      'low',
      'studio-default',
      {
        dataUrl: createDataUrl('Zm9yZ2U=', 'image/png'),
        id: 'sheet-1',
        mimeType: 'image/png',
        paletteHexes: [],
        text: 'Sheet',
      },
    )

    expect(request.consistencyReference).toEqual({
      data: 'Zm9yZ2U=',
      mimeType: 'image/png',
    })
    expect(request.quality).toBe('low')
  })
})
