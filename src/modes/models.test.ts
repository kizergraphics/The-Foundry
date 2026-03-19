import { describe, expect, it } from 'vitest'

import { getAvailableModelsForMode, getModeDefaultModel } from './models'

describe('mode model helpers', () => {
  it('switches action animator models by pipeline', () => {
    expect(getModeDefaultModel('action-animator', 'sprite-strip')).toBe('gemini-3-pro')
    expect(getModeDefaultModel('action-animator', 'veo-video')).toBe('veo-3.1-fast')
  })

  it('returns only Veo for the action animator video pipeline', () => {
    expect(getAvailableModelsForMode('action-animator', 'veo-video')).toEqual([
      'veo-3.1-fast',
    ])
    expect(getAvailableModelsForMode('action-animator', 'sprite-strip')).toEqual([
      'gemini-3-pro',
      'gemini-2.5-flash-image',
    ])
  })
})
