import type { ForgeMode } from '../../shared/modeCatalog.js'
import { MODEL_LABELS } from '../../shared/modelLabels.js'
import type { ActionAnimatorPipeline } from '../lib/forge'
export { MODEL_LABELS }
export type ModelId = keyof typeof MODEL_LABELS
export function getActionAnimatorDefaultModel(_pipeline?: ActionAnimatorPipeline): ModelId { void _pipeline; return 'codex' }
export function getModeDefaultModel(_mode: ForgeMode, _options?: { actionAnimatorPipeline?: ActionAnimatorPipeline }): ModelId { void _mode; void _options; return 'codex' }
export function getAvailableModelsForMode(_mode: ForgeMode, _options?: { actionAnimatorPipeline?: ActionAnimatorPipeline }): ModelId[] { void _mode; void _options; return ['codex'] }
