import { describe, expect, it } from 'vitest'

import { getAvailableModelsForMode, getModeDefaultModel } from './models'

describe('mode model helpers', () => {
  it('defaults the image tabs to OpenAI GPT Image 2', () => {
    expect(getModeDefaultModel('armory')).toBe('openai-gpt-image-2')
    expect(getModeDefaultModel('character-sheet')).toBe('openai-gpt-image-2')
    expect(getModeDefaultModel('portrait-studio')).toBe('openai-gpt-image-2')
    expect(getModeDefaultModel('texture-lab')).toBe('openai-gpt-image-2')
    expect(getModeDefaultModel('variant-forge')).toBe('openai-gpt-image-2')
    expect(getModeDefaultModel('vfx-forge')).toBe('openai-gpt-image-2')
    expect(getModeDefaultModel('visualizer')).toBe('openai-gpt-image-2')
  })

  it('uses Veo as the fixed action animator model', () => {
    expect(getModeDefaultModel('action-animator')).toBe('veo-3.1-fast')
  })

  it('returns only Veo for the action animator mode', () => {
    expect(getAvailableModelsForMode('action-animator')).toEqual([
      'veo-3.1-fast',
    ])
  })

  it('includes OpenAI GPT Image 2 in image-capable tabs', () => {
    expect(getAvailableModelsForMode('armory')).toContain('openai-gpt-image-2')
    expect(getAvailableModelsForMode('character-sheet')).toContain('openai-gpt-image-2')
    expect(getAvailableModelsForMode('portrait-studio')).toContain('openai-gpt-image-2')
    expect(getAvailableModelsForMode('texture-lab')).toContain('openai-gpt-image-2')
    expect(getAvailableModelsForMode('variant-forge')).toContain('openai-gpt-image-2')
    expect(getAvailableModelsForMode('vfx-forge')).toContain('openai-gpt-image-2')
    expect(getAvailableModelsForMode('visualizer')).toContain('openai-gpt-image-2')
  })
})
