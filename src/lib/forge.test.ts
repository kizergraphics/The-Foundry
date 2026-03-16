import { describe, expect, it } from 'vitest'

import { forgeReducer, initialState } from './forge'

describe('forgeReducer', () => {
  it('hydrates the full forge state in one action', () => {
    const hydratedState = {
      ...initialState,
      activeMode: 'texture-lab' as const,
      actionAnimator: {
        ...initialState.actionAnimator,
        frameCount: 12,
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
})
