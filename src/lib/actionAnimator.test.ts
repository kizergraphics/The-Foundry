import { describe, expect, it } from 'vitest'

import { buildActionAnimatorPrompt } from './actionAnimator'
import type { ActionAnimatorState } from './forge'

const baseState: ActionAnimatorState = {
  actionType: 'walk',
  characterImage: null,
  customActionPrompt: '',
}

describe('action animator prompt helpers', () => {
  it('describes the rewrite scaffold status', () => {
    expect(buildActionAnimatorPrompt(baseState)).toContain(
      'Legacy generation is intentionally disabled while the animation system is rebuilt.',
    )
  })

  it('includes custom direction for preset actions', () => {
    expect(
      buildActionAnimatorPrompt({
        ...baseState,
        customActionPrompt: 'Add heavier footfalls and a slight shoulder dip.',
      }),
    ).toContain('Notes: Add heavier footfalls and a slight shoulder dip.')
  })
})
