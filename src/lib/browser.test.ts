import { describe, expect, it } from 'vitest'

import {
  createDataUrl,
  dataUrlToBlob,
  fileToBase64,
  parseBase64DataUrl,
} from './browser'

describe('browser encoding helpers', () => {
  it('encodes files to base64 using FileReader', async () => {
    const file = new File(['forge'], 'prompt.txt', {
      type: 'text/plain',
    })

    await expect(fileToBase64(file)).resolves.toBe('Zm9yZ2U=')
  })

  it('converts data URLs back to blobs without fetching', async () => {
    const dataUrl = createDataUrl('Zm9yZ2U=', 'text/plain')
    const blob = await dataUrlToBlob(dataUrl)

    expect(blob.type).toBe('text/plain')
    await expect(blob.text()).resolves.toBe('forge')
  })

  it('parses base64 data URLs without decoding the payload', () => {
    expect(parseBase64DataUrl(createDataUrl('Zm9yZ2U=', 'text/plain'))).toEqual({
      base64: 'Zm9yZ2U=',
      mimeType: 'text/plain',
    })
  })
})
