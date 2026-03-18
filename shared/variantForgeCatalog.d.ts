export const variantForgePresetCatalog: {
  readonly rarity: readonly ['common', 'rare', 'epic', 'legendary']
  readonly damage: readonly ['no-damage', 'worn', 'damaged', 'broken']
  readonly elemental: readonly ['frozen', 'burning', 'stormcharged']
  readonly alignment: readonly ['holy', 'corrupted']
  readonly tech: readonly ['low-tech', 'industrial', 'arcane-tech']
  readonly boss: readonly ['elite', 'boss-tier']
}

export type VariantForgeFamily = keyof typeof variantForgePresetCatalog
export type VariantForgeRarityPreset = (typeof variantForgePresetCatalog)['rarity'][number]
export type VariantForgeDamagePreset = (typeof variantForgePresetCatalog)['damage'][number]
export type VariantForgeElementalPreset =
  (typeof variantForgePresetCatalog)['elemental'][number]
export type VariantForgeAlignmentPreset =
  (typeof variantForgePresetCatalog)['alignment'][number]
export type VariantForgeTechPreset = (typeof variantForgePresetCatalog)['tech'][number]
export type VariantForgeBossPreset = (typeof variantForgePresetCatalog)['boss'][number]
export type VariantForgePreset = (typeof variantForgePresetCatalog)[VariantForgeFamily][number]

export const variantForgeDefaultPresetByFamily: {
  readonly [K in VariantForgeFamily]: (typeof variantForgePresetCatalog)[K][number]
}

export const variantForgeFamilies: readonly VariantForgeFamily[]
export const variantForgeAllPresets: readonly VariantForgePreset[]

export function isVariantForgeFamily(value: unknown): value is VariantForgeFamily
export function isVariantForgePreset(value: unknown): value is VariantForgePreset
export function isVariantForgePresetForFamily(
  family: unknown,
  preset: unknown,
): preset is VariantForgePreset
export function getVariantForgePresetOptions(
  family: VariantForgeFamily | unknown,
): readonly VariantForgePreset[]
export function formatVariantForgeLabel(value: string): string
