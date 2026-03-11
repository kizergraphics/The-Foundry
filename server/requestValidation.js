const maxPromptLength = 4000
const maxStyleTextLength = 400
const maxSystemInstructionLength = 4000
const maxReferenceNameLength = 200
const maxBase64ImageBytes = 6 * 1024 * 1024
const maxTextureExpansionBytes = 8 * 1024 * 1024
const allowedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const supportedForgeModes = new Set([
  'armory',
  'loot-leveler',
  'portrait-studio',
  'texture-lab',
  'vfx-forge',
  'visualizer',
])
const allowedCharacterSheetModes = new Set(['reference', 'manifest'])
const allowedCharacterReferenceRoles = new Set([
  'Identity_Reference',
  'Clothing_Reference',
  'Style_Reference',
])
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

function validateReferenceList(references, { maxCount, roleRequired = false, slotField = false } = {}) {
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
        allowedCharacterReferenceSlots,
      )

      if (!normalizedReference.slot) {
        throw buildValidationError(`references[${index}].slot is required.`)
      }
    }

    return normalizedReference
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

  return {
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
    mode,
    modelId: readOptionalTrimmedString(body?.modelId, 'modelId', 80),
    projectileType: readOptionalTrimmedString(body?.projectileType, 'projectileType', 120),
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
    rarity: readOptionalTrimmedString(body?.rarity, 'rarity', 40),
    references: validateReferenceList(body?.references, {
      maxCount: 2,
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
    textureSize: readInteger(body?.textureSize, 'textureSize', {
      fallback: 1024,
      max: 1024,
      min: 512,
    }),
    workflow,
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
    image: validateInlineImage(body?.image, 'image'),
    modelId: readOptionalTrimmedString(body?.modelId, 'modelId', 80),
    prompt: readOptionalTrimmedString(body?.prompt, 'prompt', maxPromptLength),
  }
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
