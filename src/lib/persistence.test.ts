import { describe, expect, it } from 'vitest'

import { buildRecentPrompts, loadStoredState, persistStoredState } from './persistence'
import type { VfxTextureKind } from './forge'
import { getDefaultUiLayout } from './uiLayout'

const baseStoredSettings = {
  actionAnimator: {
    actionType: 'idle' as const,
    customActionPrompt: '',
  },
  characterSheet: {
    consistencyEnabled: false,
    generationMode: 'reference' as const,
    manifestPrompt: '',
    parentId: null,
    referencePrompt: '',
  },
  generationCount: 3 as const,
  portraitStudio: {
    prompt: '',
  },
  prompt: 'hero sword',
  textureLab: {
    expansionTargetSize: 1024 as const,
    materialMapDefaults: {
      heightStrength: 60,
      metallicStrength: 60,
      normalStrength: 60,
      roughnessStrength: 60,
    },
    seamlessMode: false,
    workflow: 'generate' as const,
  },
  uiLayout: getDefaultUiLayout(),
  uvLab: {
    atlasSize: 2048 as const,
    paddingPx: 8,
  },
  variantForge: {
    familyCustomDirections: {},
    intensity: 60,
    optionStates: {
      worn: {
        customSetting: '',
        enabled: true,
      },
    },
    preservePalette: false,
    preserveSilhouette: true,
    variantFamily: 'damage' as const,
    variantPreset: 'worn' as const,
  },
  vfxForge: {
    effectLabel: 'Fireball',
    exportTarget: 'particle-system' as const,
    frameCount: 8,
    intensity: 60,
    looping: true,
    prompt: '',
    textureOutputs: ['flipbook', 'dissolve-mask', 'noise'] as VfxTextureKind[],
  },
}

