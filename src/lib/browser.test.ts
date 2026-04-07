import { describe, expect, it } from 'vitest'

import {
  createDataUrl,
  dataUrlToBlob,
  fileToBase64,
  inferSpriteSheetGridLayout,
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

  it('prefers a single-row strip when the sprite sheet is wide enough for the expected frame count', () => {
    expect(
      inferSpriteSheetGridLayout({
        detectedColumnCount: 10,
        detectedRowCount: 1,
        expectedCount: 10,
        height: 400,
        width: 4000,
      }),
    ).toEqual({
      columns: 10,
      rows: 1,
    })
  })

  it('falls back to a multi-row grid when a one-row strip would produce implausibly thin frames', () => {
    expect(
      inferSpriteSheetGridLayout({
        detectedColumnCount: 6,
        detectedRowCount: 2,
        expectedCount: 10,
        height: 768,
        width: 1408,
      }),
    ).toEqual({
      columns: 6,
      rows: 2,
    })
  })
})
