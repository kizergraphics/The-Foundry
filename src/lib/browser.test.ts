import { describe, expect, it } from 'vitest'

import { createDataUrl, dataUrlToBlob, fileToBase64 } from './browser'

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
})
