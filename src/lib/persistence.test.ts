import { describe, expect, it } from 'vitest'

import { buildRecentPrompts, loadStoredState, persistStoredState } from './persistence'

describe('persistStoredState', () => {
  it('stores only lightweight session metadata', () => {
    persistStoredState({
      recentPrompts: ['hero sword'],
      settings: {
        activeMode: 'armory',
        actionAnimator: {
          actionType: 'idle',
          customActionPrompt: '',
          frameCount: 8,
          fps: 8,
        },
        characterSheet: {
          consistencyEnabled: false,
          generationMode: 'reference',
          manifestPrompt: '',
          parentId: null,
          referencePrompt: '',
        },
        generationCount: 3,
        lootLeveler: {
          rarity: 'common',
        },
        portraitStudio: {
          prompt: '',
        },
        prompt: 'hero sword',
        textureLab: {
          expansionTargetSize: 1024,
          seamlessMode: false,
          workflow: 'generate',
        },
        uvLab: {
          atlasSize: 2048,
          paddingPx: 8,
        },
        vfxForge: {
          frameCount: 8,
          intensity: 60,
          prompt: '',
          projectileType: 'Fireball',
        },
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
          activeMode: 'armory',
          actionAnimator: {
            actionType: 'idle',
            customActionPrompt: '',
            frameCount: 8,
            fps: 8,
          },
          characterSheet: {
            consistencyEnabled: false,
            generationMode: 'reference',
            manifestPrompt: '',
            parentId: null,
            referencePrompt: '',
          },
          generationCount: 3,
          lootLeveler: {
            rarity: 'common',
          },
          portraitStudio: {
            prompt: '',
          },
          prompt: 'hero sword',
          textureLab: {
            expansionTargetSize: 1024,
            seamlessMode: false,
            workflow: 'generate',
          },
          uvLab: {
            atlasSize: 2048,
            paddingPx: 8,
          },
          vfxForge: {
            frameCount: 8,
            intensity: 60,
            prompt: '',
            projectileType: 'Fireball',
          },
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
})

describe('buildRecentPrompts', () => {
  it('deduplicates and prepends recent prompts', () => {
    expect(buildRecentPrompts('blade', ['shield', 'blade'])).toEqual([
      'blade',
      'shield',
    ])
  })
})
