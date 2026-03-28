import {
  getVariantForgePresetOptions,
  isVariantForgePresetForFamily,
  variantForgeDefaultPresetByFamily,
  variantForgeFamilies,
} from '../shared/variantForgeCatalog.js'
import { forgeApiModes } from '../shared/modeCatalog.js'
import {
  getDefaultVfxTextureOutputs,
  isVfxExportTarget,
  isUnityPipeline,
  isUnitySolution,
  isVfxTextureKind,
  vfxTextureKinds,
} from '../shared/vfxForgeCatalog.js'

const maxPromptLength = 4000
const maxStyleTextLength = 400
const maxSystemInstructionLength = 4000
const maxReferenceNameLength = 200
const maxBase64ImageBytes = 6 * 1024 * 1024
const maxTextureExpansionBytes = 8 * 1024 * 1024
const maxVfxTextureCount = 4
const allowedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const supportedForgeModes = new Set(forgeApiModes)
const allowedVariantForgeFamilies = new Set(variantForgeFamilies)
const allowedCharacterSheetModes = new Set(['reference', 'manifest'])
const allowedCharacterReferenceRoles = new Set([
  'Identity_Reference',
  'Clothing_Reference',
  'Style_Reference',
])
const allowedStandardReferenceSlots = new Set(['style', 'subject'])
const allowedCharacterReferenceSlots = new Set(['face', 'outfit', 'art-style'])
const allowedResponseModalities = new Set(['IMAGE', 'TEXT'])

function buildValidationError(message, details) {
  return {
    error: {
      code: 'invalid_request',
      details,
      message,
      title: 'Invalid Request',
    },
  }
}

function readTrimmedString(value, fieldName, { allowEmpty = false, maxLength = maxPromptLength } = {}) {
  if (typeof value !== 'string') {
    throw buildValidationError(`${fieldName} must be a string.`)
  }

  const normalizedValue = value.trim()

  if (!allowEmpty && normalizedValue.length === 0) {
    throw buildValidationError(`${fieldName} must not be empty.`)
  }

  if (normalizedValue.length > maxLength) {
    throw buildValidationError(`${fieldName} is too long.`)
  }

  return normalizedValue
}

function readOptionalTrimmedString(value, fieldName, maxLength) {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  return readTrimmedString(value, fieldName, {
    allowEmpty: true,
    maxLength,
  })
}

function readOptionalEnum(value, fieldName, allowedValues) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (!allowedValues.has(value)) {
    throw buildValidationError(`${fieldName} contains an unsupported value.`, [
      `Allowed values: ${Array.from(allowedValues).join(', ')}`,
    ])
  }

  return value
}

function readInteger(value, fieldName, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    throw buildValidationError(`${fieldName} must be a number.`)
  }

  const roundedValue = Math.round(numericValue)

  if (roundedValue < min || roundedValue > max) {
    throw buildValidationError(`${fieldName} is outside the allowed range.`, [
      `Expected ${fieldName} between ${min} and ${max}.`,
    ])
  }

  return roundedValue
}

function readBoolean(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  if (typeof value !== 'boolean') {
    throw buildValidationError(`${fieldName} must be a boolean.`)
  }

  return value
}

function readStringArray(value, fieldName, { allowEmpty = true, maxCount, validator } = {}) {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw buildValidationError(`${fieldName} must be an array.`)
  }

  if (typeof maxCount === 'number' && value.length > maxCount) {
    throw buildValidationError(`${fieldName} has too many entries.`)
  }

  const normalizedValues = value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw buildValidationError(`${fieldName}[${index}] must be a string.`)
    }

    const normalizedEntry = entry.trim()

    if (!allowEmpty && normalizedEntry.length === 0) {
      throw buildValidationError(`${fieldName}[${index}] must not be empty.`)
    }

    if (validator && !validator(normalizedEntry)) {
      throw buildValidationError(`${fieldName}[${index}] contains an unsupported value.`)
    }

    return normalizedEntry
  })

  return Array.from(new Set(normalizedValues.filter(Boolean)))
}

function readVariantForgeOptions(value, variantFamily) {
  if (value === undefined || value === null || value === '') {
    return []
  }

  if (!Array.isArray(value)) {
    throw buildValidationError('variantOptions must be an array.')
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw buildValidationError(`variantOptions[${index}] must be an object.`)
    }

    const preset = readOptionalTrimmedString(
      entry.preset,
      `variantOptions[${index}].preset`,
      40,
    )

    if (!preset || !isVariantForgePresetForFamily(variantFamily, preset)) {
      throw buildValidationError(`variantOptions[${index}].preset contains an unsupported value.`, [
        `Allowed values for ${variantFamily}: ${getVariantForgePresetOptions(variantFamily).join(', ')}`,
      ])
    }

    return {
      customSetting: readOptionalTrimmedString(
        entry.customSetting,
        `variantOptions[${index}].customSetting`,
        240,
      ),
      preset,
    }
  })
}

