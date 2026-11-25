import { describe, expect, it } from 'vitest'
import { allForgeModes } from '../../shared/modeCatalog.js'
import { getAvailableModelsForMode, getModeDefaultModel } from './models'

describe('fixed web image model', () => {
  it.each(allForgeModes)('uses only Codex generation for %s', mode => {
    expect(getModeDefaultModel(mode)).toBe('codex')
    expect(getAvailableModelsForMode(mode)).toEqual(['codex'])
  })
  it.each(['image-strip', 'veo-video'] as const)('ignores legacy animator model choices for %s', actionAnimatorPipeline => {
    expect(getModeDefaultModel('action-animator', { actionAnimatorPipeline })).toBe('codex')
    expect(getAvailableModelsForMode('action-animator', { actionAnimatorPipeline })).toEqual(['codex'])
  })
})
