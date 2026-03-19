const variantForgePresetCatalog = Object.freeze({
  rarity: Object.freeze(['common', 'rare', 'epic', 'legendary']),
  damage: Object.freeze(['no-damage', 'worn', 'damaged', 'broken']),
  elemental: Object.freeze(['frozen', 'burning', 'stormcharged']),
  alignment: Object.freeze(['holy', 'corrupted']),
  tech: Object.freeze(['low-tech', 'industrial', 'arcane-tech']),
  boss: Object.freeze(['elite', 'boss-tier']),
})

const variantForgeIdeaCatalog = Object.freeze({
  rarity: Object.freeze([
    'heirloom detailing',
    'artisan inlay',
    'ceremonial finish',
    'quiet prestige',
    'gem socket accents',
    'noble trim',
    'museum-kept polish',
    'banner-house insignia',
  ]),
  damage: Object.freeze([
    'battle nicked edge',
    'split leather grip',
    'salt air corrosion',
    'deep impact dents',
    'field repair stitches',
    'ancient rust blooms',
    'cracked guard',
    'ash-choked seams',
  ]),
  elemental: Object.freeze([
    'wind',
    'flora',
    'tidal foam',
    'sandstorm',
    'fungal bloom',
    'aurora haze',
    'volcanic glass',
    'glacial mist',
  ]),
  alignment: Object.freeze([
    'oathbound seal',
    'sunlit relic',
    'moonlit vigil',
    'grave incense',
    'fallen shrine',
    'saintly filigree',
    'penitent scars',
    'funeral silk wraps',
  ]),
  tech: Object.freeze([
    'brass gauges',
    'salvaged plating',
    'field-repaired wiring',
    'clockwork spine',
    'moss in the vents',
    'copper coils',
    'workshop soot',
    'manual override levers',
  ]),
  boss: Object.freeze([
    'arena champion',
    'regal tyrant',
    'ruined colossus',
    'trophy-laden frame',
    'cathedral scale',
    'blood rite markings',
    'throne-room opulence',
    'victory scar trophies',
  ]),
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

function getVariantForgeIdeaOptions(family) {
  return isVariantForgeFamily(family)
    ? variantForgeIdeaCatalog[family]
    : variantForgeIdeaCatalog.damage
}

function pickVariantForgeIdeaSuggestions(family, count = 4, random = Math.random) {
  const options = [...getVariantForgeIdeaOptions(family)]
  const safeCount = Math.max(0, Math.min(options.length, Math.round(Number(count) || 0)))

  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[options[index], options[swapIndex]] = [options[swapIndex], options[index]]
  }

  return options.slice(0, safeCount)
}

function appendVariantForgeIdeaToDirection(currentDirection, idea) {
  const normalizedIdea = typeof idea === 'string' ? idea.trim() : ''
  const normalizedDirection =
    typeof currentDirection === 'string' ? currentDirection.trim() : ''

  if (!normalizedIdea) {
    return normalizedDirection
  }

  if (!normalizedDirection) {
    return normalizedIdea
  }

  const normalizedSegments = normalizedDirection
    .split(',')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)

  if (normalizedSegments.includes(normalizedIdea.toLowerCase())) {
    return normalizedDirection
  }

  return /[.!?]$/.test(normalizedDirection)
    ? `${normalizedDirection} ${normalizedIdea}`
    : `${normalizedDirection}, ${normalizedIdea}`
}

function formatVariantForgeLabel(value) {
  return String(value)
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export {
  appendVariantForgeIdeaToDirection,
  formatVariantForgeLabel,
  getVariantForgeIdeaOptions,
  getVariantForgePresetOptions,
  isVariantForgeFamily,
  isVariantForgePreset,
  isVariantForgePresetForFamily,
  variantForgeAllPresets,
  variantForgeDefaultPresetByFamily,
  variantForgeFamilies,
  variantForgeIdeaCatalog,
  variantForgePresetCatalog,
  pickVariantForgeIdeaSuggestions,
}
