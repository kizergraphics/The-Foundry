import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { TextureLabControls, TextureLabWorkspace } from './TextureLabWorkspace'
import {
  textureDefaults,
  validateTextureRequest,
  textureGeometry,
} from '../../shared/textureLab.js'
import type { ForgeResult } from '../lib/forge'
afterEach(cleanup)
describe('Texture Lab workspace', () => {
  it('exposes expansion-only controls and the planned call count', () => {
    const change = vi.fn(),
      seam = vi.fn()
    render(
      <TextureLabControls
        settings={{ ...textureDefaults, factor: 4, variants: 2 }}
        onSettingsChange={change}
        expansionTargetSize={512}
        onTargetSizeChange={vi.fn()}
        seamlessMode={true}
        onSeamlessModeChange={seam}
        source={null}
        modelId="openai-gpt-image-2"
      />,
    )
    fireEvent.change(screen.getByLabelText('Direction'), {
      target: { value: 'left' },
    })
    expect(change).toHaveBeenCalledWith({ direction: 'left' })
    fireEvent.click(screen.getByLabelText('Seamless Mode'))
    expect(seam).toHaveBeenCalledWith(false)
    expect(screen.getByText(/6 planned provider calls/)).toBeInTheDocument()
  })
  it('selects, previews, edits and exports the explicitly selected candidate', () => {
    const options = validateTextureRequest({ targetSize: 512 }),
      download = vi.fn(),
      edit = vi.fn()
    const results: ForgeResult[] = ['a', 'b'].map((id) => ({
      id,
      dataUrl: 'data:image/png;base64,YQ==',
      mimeType: 'image/png',
      texture: {
        options,
        sourceRect: textureGeometry(40, 40, options),
        generationSize: 1024,
        exportSize: 512,
        status: 'expanded',
        maskMode: 'test',
        elapsedMs: 1,
      },
    }))
    const runner = {
      busy: false,
      progress: '',
      error: '',
      pending: false,
      start: vi.fn(),
      edit,
      resume: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
    }
    render(
      <TextureLabWorkspace
        results={results}
        runner={runner}
        onDownload={download}
      />,
    )
    fireEvent.change(screen.getByLabelText('Selected candidate'), {
      target: { value: 'a' },
    })
    fireEvent.click(screen.getByText('5×5'))
    expect(screen.getByText('5×5')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('Export selected candidate'))
    expect(download).toHaveBeenCalledWith(results[0], 0)
    fireEvent.click(screen.getByText('1×1'))
    fireEvent.click(screen.getByText('Select corner region'))
    fireEvent.click(screen.getByText('Regenerate selected region'))
    expect(edit).toHaveBeenCalledWith(results[0], {
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    })
  })
})
