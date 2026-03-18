const variantForgePresetCatalog = Object.freeze({
  rarity: Object.freeze(['common', 'rare', 'epic', 'legendary']),
  damage: Object.freeze(['no-damage', 'worn', 'damaged', 'broken']),
  elemental: Object.freeze(['frozen', 'burning', 'stormcharged']),
  alignment: Object.freeze(['holy', 'corrupted']),
  tech: Object.freeze(['low-tech', 'industrial', 'arcane-tech']),
  boss: Object.freeze(['elite', 'boss-tier']),
})

const variantForgeDefaultPresetByFamily = Object.freeze({
  rarity: 'common',
  damage: 'worn',
  elemental: 'frozen',
  alignment: 'holy',
  tech: 'low-tech',
  boss: 'elite',
})

const variantForgeFamilies = Object.freeze(Object.keys(variantForgePresetCatalog))
const variantForgeAllPresets = Object.freeze(
  Array.from(new Set(Object.values(variantForgePresetCatalog).flat())),
)

function isVariantForgeFamily(value) {
  return typeof value === 'string' && variantForgeFamilies.includes(value)
}

function isVariantForgePreset(value) {
  return typeof value === 'string' && variantForgeAllPresets.includes(value)
}

function isVariantForgePresetForFamily(family, preset) {
  return (
    isVariantForgeFamily(family) &&
    typeof preset === 'string' &&
    variantForgePresetCatalog[family].includes(preset)
  )
}

function getVariantForgePresetOptions(family) {
  return isVariantForgeFamily(family)
    ? variantForgePresetCatalog[family]
    : variantForgePresetCatalog.damage
}

function formatVariantForgeLabel(value) {
  return String(value)
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export {
  formatVariantForgeLabel,
  getVariantForgePresetOptions,
  isVariantForgeFamily,
  isVariantForgePreset,
  isVariantForgePresetForFamily,
  variantForgeAllPresets,
  variantForgeDefaultPresetByFamily,
  variantForgeFamilies,
  variantForgePresetCatalog,
}
