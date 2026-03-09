import { describe, expect, it } from 'vitest'

import {
  buildUvJobFormData,
  isTerminalUvJobStatus,
  shouldPollUvJob,
  validateModelUpload,
} from './uvLab'

describe('validateModelUpload', () => {
  it('accepts OBJ uploads when the browser reports no MIME type', () => {
    const file = new File(['o Cube'], 'hero.OBJ', {
      type: '',
    })
    const result = validateModelUpload(file)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.asset.format).toBe('obj')
      expect(result.asset.name).toBe('hero.OBJ')
    }
  })

  it('rejects unsupported file extensions', () => {
    const file = new File(['not-a-mesh'], 'hero.glb')
    const result = validateModelUpload(file)

    expect(result).toEqual({
      error: 'UV Lab only accepts .obj or .fbx files.',
      ok: false,
    })
  })

  it('rejects files above the configured size cap', () => {
    const file = new File(['tiny'], 'hero.obj')
    const result = validateModelUpload(file, 1)

    expect(result).toEqual({
      error: 'UV Lab currently supports meshes up to 1 MB.',
      ok: false,
    })
  })
})

describe('UV job helpers', () => {
  it('marks only queued and running jobs for polling', () => {
    expect(
      shouldPollUvJob({
        id: 'queued-job',
        status: 'queued',
        step: 'importing',
      }),
    ).toBe(true)

    expect(
      shouldPollUvJob({
        id: 'running-job',
        status: 'running',
        step: 'packing',
      }),
    ).toBe(true)

    expect(
      shouldPollUvJob({
        id: 'done-job',
        status: 'succeeded',
        step: 'complete',
      }),
    ).toBe(false)

    expect(isTerminalUvJobStatus('failed')).toBe(true)
  })

  it('builds multipart payloads for UV jobs', () => {
    const validation = validateModelUpload(new File(['o Cube'], 'hero.obj'))

    if (!validation.ok) {
      throw new Error('Expected a valid OBJ file in test setup.')
    }

    const formData = buildUvJobFormData(validation.asset, {
      atlasSize: 4096,
      paddingPx: 12,
    })

    expect(formData.get('atlasSize')).toBe('4096')
    expect(formData.get('paddingPx')).toBe('12')
    expect(formData.get('mesh')).toBeInstanceOf(File)
  })
})
