import type { ActionAnimatorActionType, ActionAnimatorState } from './forge'

export const actionAnimatorActionOptions: Array<{
  label: string
  value: ActionAnimatorActionType
}> = [
  { label: 'Idle', value: 'idle' },
  { label: 'Walk', value: 'walk' },
  { label: 'Run', value: 'run' },
  { label: 'Attack', value: 'attack' },
  { label: 'Jump', value: 'jump' },
  { label: 'Custom', value: 'custom' },
]

export function buildActionAnimatorPrompt(state: ActionAnimatorState) {
  const directionPrompt = state.customActionPrompt.trim()
  const actionLabel =
    state.actionType === 'custom' ? directionPrompt || 'custom action' : state.actionType

  return [
    `Action Animator rewrite scaffold for a ${actionLabel} animation.`,
    state.characterImage
      ? `Staged source image: ${state.characterImage.name}.`
      : 'No source image staged yet.',
    directionPrompt ? `Notes: ${directionPrompt}` : 'Notes: none yet.',
    describeActionAnimatorMotion(state.actionType),
    'Legacy generation is intentionally disabled while the animation system is rebuilt.',
  ].join(' ')
}

function describeActionAnimatorMotion(actionType: ActionAnimatorActionType) {
  switch (actionType) {
    case 'attack':
      return 'Stage one complete attack cycle with anticipation, a decisive strike, follow-through, and recovery so adjacent frames show obvious motion.'
    case 'jump':
      return 'Stage one complete jump with crouch, launch, airborne apex, and landing, making each phase visually distinct.'
    case 'run':
      return 'Emphasize aggressive forward lean, arm swing, leg extension, and airborne stride changes for a readable run cycle.'
    case 'walk':
      return 'Emphasize alternating contact, passing, and recoil poses so the walk cycle has clear readable spacing.'
    case 'idle':
      return 'Keep the idle subtle but still readable, with weight shift, cloth drag, and arm movement that changes the silhouette.'
    case 'custom':
    default:
      return 'Show one complete readable action arc with strong silhouette changes and no duplicate adjacent poses.'
  }
}
