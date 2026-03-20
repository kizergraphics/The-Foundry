import type { VariantForgeFamily, VariantForgePreset } from './variantForgeCatalog.js'

export const variantForgeIdeaResponseSources: readonly ['ai', 'fallback']
export const variantForgeIdeaSuggestionCount: 4

export type VariantForgeIdeaResponseSource =
  (typeof variantForgeIdeaResponseSources)[number]

export type VariantForgeIdeaOption = {
  customSetting: string
  preset: VariantForgePreset
}

export type VariantForgeIdeaRequest = {
  customDirection: string
  preservePalette: boolean
  preserveSilhouette: boolean
  styleText: string
  variantFamily: VariantForgeFamily
  variantIntensity: number
  variantOptions: VariantForgeIdeaOption[]
  variantPreset: VariantForgePreset
}

export type VariantForgeIdeaResponse = {
  ideas: string[]
  source: VariantForgeIdeaResponseSource
}
