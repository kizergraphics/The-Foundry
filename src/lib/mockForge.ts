import type { ForgeMode, ForgeResult } from './forge'

type BuildMockResultsArgs = {
  count: number
  mode: ForgeMode
  prompt: string
}

const modeAccents: Record<
  ForgeMode,
  { accent: string; accentSoft: string; label: string }
> = {
  armory: {
    accent: '#38bdf8',
    accentSoft: '#0c4a6e',
    label: 'Armory',
  },
  'action-animator': {
    accent: '#22d3ee',
    accentSoft: '#164e63',
    label: 'Action Animator',
  },
  'texture-lab': {
    accent: '#34d399',
    accentSoft: '#064e3b',
    label: 'Texture Lab',
  },
  'variant-forge': {
    accent: '#f59e0b',
    accentSoft: '#78350f',
    label: 'Variant Forge',
  },
  'portrait-studio': {
    accent: '#f472b6',
    accentSoft: '#831843',
    label: 'Portrait Studio',
  },
  'uv-lab': {
    accent: '#fbbf24',
    accentSoft: '#78350f',
    label: 'UV Lab',
  },
  visualizer: {
    accent: '#fbbf24',
    accentSoft: '#78350f',
    label: 'Visualizer',
  },
  'vfx-forge': {
    accent: '#fb923c',
    accentSoft: '#7c2d12',
    label: 'VFX Forge',
  },
  'character-sheet': {
    accent: '#fb7185',
    accentSoft: '#881337',
    label: 'Character Sheet',
  },
}

const mockPalettes: Partial<Record<ForgeMode, string[]>> = {
  'character-sheet': ['#B7A18A', '#5A2F2F', '#D5C18A', '#4E6172', '#E8DDD2'],
}

export function buildMockResults({
  count,
  mode,
  prompt,
}: BuildMockResultsArgs): ForgeResult[] {
  const safePrompt = prompt.trim() || 'Kizer Forge mock preview'

  return Array.from({ length: count }, (_, index) => {
    const svg = buildMockSvg({
      index,
      mode,
      prompt: safePrompt,
    })

    return {
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      id: `mock-${mode}-${index + 1}`,
      mimeType: 'image/svg+xml',
      paletteHexes: mockPalettes[mode],
      text: `Mock output ${index + 1} for ${modeAccents[mode].label}. Generated locally so you can continue UI work without live Gemini quota.`,
    }
  })
}

function buildMockSvg({
  index,
  mode,
  prompt,
}: {
  index: number
  mode: ForgeMode
  prompt: string
}) {
  const accent = modeAccents[mode]
  const promptLines = chunkText(prompt, mode === 'character-sheet' ? 40 : 28).slice(0, 5)
  const isWideStrip = mode === 'action-animator' || mode === 'vfx-forge'
  const width = mode === 'character-sheet' ? 1600 : isWideStrip ? 2048 : 960
  const height = mode === 'character-sheet' ? 900 : isWideStrip ? 256 : 1200
  const contentWidth = width - 96
  const contentHeight = height - 96

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
          <stop stop-color="#0F172A"/>
          <stop offset="1" stop-color="#020617"/>
        </linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${Math.round(
          width * 0.23,
        )} ${Math.round(height * 0.14)}) rotate(41.1859) scale(${Math.round(
          width * 0.88,
        )} ${Math.round(height * 0.68)})">
          <stop stop-color="${accent.accent}" stop-opacity="0.35"/>
          <stop offset="1" stop-color="${accent.accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="44" fill="url(#bg)"/>
      <rect width="${width}" height="${height}" rx="44" fill="url(#glow)"/>
      <rect x="48" y="48" width="${contentWidth}" height="${contentHeight}" rx="30" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)"/>
      <rect x="88" y="88" width="260" height="42" rx="21" fill="${accent.accentSoft}" stroke="${accent.accent}" stroke-opacity="0.35"/>
      <text x="218" y="115" text-anchor="middle" fill="#E2E8F0" font-size="18" font-family="monospace" letter-spacing="3">MOCK FORGE</text>
      <text x="88" y="206" fill="#F8FAFC" font-size="62" font-family="Space Grotesk, sans-serif" font-weight="700">${accent.label}</text>
      <text x="88" y="252" fill="rgba(226,232,240,0.72)" font-size="20" font-family="monospace" letter-spacing="2">LOCAL PREVIEW ${String(index + 1).padStart(2, '0')}</text>
      <circle cx="${Math.round(width * 0.78)}" cy="232" r="116" fill="${accent.accentSoft}" stroke="${accent.accent}" stroke-opacity="0.55" stroke-width="3"/>
      <circle cx="${Math.round(width * 0.78)}" cy="232" r="64" fill="${accent.accent}" fill-opacity="0.16" stroke="${accent.accent}" stroke-opacity="0.5" stroke-width="2"/>
      <path d="M${Math.round(width * 0.74)} 232H${Math.round(width * 0.82)}M${Math.round(width * 0.78)} 166V298" stroke="${accent.accent}" stroke-width="6" stroke-linecap="round" opacity="0.75"/>
      <rect x="88" y="${mode === 'character-sheet' ? 304 : 334}" width="${width - 176}" height="2" fill="rgba(255,255,255,0.08)"/>
      <text x="88" y="${mode === 'character-sheet' ? 362 : 398}" fill="rgba(226,232,240,0.72)" font-size="18" font-family="monospace" letter-spacing="2">PROMPT SNAPSHOT</text>
      ${promptLines
        .map(
          (line, lineIndex) => `
            <text x="88" y="${(mode === 'character-sheet' ? 426 : 470) + lineIndex * 58}" fill="#F8FAFC" font-size="40" font-family="Space Grotesk, sans-serif" font-weight="500">${escapeXml(line)}</text>
          `,
        )
        .join('')}
      <rect x="88" y="${mode === 'character-sheet' ? 612 : 858}" width="${width - 176}" height="${mode === 'character-sheet' ? 188 : 220}" rx="24" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)"/>
      <text x="128" y="${mode === 'character-sheet' ? 666 : 928}" fill="rgba(226,232,240,0.72)" font-size="18" font-family="monospace" letter-spacing="2">WHY YOU ARE SEEING THIS</text>
      <text x="128" y="${mode === 'character-sheet' ? 718 : 986}" fill="#F8FAFC" font-size="30" font-family="Space Grotesk, sans-serif">Gemini quota or auth is unavailable, so Kizer Forge generated a local</text>
      <text x="128" y="${mode === 'character-sheet' ? 762 : 1034}" fill="#F8FAFC" font-size="30" font-family="Space Grotesk, sans-serif">stand-in result. UI, layout, downloads, and asset review can still move forward.</text>
    </svg>
  `.trim()
}

function chunkText(text: string, maxLineLength: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word

    if (nextLine.length > maxLineLength) {
      if (currentLine) {
        lines.push(currentLine)
      }
      currentLine = word
      continue
    }

    currentLine = nextLine
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
