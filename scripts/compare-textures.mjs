import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { processTexture } from '../server/textureLab.js'

// Offline by default. Existing baseline images can be imported without re-running paid generations.
const args = process.argv.slice(2)
const value = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const live = args.includes('--live'),
  all = args.includes('--all')
const output = path.resolve(
  value('--output', '.codex-logs/texture-lab-comparison'),
)
const fixtures = value('--fixtures', ''),
  baselines = value('--baselines', '')
const kinds = all
  ? ['stone', 'dirt', 'wood', 'cloth', 'brick']
  : [value('--fixture', 'stone')]
const maxCalls = Number(value('--max-calls', '0'))
if (live && (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 32))
  throw new Error('Live comparisons require --max-calls between 1 and 32.')
if (kinds.some((k) => !/^[-a-zA-Z0-9_]+$/.test(k)))
  throw new Error('Fixture names must be simple filenames.')
await fs.mkdir(output, { recursive: true })
let calls = 0
const report = {
  createdAt: new Date().toISOString(),
  live,
  maxCalls,
  providerCalls: 0,
  notes: [
    'Synthetic fixtures are algorithm checks, not real-material quality evidence.',
    'Imported baseline images must come from the original pipeline using the same source.',
    'Costs remain unknown unless the provider reports them. No automatic retries.',
  ],
  results: [],
}
function synthetic(kind) {
  const size = 128,
    data = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const noise =
        (((Math.imul(x + 13, 374761393) ^ Math.imul(y + 7, 668265263)) >>> 0) %
          41) -
        20
      let rgb
      if (kind === 'wood') {
        const v =
          130 + Math.sin(x * 0.3 + Math.sin(y * 0.05) * 2) * 22 + noise * 0.25
        rgb = [v, v * 0.65, v * 0.32]
      } else if (kind === 'cloth') {
        const v =
          110 + (x % 8 < 3 ? 18 : -10) + (y % 8 < 3 ? 18 : -10) + noise * 0.2
        rgb = [v * 0.65, v * 0.8, v]
      } else if (kind === 'brick') {
        const mortar =
          y % 24 < 3 || (x + (Math.floor(y / 24) % 2) * 24) % 48 < 3
        rgb = mortar
          ? [155, 150, 140]
          : [140 + noise, 65 + noise * 0.4, 40 + noise * 0.3]
      } else if (kind === 'dirt')
        rgb = [105 + noise, 80 + noise * 0.8, 53 + noise * 0.6]
      else {
        const crack =
          (x + Math.round(9 * Math.sin(y * 0.09))) % 37 < 2 ||
          (y + Math.round(4 * Math.sin(x * 0.13))) % 31 < 2
        const v = crack ? 40 : 125 + noise * 0.5
        rgb = [v, v + 3, v + 7]
      }
      for (let c = 0; c < 3; c++)
        data[(y * size + x) * 3 + c] = Math.max(
          0,
          Math.min(255, Math.round(rgb[c])),
        )
    }
  return sharp(data, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer()
}
async function remote(input) {
  if (calls >= maxCalls) throw new Error('Provider call budget exhausted.')
  calls++
  const response = await fetch(
    value('--url', 'http://localhost:3001') + '/api/forge',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.FOUNDRY_INTERNAL_TOKEN
          ? { 'x-internal-api-token': process.env.FOUNDRY_INTERNAL_TOKEN }
          : {}),
      },
      body: JSON.stringify({
        mode: 'texture-lab',
        workflow: 'expand-texture',
        modelId: value('--model', 'openai-gpt-image-2'),
        prompt: 'Continue the same material with varied new detail.',
        quality: 'low',
        textureExpansion: input,
      }),
    },
  )
  const payload = await response.json()
  if (!response.ok || !payload.images?.length)
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : (payload.error?.message ?? 'Provider operation failed'),
    )
  return payload.images[0]
}
for (const kind of kinds) {
  const source = fixtures
    ? await fs.readFile(path.join(fixtures, kind + '.png'))
    : await synthetic(kind)
  const sourceName = kind + '-source.png'
  await fs.writeFile(path.join(output, sourceName), source)
  const sourceImage = { data: source.toString('base64'), mimeType: 'image/png' }
  for (const technique of [
    'baseline',
    'faithful',
    ...(live ? ['creative'] : []),
  ])
    for (let variant = 1; variant <= 2; variant++) {
      const name = `${kind}-${technique}-${variant}.png`,
        started = Date.now()
      const row = {
        fixture: kind,
        synthetic: !fixtures,
        technique,
        variant,
        source: sourceName,
        image: name,
        status: 'pending',
        runtimeMs: 0,
        processRssBytes: null,
        usage: null,
        cost: null,
        review: {
          repeatedMarks: null,
          seamsAndCorners: null,
          sourceBoundary: null,
          materialIdentity: null,
          featureScale: null,
          blur: null,
          notes: '',
        },
      }
      try {
        if (technique === 'baseline') {
          if (!baselines) {
            row.status = 'baseline not supplied'
            row.image = null
            report.results.push(row)
            continue
          }
          await fs.copyFile(path.join(baselines, name), path.join(output, name))
          row.status = 'imported'
        } else {
          const input = {
            sourceImage,
            targetSize: 512,
            factor: 2,
            direction: 'all',
            preservation: 'preserve',
            technique,
            seamlessMode: true,
            seed: 100 + variant,
          }
          const run = technique === 'faithful' ? processTexture : remote
          const expanded = await run(input)
          const finished = await run({
            ...input,
            operation: 'finish',
            baseImage: expanded,
          })
          await fs.writeFile(
            path.join(output, name),
            Buffer.from(finished.data, 'base64'),
          )
          row.status = finished.texture.status
          row.metadata = finished.texture
          row.usage = [
            expanded.texture.usage ?? null,
            finished.texture.usage ?? null,
          ]
          if (technique === 'faithful')
            row.processRssBytes = process.memoryUsage().rss
        }
      } catch (error) {
        row.status = 'failed'
        row.error = error.message
        row.image = null
      }
      row.runtimeMs = Date.now() - started
      report.results.push(row)
    }
}
report.providerCalls = calls
await fs.writeFile(
  path.join(output, 'results.json'),
  JSON.stringify(report, null, 2),
)
const escape = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
const cards = report.results
  .map(
    (r) =>
      `<article><h2>${escape(r.fixture)} / ${escape(r.technique)} ${r.variant}</h2><p>${escape(r.status)} · ${r.runtimeMs}ms${r.synthetic ? ' · synthetic fixture' : ''}</p><div class="views"><img src="${r.source}" alt="source">${r.image ? `<img src="${r.image}" alt="output"><div class="tile" style="background-image:url('${r.image}')"></div>` : ''}</div><label>Review: repetitions, seams, source boundary, identity, scale, blur<textarea placeholder="Record visual findings here; export the JSON separately."></textarea></label></article>`,
  )
  .join('')
await fs.writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Texture Lab comparison</title><style>body{background:#10151c;color:#e8edf2;font:15px system-ui;margin:32px}article{padding:20px;border:1px solid #405064;margin:20px 0;border-radius:16px}.views{display:flex;gap:16px;flex-wrap:wrap}.views img,.tile{width:256px;height:256px;object-fit:contain}.tile{background-size:33.333%}textarea{display:block;width:95%;height:70px;margin-top:10px}button{padding:10px;margin:10px}</style><h1>Texture Lab comparison</h1><p>Source / 1× output / tiled 3×3. Edge continuity and internal repetition are separate criteria. This report makes no quality claim.</p><p>${calls} provider calls. Missing baselines and real examples remain explicit.</p><button onclick="document.querySelectorAll('.tile').forEach(e=>e.style.backgroundSize='20%')">5×5</button><button onclick="document.querySelectorAll('.tile').forEach(e=>e.style.backgroundSize='33.333%')">3×3</button>${cards}`,
)
console.log(
  JSON.stringify(
    {
      output,
      providerCalls: calls,
      results: report.results.map(({ fixture, technique, status }) => ({
        fixture,
        technique,
        status,
      })),
    },
    null,
    2,
  ),
)
