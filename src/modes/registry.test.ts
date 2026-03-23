import { describe, expect, it } from 'vitest'

import { initialState } from '../lib/forge'
import {
  buildActiveVariantForgeOptions,
  getModePresentation,
} from './registry'

describe('mode registry helpers', () => {
  it('builds variant forge active options from enabled presets', () => {
    expect(buildActiveVariantForgeOptions(initialState.variantForge)).toEqual([
      {
        customSetting: '',
        preset: 'worn',
      },
    ])
  })

  it('derives texture expansion labels and readiness from state', () => {
    const presentation = getModePresentation({
      isForging: false,
      selectedModelSupported: true,
      state: {
        ...initialState,
        activeMode: 'texture-lab',
        prompt: '',
        textureLab: {
          ...initialState.textureLab,
          workflow: 'expand',
        },
      },
      styleText: '',
    })

    expect(presentation.flags.isTextureExpansionMode).toBe(true)
    expect(presentation.headerInputLabel).toBe('Source')
    expect(presentation.isReadyForApi).toBe(false)
    expect(presentation.readinessLabel).toBe('Source required')
  })

  it('derives variant forge copy from the active mode', () => {
    const presentation = getModePresentation({
      isForging: false,
      selectedModelSupported: true,
      state: {
        ...initialState,
        activeMode: 'variant-forge',
      },
      styleText: '',
    })

    expect(presentation.controlPanelTitle).toBe('Variant settings')
    expect(presentation.primaryActionLabel).toBe('FORGE VARIANT')
    expect(presentation.resultGridTitle).toBe('Variant Forge output slot')
  })

  it('derives VFX forge readiness and copy from the new recipe flow', () => {
    const presentation = getModePresentation({
      isForging: false,
      selectedModelSupported: true,
      state: {
        ...initialState,
        activeMode: 'vfx-forge',
        vfxForge: {
          ...initialState.vfxForge,
          effectLabel: '',
          exportTarget: 'none',
          textureOutputs: ['flipbook', 'noise'],
        },
      },
      styleText: '',
    })

    expect(presentation.headerInputLabel).toBe('Config')
    expect(presentation.primaryActionLabel).toBe('GENERATE TEXTURES')
    expect(presentation.readinessLabel).toBe('Texture plan ready')
    expect(presentation.resultGridTitle).toBe('VFX Forge texture ingredient outputs')
    expect(presentation.briefItems[0]).toMatchObject({
      label: 'Effect',
      value: 'Custom Effect',
    })
  })
})
