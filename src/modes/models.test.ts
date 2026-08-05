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

  it('uses Veo by default for the animator video pipeline', () => {
    expect(
      getModeDefaultModel('action-animator', {
        actionAnimatorPipeline: 'veo-video',
      }),
    ).toBe('veo-3.1-fast')
  })

  it('uses OpenAI by default for the animator image pipeline', () => {
    expect(
      getModeDefaultModel('action-animator', {
        actionAnimatorPipeline: 'image-strip',
      }),
    ).toBe('openai-gpt-image-2')
  })

  it('returns only Veo for the animator video pipeline', () => {
    expect(
      getAvailableModelsForMode('action-animator', {
        actionAnimatorPipeline: 'veo-video',
      }),
    ).toEqual([
      'veo-3.1-fast',
    ])
  })

  it('returns OpenAI and Gemini models for the animator image pipeline', () => {
    expect(
      getAvailableModelsForMode('action-animator', {
        actionAnimatorPipeline: 'image-strip',
      }),
    ).toEqual([
      'openai-gpt-image-2',
      'gemini-3-pro',
      'gemini-3-flash',
      'gemini-3-flash-lite',
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
