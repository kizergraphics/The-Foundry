import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PbrMaterialWorkbench from './PbrMaterialWorkbench'
import { deriveMaterial, loadMaterialImage } from '../lib/pbrMaterial'
vi.mock('@react-three/fiber', () => ({ Canvas: () => <div>3D canvas</div> }))
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }))
vi.mock('../lib/pbrMaterial', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/pbrMaterial')>()
  return { ...actual, loadMaterialImage: vi.fn(), deriveMaterial: vi.fn(), pixelsCanvas: vi.fn(() => document.createElement('canvas')) }
})
const pixel = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) }
const maps = { albedo: pixel, height: pixel, normal: pixel, ao: pixel, roughness: pixel, metallic: pixel }
beforeEach(() => {
  vi.mocked(loadMaterialImage).mockResolvedValue(pixel)
  vi.mocked(deriveMaterial).mockResolvedValue(maps)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as ReturnType<typeof HTMLCanvasElement.prototype.getContext>)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
describe('PBR workbench state', () => {
  it('starts with export disabled until a valid source is processed', () => {
    render(<PbrMaterialWorkbench />)
    expect((screen.getByText('Download PBR ZIP') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: 'Material processing status' }).textContent).toContain('Import an approved texture')
  })
  it('invalidates prior exports immediately when the approved source changes', async () => {
    const { rerender } = render(<PbrMaterialWorkbench source="first" />)
    await waitFor(() => expect((screen.getByText('Download PBR ZIP') as HTMLButtonElement).disabled).toBe(false))
    rerender(<PbrMaterialWorkbench source="second" />)
    expect((screen.getByText('Download PBR ZIP') as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(vi.mocked(loadMaterialImage)).toHaveBeenCalledWith('second', 512))
  })
  it('rejects unsupported imports without processing their bytes', () => {
    render(<PbrMaterialWorkbench />)
    fireEvent.change(screen.getByLabelText('Import albedo source'), { target: { files: [new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })] } })
    expect(screen.getByRole('status', { name: 'Material processing status' }).textContent).toContain('Choose a PNG')
    expect(loadMaterialImage).not.toHaveBeenCalled()
  })
  it('uses the selected expansion even when an imported albedo was active', async () => {
    const { rerender } = render(<PbrMaterialWorkbench source="expanded" />)
    fireEvent.change(screen.getByLabelText('Import albedo source'), {
      target: { files: [new File(['imported'], 'albedo.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(loadMaterialImage).toHaveBeenLastCalledWith(expect.stringMatching(/^data:image\/png/), 512))
    rerender(<PbrMaterialWorkbench source="expanded" sourceRevision={1} />)
    expect((screen.getByText('Download PBR ZIP') as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(loadMaterialImage).toHaveBeenLastCalledWith('expanded', 512))
  })
  it('shows decoding failures and leaves export unavailable', async () => {
    vi.mocked(loadMaterialImage).mockRejectedValue(new Error('Invalid image'))
    render(<PbrMaterialWorkbench source="broken" />)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Material processing status' }).textContent).toBe('Invalid image'))
    expect((screen.getByText('Download PBR ZIP') as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not publish processing that completes after a source is removed', async () => {
    let finish: (value: typeof maps) => void = () => undefined
    vi.mocked(deriveMaterial).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { rerender } = render(<PbrMaterialWorkbench source="first" />)
    await waitFor(() => expect(deriveMaterial).toHaveBeenCalledTimes(1))
    rerender(<PbrMaterialWorkbench />)
    finish(maps)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect((screen.getByText('Download PBR ZIP') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('3D canvas')).toBeNull()
  })
})
