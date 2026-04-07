import { describe, expect, it } from 'vitest'

import { forgeReducer, initialState } from './forge'

describe('forgeReducer', () => {
  it('hydrates the full forge state in one action', () => {
    const hydratedState = {
      ...initialState,
      activeMode: 'texture-lab' as const,
      actionAnimator: {
        ...initialState.actionAnimator,
        customActionPrompt: 'Keep the staging notes.',
      },
      prompt: 'weathered obsidian floor tile',
      textureLab: {
        ...initialState.textureLab,
        seamlessMode: true,
        workflow: 'expand' as const,
      },
    }

    expect(forgeReducer(initialState, { type: 'hydrate', state: hydratedState })).toEqual(
      hydratedState,
    )
  })

  it('switches variant forge families to that family’s default preset', () => {
    const rarityState = forgeReducer(initialState, {
      type: 'set-variant-forge-family',
      family: 'rarity',
    })

    expect(rarityState.variantForge).toMatchObject({
      variantFamily: 'rarity',
      variantPreset: 'common',
    })

    const bossState = forgeReducer(rarityState, {
      type: 'set-variant-forge-family',
      family: 'boss',
    })

    expect(bossState.variantForge).toMatchObject({
      variantFamily: 'boss',
      variantPreset: 'elite',
    })
  })

  it('keeps variant preset toggles and custom settings in sync', () => {
    const withBrokenEnabled = forgeReducer(initialState, {
      type: 'toggle-variant-forge-preset',
      preset: 'broken',
    })

    expect(withBrokenEnabled.variantForge.optionStates.broken).toMatchObject({
      customSetting: '',
      enabled: true,
    })

    const withBrokenLead = forgeReducer(withBrokenEnabled, {
      type: 'set-variant-forge-preset',
      preset: 'broken',
    })

    expect(withBrokenLead.variantForge.variantPreset).toBe('broken')

    const withCustomSetting = forgeReducer(withBrokenLead, {
      type: 'set-variant-forge-preset-custom-setting',
      customSetting: 'Expose the cracked core.',
      preset: 'broken',
    })

    expect(withCustomSetting.variantForge.optionStates.broken).toMatchObject({
      customSetting: 'Expose the cracked core.',
      enabled: true,
    })
  })

  it('allows every preset in a family to be turned off', () => {
    const withNoActivePresets = forgeReducer(initialState, {
      type: 'toggle-variant-forge-preset',
      preset: 'worn',
    })

    expect(withNoActivePresets.variantForge.variantPreset).toBe('worn')
    expect(withNoActivePresets.variantForge.optionStates.worn).toMatchObject({
      enabled: false,
    })
  })

  it('stores custom directions separately for each variant family', () => {
    const withDamageDirection = forgeReducer(initialState, {
      type: 'set-variant-forge-custom-direction',
      customDirection: 'Split the hilt leather and deepen the rust.',
    })

    const withElementalDirection = forgeReducer(
      forgeReducer(withDamageDirection, {
        type: 'set-variant-forge-family',
        family: 'elemental',
      }),
      {
        type: 'set-variant-forge-custom-direction',
        customDirection: 'Use wind-blown flora and drifting leaves.',
      },
    )

    expect(withElementalDirection.variantForge.familyCustomDirections).toMatchObject({
      damage: 'Split the hilt leather and deepen the rust.',
      elemental: 'Use wind-blown flora and drifting leaves.',
    })
  })

  it('updates the VFX export target without disturbing other settings', () => {
    const nextState = forgeReducer(initialState, {
      type: 'set-vfx-export-target',
      exportTarget: 'vfx-graph',
    })

    expect(nextState.vfxForge).toMatchObject({
      effectLabel: '',
      exportTarget: 'vfx-graph',
      frameCount: 8,
      intensity: 60,
      looping: true,
      textureOutputs: ['flipbook'],
    })
  })

  it('adds and removes freeform VFX texture outputs', () => {
    const withFlipbookDisabled = forgeReducer(initialState, {
      type: 'set-vfx-texture-output',
      enabled: false,
      kind: 'flipbook',
    })
    const withSwirlEnabled = forgeReducer(withFlipbookDisabled, {
      type: 'set-vfx-texture-output',
      enabled: true,
      kind: 'swirl',
    })

    expect(withFlipbookDisabled.vfxForge.textureOutputs).toEqual([])
    expect(withSwirlEnabled.vfxForge.textureOutputs).toEqual(['swirl'])
  })
})
