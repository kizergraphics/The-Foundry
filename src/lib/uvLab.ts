import type { ModelAsset, ModelFormat, UvLabAtlasSize } from './forge'
import {
  clampUvAtlasSize,
  clampUvPaddingPx,
  toModelAsset,
} from './forge'

export type UvArtifactManifest = {
  atlas: UvJobArtifact
  mesh: UvJobArtifact
  previewGlb: UvJobArtifact
}

export type UvJobArtifact = {
  downloadUrl: string
  fileName: string
  mimeType: string
}

export type UvJobError = {
  code?: string
  message: string
}

export type UvJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type UvJobStep =
  | 'importing'
  | 'unwrapping'
  | 'packing'
  | 'exporting'
  | 'complete'

export type UvJobStats = {
  atlasSize: number
  inputFormat: ModelFormat
  triangleCount: number
  uvCoveragePct: number
  uvIslandCount: number
}

export type UvJobSummary = {
  id: string
  status: UvJobStatus
  step: UvJobStep
}

export type UvJobStatusResponse = UvJobSummary & {
  artifacts?: UvArtifactManifest | null
  error?: UvJobError | null
  stats?: UvJobStats | null
}

export type UvJobRequestOptions = {
  atlasSize: UvLabAtlasSize
  paddingPx: number
}

export type UvEngineState = 'idle' | 'loading' | 'ready' | 'error'

export type ModelValidationResult =
  | { asset: ModelAsset; ok: true }
  | { error: string; ok: false }

export const uvJobPollIntervalMs = 2000
export const maxUvUploadBytes = 100 * 1024 * 1024

export function validateModelUpload(
  file: File,
  maxBytes = maxUvUploadBytes,
): ModelValidationResult {
  if (file.size > maxBytes) {
    return {
      error: `UV Lab currently supports meshes up to ${Math.round(
        Math.max(1, maxBytes / (1024 * 1024)),
      )} MB.`,
      ok: false,
    }
  }

  try {
    return {
      asset: toModelAsset(file),
      ok: true,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'UV Lab only accepts .obj or .fbx files.',
      ok: false,
    }
  }
}

export function buildUvJobFormData(
  asset: ModelAsset,
  options: UvJobRequestOptions,
): FormData {
  const formData = new FormData()
  formData.append('mesh', asset.file, asset.name)
  formData.append('atlasSize', String(clampUvAtlasSize(options.atlasSize)))
  formData.append('paddingPx', String(clampUvPaddingPx(options.paddingPx)))
  return formData
}

export function isTerminalUvJobStatus(status: UvJobStatus) {
  return status === 'succeeded' || status === 'failed'
}

export function shouldPollUvJob(job: UvJobStatusResponse | null) {
  if (!job) {
    return false
  }

  return !isTerminalUvJobStatus(job.status)
}

export function getUvMeshArtifactLabel(job: UvJobStatusResponse | null) {
  if (job?.stats?.inputFormat === 'fbx') {
    return 'Processed FBX'
  }

  if (job?.stats?.inputFormat === 'obj') {
    return 'Processed OBJ'
  }

  return 'Processed Mesh'
}

export function formatUvCoverage(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable'
  }

  return `${value.toFixed(1)}%`
}

export function formatTriangleCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable'
  }

  return new Intl.NumberFormat().format(Math.round(value))
}

export function formatUvStep(step: UvJobStep) {
  switch (step) {
    case 'importing':
      return 'Importing mesh'
    case 'unwrapping':
      return 'Generating UV seams and unwrap'
    case 'packing':
      return 'Packing islands'
    case 'exporting':
      return 'Exporting artifacts'
    case 'complete':
      return 'Complete'
    default:
      return step
  }
}

export function revokeUvJobArtifacts(job: UvJobStatusResponse | null) {
  if (!job?.artifacts) {
    return
  }

  for (const artifact of Object.values(job.artifacts)) {
    if (artifact?.downloadUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(artifact.downloadUrl)
    }
  }
}