function readActionAnimatorFrameSize(value, fieldName) {
  const frameSize = readInteger(value, fieldName, {
    fallback: 512,
    max: 1080,
    min: 512,
  })

  if (frameSize !== 512 && frameSize !== 1080) {
    throw buildValidationError(`${fieldName} contains an unsupported value.`, [
      'Allowed values: 512, 1080',
    ])
  }

  return frameSize
}

function estimateBase64Bytes(value) {
  const normalized = String(value).replace(/\s+/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function validateInlineImage(image, fieldName, maxBytes = maxBase64ImageBytes) {
  if (!image || typeof image !== 'object') {
    throw buildValidationError(`${fieldName} must be an object.`)
  }

  const mimeType = readTrimmedString(image.mimeType, `${fieldName}.mimeType`, {
    maxLength: 80,
  }).toLowerCase()

  if (!allowedImageMimeTypes.has(mimeType)) {
    throw buildValidationError(`${fieldName} uses an unsupported image type.`, [
      `Allowed MIME types: ${Array.from(allowedImageMimeTypes).join(', ')}`,
    ])
  }

  const data = readTrimmedString(image.data, `${fieldName}.data`, {
    maxLength: Math.ceil((maxBytes * 4) / 3) + 16,
  })
  const estimatedBytes = estimateBase64Bytes(data)

  if (estimatedBytes <= 0 || estimatedBytes > maxBytes) {
    throw buildValidationError(`${fieldName} exceeds the allowed size.`, [
      `Maximum decoded image size: ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    ])
  }

  return {
    data,
    mimeType,
    sizeBytes: estimatedBytes,
  }
}

function validateReferenceList(
  references,
  { maxCount, roleRequired = false, slotField = false, slotAllowedValues } = {},
) {
  if (references === undefined) {
    return []
  }

  if (!Array.isArray(references)) {
    throw buildValidationError('references must be an array.')
  }

  if (references.length > maxCount) {
    throw buildValidationError('Too many references were provided.')
  }

  return references.map((reference, index) => {
    const image = validateInlineImage(reference, `references[${index}]`)
    const normalizedReference = {
      data: image.data,
      mimeType: image.mimeType,
    }

    if (typeof reference.name === 'string') {
      normalizedReference.name = reference.name.slice(0, maxReferenceNameLength)
    }

    if (roleRequired) {
      normalizedReference.role = readOptionalEnum(
        reference.role,
        `references[${index}].role`,
        allowedCharacterReferenceRoles,
      )

      if (!normalizedReference.role) {
        throw buildValidationError(`references[${index}].role is required.`)
      }
    }

    if (slotField) {
      normalizedReference.slot = readOptionalEnum(
        reference.slot,
        `references[${index}].slot`,
        slotAllowedValues ?? allowedStandardReferenceSlots,
      )

      if (!normalizedReference.slot) {
        throw buildValidationError(`references[${index}].slot is required.`)
      }
    }

    return normalizedReference
  })
}

function validateVfxTextureList(value, fieldName = 'textures') {
  if (!Array.isArray(value)) {
    throw buildValidationError(`${fieldName} must be an array.`)
  }

  if (value.length === 0 || value.length > maxVfxTextureCount) {
    throw buildValidationError(`${fieldName} must include between 1 and 4 textures.`)
  }

  const seenKinds = new Set()

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw buildValidationError(`${fieldName}[${index}] must be an object.`)
    }

    const kind = readOptionalTrimmedString(entry.kind, `${fieldName}[${index}].kind`, 40)

    if (!kind || !isVfxTextureKind(kind)) {
      throw buildValidationError(`${fieldName}[${index}].kind contains an unsupported value.`, [
        `Allowed values: ${vfxTextureKinds.join(', ')}`,
      ])
    }

    if (seenKinds.has(kind)) {
      throw buildValidationError(`${fieldName}[${index}].kind must be unique.`)
    }

    seenKinds.add(kind)

    return {
      ...validateInlineImage(entry, `${fieldName}[${index}]`, maxTextureExpansionBytes),
      kind,
      resultId: readOptionalTrimmedString(entry.resultId, `${fieldName}[${index}].resultId`, 200),
    }
  })
}

function validateOptionalPreviewList(value) {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw buildValidationError('previews must be an array.')
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw buildValidationError(`previews[${index}] must be an object.`)
    }

    return {
      ...validateInlineImage(entry, `previews[${index}]`, maxTextureExpansionBytes),
      label: readOptionalTrimmedString(entry.label, `previews[${index}].label`, 80),
    }
  })
}

export function validateForgeRequest(body) {
  const mode = readOptionalEnum(body?.mode, 'mode', supportedForgeModes)

  if (!mode) {
    throw buildValidationError('mode is required.')
  }

  const workflow =
    body?.workflow === 'expand-texture'
      ? 'expand-texture'
      : body?.workflow === 'repair-seams'
        ? 'repair-seams'
        : 'generate'
  const variantFamily =
    body?.variantFamily !== undefined || mode === 'variant-forge'
      ? readOptionalEnum(body?.variantFamily, 'variantFamily', allowedVariantForgeFamilies) ??
        'damage'
      : undefined
  const variantPreset =
    body?.variantPreset !== undefined || mode === 'variant-forge'
      ? readOptionalTrimmedString(body?.variantPreset, 'variantPreset', 40) ||
        variantForgeDefaultPresetByFamily[variantFamily ?? 'damage']
      : undefined
  const variantOptions =
    mode === 'variant-forge'
      ? readVariantForgeOptions(body?.variantOptions, variantFamily ?? 'damage')
      : undefined

  if (
    variantFamily &&
    variantPreset &&
    !isVariantForgePresetForFamily(variantFamily, variantPreset)
  ) {
    throw buildValidationError('variantPreset contains an unsupported value.', [
      `Allowed values for ${variantFamily}: ${getVariantForgePresetOptions(variantFamily).join(', ')}`,
    ])
  }

  const exportTarget =
    body?.exportTarget !== undefined || body?.unitySolution !== undefined || mode === 'vfx-forge'
      ? isVfxExportTarget(body?.exportTarget)
        ? body.exportTarget
        : isUnitySolution(body?.unitySolution)
          ? body.unitySolution
          : mode === 'vfx-forge'
            ? 'none'
            : undefined
      : undefined
  const textureKind =
    body?.textureKind !== undefined || mode === 'vfx-forge'
      ? readOptionalTrimmedString(body?.textureKind, 'textureKind', 40)
      : undefined

  if (mode === 'vfx-forge' && textureKind && !isVfxTextureKind(textureKind)) {
    throw buildValidationError('textureKind contains an unsupported value.', [
      `Allowed values: ${vfxTextureKinds.join(', ')}`,
    ])
  }

  return {
    customDirection:
      body?.customDirection !== undefined || mode === 'variant-forge'
        ? readOptionalTrimmedString(body?.customDirection, 'customDirection', 400)
        : undefined,
    effectLabel:
      body?.effectLabel !== undefined || mode === 'vfx-forge'
        ? readOptionalTrimmedString(body?.effectLabel, 'effectLabel', 120)
        : undefined,
    frameCount: readInteger(body?.frameCount, 'frameCount', {
      fallback: 8,
      max: 30,
      min: 4,
    }),
    generationCount: readInteger(body?.generationCount, 'generationCount', {
      fallback: 1,
      max: 4,
      min: 1,
    }),
    intensity: readInteger(body?.intensity, 'intensity', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    looping:
      body?.looping !== undefined || mode === 'vfx-forge'
        ? readBoolean(body?.looping, 'looping', true)
        : undefined,
    mode,
    modelId: readOptionalTrimmedString(body?.modelId, 'modelId', 80),
    preservePalette:
      body?.preservePalette !== undefined || mode === 'variant-forge'
        ? readBoolean(body?.preservePalette, 'preservePalette', false)
        : undefined,
    preserveSilhouette:
      body?.preserveSilhouette !== undefined || mode === 'variant-forge'
        ? readBoolean(body?.preserveSilhouette, 'preserveSilhouette', true)
        : undefined,
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
    rarity: readOptionalTrimmedString(body?.rarity, 'rarity', 40),
    references: validateReferenceList(body?.references, {
      maxCount: 2,
      slotField: true,
    }),
    seamRepair: body?.seamRepair
      ? {
          offsetImage: validateInlineImage(
            body.seamRepair.offsetImage,
            'seamRepair.offsetImage',
            maxTextureExpansionBytes,
          ),
          originalImage: validateInlineImage(
            body.seamRepair.originalImage,
            'seamRepair.originalImage',
            maxTextureExpansionBytes,
          ),
        }
      : undefined,
    seamlessMode: Boolean(body?.seamlessMode),
    styleId: readOptionalTrimmedString(body?.styleId, 'styleId', maxStyleTextLength),
    styleText: readOptionalTrimmedString(body?.styleText, 'styleText', maxStyleTextLength),
    systemInstruction: readOptionalTrimmedString(
      body?.systemInstruction,
      'systemInstruction',
      maxSystemInstructionLength,
    ),
    textureExpansion: body?.textureExpansion
      ? {
          canvasImage: validateInlineImage(
            body.textureExpansion.canvasImage,
            'textureExpansion.canvasImage',
            maxTextureExpansionBytes,
          ),
          sourceImage: validateInlineImage(
            body.textureExpansion.sourceImage,
            'textureExpansion.sourceImage',
            maxTextureExpansionBytes,
          ),
        }
      : undefined,
    textureKind,
    textureOutputs:
      body?.textureOutputs !== undefined || mode === 'vfx-forge'
        ? readStringArray(body?.textureOutputs, 'textureOutputs', {
            allowEmpty: false,
            maxCount: maxVfxTextureCount,
            validator: isVfxTextureKind,
          })
        : undefined,
    textureSize: readInteger(body?.textureSize, 'textureSize', {
      fallback: 1024,
      max: 1024,
      min: 512,
    }),
    unityPipeline:
      body?.unityPipeline !== undefined || mode === 'vfx-forge'
        ? isUnityPipeline(body?.unityPipeline)
          ? body.unityPipeline
          : 'urp'
        : undefined,
    exportTarget,
    variantFamily,
    variantIntensity:
      body?.variantIntensity !== undefined || mode === 'variant-forge'
        ? readInteger(body?.variantIntensity, 'variantIntensity', {
            fallback: 60,
            max: 100,
            min: 0,
          })
        : undefined,
    variantOptions,
    variantPreset,
    workflow,
  }
}

function readClampedInteger(value, fieldName, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    throw buildValidationError(`${fieldName} must be a number.`)
  }

  return Math.max(min, Math.min(max, Math.round(numericValue)))
}

export function validateVariantForgeIdeaRequest(body) {
  const variantFamily =
    readOptionalEnum(body?.variantFamily, 'variantFamily', allowedVariantForgeFamilies) ??
    'damage'
  const variantPreset =
    readOptionalTrimmedString(body?.variantPreset, 'variantPreset', 40) ||
    variantForgeDefaultPresetByFamily[variantFamily]
  const variantOptions = readVariantForgeOptions(body?.variantOptions, variantFamily)

  if (!isVariantForgePresetForFamily(variantFamily, variantPreset)) {
    throw buildValidationError('variantPreset contains an unsupported value.', [
      `Allowed values for ${variantFamily}: ${getVariantForgePresetOptions(variantFamily).join(', ')}`,
    ])
  }

  return {
    customDirection: readOptionalTrimmedString(
      body?.customDirection,
      'customDirection',
      400,
    ),
    preservePalette: readBoolean(body?.preservePalette, 'preservePalette', false),
    preserveSilhouette: readBoolean(
      body?.preserveSilhouette,
      'preserveSilhouette',
      true,
    ),
    styleText: readOptionalTrimmedString(body?.styleText, 'styleText', maxStyleTextLength),
    variantFamily,
    variantIntensity: readInteger(body?.variantIntensity, 'variantIntensity', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    variantOptions,
    variantPreset,
  }
}

export function validateMaterialMapsRequest(body) {
  return {
    heightStrength: readClampedInteger(body?.heightStrength, 'heightStrength', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    metallicStrength: readClampedInteger(body?.metallicStrength, 'metallicStrength', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    normalStrength: readClampedInteger(body?.normalStrength, 'normalStrength', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
    roughnessStrength: readClampedInteger(body?.roughnessStrength, 'roughnessStrength', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    sourceImage: validateInlineImage(body?.sourceImage, 'sourceImage', maxTextureExpansionBytes),
    sourceText: readOptionalTrimmedString(body?.sourceText, 'sourceText', maxPromptLength),
    styleText: readOptionalTrimmedString(body?.styleText, 'styleText', maxStyleTextLength),
  }
}

export function validateCharacterSheetRequest(body) {
  const generationMode = readOptionalEnum(
    body?.generationMode,
    'generationMode',
    allowedCharacterSheetModes,
  )

  if (!generationMode) {
    throw buildValidationError('generationMode is required.')
  }

  const responseModalities = Array.isArray(body?.responseModalities)
    ? body.responseModalities.filter((entry) => allowedResponseModalities.has(entry))
    : ['IMAGE', 'TEXT']

  return {
    aspectRatio:
      body?.aspectRatio === '16:9' || body?.aspectRatio === '1:1' ? body.aspectRatio : '16:9',
    consistencyReference: body?.consistencyReference
      ? validateInlineImage(body.consistencyReference, 'consistencyReference')
      : null,
    generationMode,
    modelId: readOptionalTrimmedString(body?.modelId, 'modelId', 80),
    parentId: readOptionalTrimmedString(body?.parentId, 'parentId', 200) || null,
    prompt: readTrimmedString(body?.prompt, 'prompt', {
      maxLength: maxPromptLength,
    }),
    references: validateReferenceList(body?.references, {
      maxCount: 3,
      roleRequired: true,
      slotField: true,
      slotAllowedValues: allowedCharacterReferenceSlots,
    }),
    responseModalities:
      responseModalities.length > 0 ? responseModalities : ['IMAGE', 'TEXT'],
    styleId: readOptionalTrimmedString(body?.styleId, 'styleId', maxStyleTextLength),
    systemInstruction: readOptionalTrimmedString(
      body?.systemInstruction,
      'systemInstruction',
      maxSystemInstructionLength,
    ),
  }
}

export function validateActionAnimatorRequest(body) {
  return {
    actionType: readOptionalTrimmedString(body?.actionType, 'actionType', 40) || 'idle',
    fps: readInteger(body?.fps, 'fps', {
      fallback: 8,
      max: 30,
      min: 1,
    }),
    frameCount: readInteger(body?.frameCount, 'frameCount', {
      fallback: 8,
      max: 30,
      min: 4,
    }),
    frameSize: readActionAnimatorFrameSize(body?.frameSize, 'frameSize'),
    image: validateInlineImage(body?.image, 'image'),
    modelId: readOptionalTrimmedString(body?.modelId, 'modelId', 80),
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
  }
}

export function validateActionAnimatorStripRequest(body) {
  return {
    actionType: readOptionalTrimmedString(body?.actionType, 'actionType', 40) || 'idle',
    anchorImage: validateInlineImage(body?.anchorImage, 'anchorImage'),
    canvasImage: validateInlineImage(body?.canvasImage, 'canvasImage', maxTextureExpansionBytes),
    chunkIndex: readInteger(body?.chunkIndex, 'chunkIndex', {
      fallback: 0,
      max: 32,
      min: 0,
    }),
    frameCount: readInteger(body?.frameCount, 'frameCount', {
      fallback: 4,
      max: 4,
      min: 4,
    }),
    fps: readInteger(body?.fps, 'fps', {
      fallback: 8,
      max: 30,
      min: 1,
    }),
    modelId: readOptionalTrimmedString(body?.modelId, 'modelId', 80),
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
  }
}

function validateVfxRecipeLikeRequest(body) {
  const exportTarget = isUnitySolution(body?.exportTarget)
    ? body.exportTarget
    : isUnitySolution(body?.unitySolution)
      ? body.unitySolution
      : undefined

  if (!exportTarget) {
    throw buildValidationError('exportTarget contains an unsupported value.', [
      'Allowed values: particle-system, vfx-graph',
    ])
  }

  const textureOutputs = readStringArray(body?.textureOutputs, 'textureOutputs', {
    allowEmpty: false,
    maxCount: maxVfxTextureCount,
    validator: isVfxTextureKind,
  })

  return {
    effectLabel: readOptionalTrimmedString(body?.effectLabel, 'effectLabel', 120),
    frameCount: readInteger(body?.frameCount, 'frameCount', {
      fallback: 8,
      max: 30,
      min: 4,
    }),
    intensity: readInteger(body?.intensity, 'intensity', {
      fallback: 60,
      max: 100,
      min: 0,
    }),
    looping: readBoolean(body?.looping, 'looping', true),
    previews: validateOptionalPreviewList(body?.previews),
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
    textureOutputs: textureOutputs.length > 0 ? textureOutputs : getDefaultVfxTextureOutputs(),
    textures: validateVfxTextureList(body?.textures, 'textures'),
    unityPipeline: isUnityPipeline(body?.unityPipeline) ? body.unityPipeline : 'urp',
    exportTarget,
  }
}

export function validateVfxRecipeRequest(body) {
  return validateVfxRecipeLikeRequest(body)
}

export function validateVfxExportRequest(body) {
  return validateVfxRecipeLikeRequest(body)
}

export function toValidationResponse(error) {
  if (
    error &&
    typeof error === 'object' &&
    'error' in error &&
    error.error &&
    typeof error.error === 'object'
  ) {
    return error
  }

  return buildValidationError(
    error instanceof Error ? error.message : 'The request payload is invalid.',
  )
}