describe('persistStoredState', () => {
  it('stores only lightweight session metadata', () => {
    persistStoredState({
      recentPrompts: ['hero sword'],
      settings: {
        ...baseStoredSettings,
        activeMode: 'armory',
      },
      session: {
        mode: 'armory',
        savedAt: '2026-03-10T00:00:00.000Z',
        serverModel: 'gemini-3-flash',
        serverPrompt: 'hero sword',
      },
    })

    const rawState = window.localStorage.getItem('kizer-forge-state')

    expect(rawState).toContain('"serverModel":"gemini-3-flash"')
    expect(rawState).not.toContain('dataUrl')
    expect(rawState).not.toContain('"results"')
  })

  it('restores metadata-only sessions cleanly', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: ['hero sword'],
        settings: {
          ...baseStoredSettings,
          activeMode: 'armory',
        },
        session: {
          mode: 'armory',
          savedAt: '2026-03-10T00:00:00.000Z',
          serverModel: 'gemini-3-flash',
          serverPrompt: 'hero sword',
        },
      }),
    )

    const restoredState = loadStoredState()

    expect(restoredState?.session).toEqual({
      mode: 'armory',
      savedAt: '2026-03-10T00:00:00.000Z',
      serverModel: 'gemini-3-flash',
      serverPrompt: 'hero sword',
    })
  })

  it('stores and restores persisted ui layouts', () => {
    const uiLayout = {
      ...getDefaultUiLayout(),
      byMode: {
        'vfx-forge': {
          control: {
            primary: ['vfx-forge-panel', 'model-selector', 'style-reference'],
            secondary: ['forge-action'],
          },
          workspace: {
            bottom: [],
            main: ['result-grid', 'forge-brief'],
            top: ['top-panel'],
          },
        },
      },
      global: {
        modeTabs: ['vfx-forge', 'armory', ...getDefaultUiLayout().global.modeTabs.filter((mode) => mode !== 'vfx-forge' && mode !== 'armory')],
        shell: {
          footer: [],
          header: ['mode-tabs', 'header-summary'],
          left: ['workspace-panel'],
          right: ['control-panel'],
        },
      },
    } as typeof baseStoredSettings.uiLayout

    persistStoredState({
      recentPrompts: ['hero sword'],
      settings: {
        ...baseStoredSettings,
        activeMode: 'vfx-forge',
        uiLayout,
      },
      session: null,
    })

    expect(loadStoredState()?.settings.uiLayout).toEqual(uiLayout)
  })

  it('hydrates a default ui layout when older saved settings do not include one', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'armory',
          uiLayout: undefined,
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.uiLayout).toEqual(getDefaultUiLayout())
  })

  it('sanitizes persisted ui layouts by dropping unknown ids and appending defaults', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'vfx-forge',
          uiLayout: {
            byMode: {
              'vfx-forge': {
                control: {
                  primary: ['vfx-forge-panel', 'missing-card', 'vfx-forge-panel'],
                  secondary: [],
                },
                workspace: {
                  bottom: [],
                  main: ['result-grid', 'missing-workspace'],
                  top: [],
                },
              },
            },
            global: {
              modeTabs: ['vfx-forge', 'missing-mode', 'armory'],
              shell: {
                footer: ['missing-shell'],
                header: ['mode-tabs', 'header-summary', 'mode-tabs'],
                left: ['workspace-panel'],
                right: [],
              },
            },
            version: 99,
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.uiLayout).toEqual({
      byMode: {
        'vfx-forge': {
          control: {
            primary: ['vfx-forge-panel', 'model-selector', 'style-reference'],
            secondary: ['forge-action'],
          },
          workspace: {
            bottom: [],
            main: ['result-grid', 'forge-brief'],
            top: ['top-panel'],
          },
        },
      },
      global: {
        modeTabs: [
          'vfx-forge',
          'armory',
          'action-animator',
          'variant-forge',
          'portrait-studio',
          'texture-lab',
          'uv-lab',
          'visualizer',
          'character-sheet',
        ],
        shell: {
          footer: [],
          header: ['mode-tabs', 'header-summary'],
          left: ['workspace-panel', 'control-panel'],
          right: [],
        },
      },
      version: 1,
    })
  })

  it('keeps only the scaffold animator fields when restoring state', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'action-animator',
          actionAnimator: {
            ...baseStoredSettings.actionAnimator,
            actionType: 'walk',
            frameCount: 99,
            fps: 99,
            normalizedSize: 700,
            pipeline: 'veo-video',
            customActionPrompt: 'Heavy forward lean.',
          },
          generationCount: 1,
          prompt: '',
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.actionAnimator).toMatchObject({
      actionType: 'walk',
      customActionPrompt: 'Heavy forward lean.',
    })
  })

  it('migrates legacy loot leveler settings into variant forge', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          actionAnimator: baseStoredSettings.actionAnimator,
          activeMode: 'loot-leveler',
          characterSheet: baseStoredSettings.characterSheet,
          generationCount: 1,
          lootLeveler: {
            rarity: 'epic',
          },
          portraitStudio: baseStoredSettings.portraitStudio,
          prompt: '',
          textureLab: baseStoredSettings.textureLab,
          uvLab: baseStoredSettings.uvLab,
          vfxForge: baseStoredSettings.vfxForge,
        },
        session: {
          mode: 'loot-leveler',
          savedAt: '2026-03-10T00:00:00.000Z',
          serverModel: 'gemini-3-pro',
          serverPrompt: '',
        },
      }),
    )

    expect(loadStoredState()).toMatchObject({
      session: {
        mode: 'variant-forge',
      },
      settings: {
        activeMode: 'variant-forge',
        variantForge: {
          intensity: 60,
          optionStates: {
            epic: {
              customSetting: '',
              enabled: true,
            },
          },
          preservePalette: false,
          preserveSilhouette: true,
          variantFamily: 'rarity',
          variantPreset: 'epic',
        },
      },
    })
  })

  it('restores variant option toggles and custom settings', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'variant-forge',
          variantForge: {
            ...baseStoredSettings.variantForge,
            optionStates: {
              broken: {
                customSetting: 'Expose the inner core near the hilt.',
                enabled: true,
              },
              worn: {
                customSetting: 'Keep the leather wrap mostly intact.',
                enabled: false,
              },
            },
            variantPreset: 'broken',
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.variantForge).toMatchObject({
      optionStates: {
        broken: {
          customSetting: 'Expose the inner core near the hilt.',
          enabled: true,
        },
        worn: {
          customSetting: 'Keep the leather wrap mostly intact.',
          enabled: false,
        },
      },
      variantPreset: 'broken',
    })
  })

  it('restores family-specific custom directions', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'variant-forge',
          variantForge: {
            ...baseStoredSettings.variantForge,
            familyCustomDirections: {
              damage: 'Split the edge near the tip.',
              elemental: 'Lean into wind and drifting leaves.',
            },
            variantFamily: 'elemental',
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.variantForge).toMatchObject({
      familyCustomDirections: {
        damage: 'Split the edge near the tip.',
        elemental: 'Lean into wind and drifting leaves.',
      },
      variantFamily: 'elemental',
    })
  })

  it('migrates legacy projectileType into the projectile effect label', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'vfx-forge',
          vfxForge: {
            frameCount: 8,
            intensity: 60,
            prompt: 'slow corkscrew',
            projectileType: 'Frost Bolt',
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.vfxForge).toMatchObject({
      effectLabel: 'Frost Bolt',
      exportTarget: 'none',
      textureOutputs: ['flipbook'],
    })
  })

  it('migrates legacy shared custom direction into the active family', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'variant-forge',
          variantForge: {
            ...baseStoredSettings.variantForge,
            customDirection: 'Wind-torn ribbons and floral overgrowth.',
            variantFamily: 'elemental',
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.variantForge).toMatchObject({
      familyCustomDirections: {
        elemental: 'Wind-torn ribbons and floral overgrowth.',
      },
      variantFamily: 'elemental',
    })
  })

  it('preserves categories with no active variant presets', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'variant-forge',
          variantForge: {
            ...baseStoredSettings.variantForge,
            optionStates: {
              broken: {
                customSetting: 'Keep the spine exposed.',
                enabled: false,
              },
              worn: {
                customSetting: '',
                enabled: false,
              },
            },
            variantPreset: 'broken',
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.variantForge).toMatchObject({
      optionStates: {
        broken: {
          customSetting: 'Keep the spine exposed.',
          enabled: false,
        },
        worn: {
          customSetting: '',
          enabled: false,
        },
      },
      variantPreset: 'broken',
    })
  })

  it('restores persisted texture material-map defaults', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'texture-lab',
          textureLab: {
            ...baseStoredSettings.textureLab,
            materialMapDefaults: {
              heightStrength: 72,
              metallicStrength: 18,
              normalStrength: 91,
              roughnessStrength: 44,
            },
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.textureLab.materialMapDefaults).toEqual({
      heightStrength: 72,
      metallicStrength: 18,
      normalStrength: 91,
      roughnessStrength: 44,
    })
  })

  it('falls back missing texture material-map defaults to the app defaults', () => {
    window.localStorage.setItem(
      'kizer-forge-state',
      JSON.stringify({
        recentPrompts: [],
        settings: {
          ...baseStoredSettings,
          activeMode: 'texture-lab',
          textureLab: {
            expansionTargetSize: 1024,
            seamlessMode: true,
            workflow: 'generate',
          },
        },
        session: null,
      }),
    )

    expect(loadStoredState()?.settings.textureLab.materialMapDefaults).toEqual({
      heightStrength: 60,
      metallicStrength: 60,
      normalStrength: 60,
      roughnessStrength: 60,
    })
  })
})

describe('buildRecentPrompts', () => {
  it('deduplicates and prepends recent prompts', () => {
    expect(buildRecentPrompts('blade', ['shield', 'blade'])).toEqual([
      'blade',
      'shield',
    ])
  })
})
