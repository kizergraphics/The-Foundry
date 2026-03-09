declare module '@sruim/mesh-flow' {
  export type MeshFlowTarget = 'fbx' | 'glb' | 'obj' | 'ply' | 'stl' | 'usd'

  export type MeshFlowInput =
    | ArrayBuffer
    | Blob
    | File
    | Uint8Array
    | { data: Uint8Array; name: string }
    | { files: Array<{ data: Uint8Array; name: string }> }
    | string

  export type MeshFlowOptions = {
    binary?: boolean
    embedTextures?: boolean
    name?: string
  }

  export function createAssimp(): Promise<unknown>
  export function convert(
    input: MeshFlowInput,
    target: MeshFlowTarget,
    options?: MeshFlowOptions,
  ): Promise<Uint8Array>
}
