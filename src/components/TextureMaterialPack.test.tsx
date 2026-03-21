import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TextureMaterialPack } from './TextureMaterialPack'

const sourceResult = {
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII=',
  id: 'texture-result-1',
  mimeType: 'image/png',
  text: 'weathered stone floor',
}

const strengthDefaults = {
  heightStrength: 60,
  metallicStrength: 60,
  normalStrength: 60,
  roughnessStrength: 60,
}

describe('TextureMaterialPack', () => {
  it('renders loading placeholders while maps are being generated', () => {
    render(
      <TextureMaterialPack
        error={null}
        isDirty={false}
        isLoading
        maps={{}}
        onDownloadAll={() => {}}
        onDownloadMap={() => {}}
        onRegenerate={() => {}}
        onStrengthChange={() => {}}
        sourceResult={sourceResult}
        strengths={strengthDefaults}
      />,
    )

    expect(screen.getByText('Generating')).toBeInTheDocument()
    expect(screen.getByText('Generating height map...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download All Maps/i })).toBeDisabled()
  })

  it('shows errors, dirty state, and forwards regenerate and download actions', () => {
    const onDownloadAll = vi.fn()
    const onDownloadMap = vi.fn()
    const onRegenerate = vi.fn()
    const onStrengthChange = vi.fn()

    const { container } = render(
      <TextureMaterialPack
        error={{
          message: 'Map generation failed upstream.',
          title: 'Material Maps Failed',
        }}
        isDirty
        isLoading={false}
        maps={{
          height: {
            dataUrl: sourceResult.dataUrl,
            height: 1,
            id: 'height-1',
            mimeType: 'image/png',
            width: 1,
          },
          metallic: {
            dataUrl: sourceResult.dataUrl,
            height: 1,
            id: 'metallic-1',
            mimeType: 'image/png',
            width: 1,
          },
          normal: {
            dataUrl: sourceResult.dataUrl,
            height: 1,
            id: 'normal-1',
            mimeType: 'image/png',
            width: 1,
          },
          roughness: {
            dataUrl: sourceResult.dataUrl,
            height: 1,
            id: 'roughness-1',
            mimeType: 'image/png',
            width: 1,
          },
        }}
        onDownloadAll={onDownloadAll}
        onDownloadMap={onDownloadMap}
        onRegenerate={onRegenerate}
        onStrengthChange={onStrengthChange}
        sourceResult={sourceResult}
        strengths={strengthDefaults}
      />,
    )
    const renderedPack = within(container)

    expect(renderedPack.getByText('Needs Attention')).toBeInTheDocument()
    expect(renderedPack.getByText('Material Maps Failed')).toBeInTheDocument()
    fireEvent.click(renderedPack.getAllByRole('button', { name: /Regenerate Maps/i })[0])
    fireEvent.click(renderedPack.getByRole('button', { name: /Download All Maps/i }))
    fireEvent.click(renderedPack.getByRole('button', { name: /Download Height/i }))
    fireEvent.change(renderedPack.getByLabelText(/Height Strength/i), {
      target: { value: '84' },
    })

    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onDownloadAll).toHaveBeenCalledTimes(1)
    expect(onDownloadMap).toHaveBeenCalledWith('height')
    expect(onStrengthChange).toHaveBeenCalledWith('heightStrength', 84)
  })
})
