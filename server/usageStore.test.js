import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadUsageStore(env = {}) {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    ...env,
  }

  return import('./usageStore.js')
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('usageStore data directory', () => {
  it('writes runtime telemetry to the configured user-data directory', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'foundry-user-data-'))
    const usageStore = await loadUsageStore({
      FOUNDRY_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'production',
    })

    await usageStore.recordUsageEvent({
      model: 'gemini-3-flash',
      route: '/api/forge',
      telemetryModel: 'nano-banana-2',
      timestamp: '2026-05-03T14:30:00.000Z',
      tokenCount: 123,
    })

    await expect(
      fs.readFile(path.join(userDataDir, 'server-data', 'usage-events.ndjson'), 'utf8'),
    ).resolves.toContain('"model":"gemini-3-flash"')

    await fs.rm(userDataDir, {
      force: true,
      recursive: true,
    })
  })
})
