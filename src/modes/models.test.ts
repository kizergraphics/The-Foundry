import { describe, expect, it } from 'vitest'

import { getAvailableModelsForMode, getModeDefaultModel } from './models'

describe('mode model helpers', () => {
  it('uses Veo as the fixed action animator model', () => {
    expect(getModeDefaultModel('action-animator')).toBe('veo-3.1-fast')
  })

  it('returns only Veo for the action animator mode', () => {
    expect(getAvailableModelsForMode('action-animator')).toEqual([
      'veo-3.1-fast',
    ])
  })
})
