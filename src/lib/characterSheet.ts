import { createDataUrl, fileToBase64 } from './browser'
import type {
  CharacterSheetGenerationMode,
  CharacterSheetReferenceSlot,
  CharacterSheetState,
  ForgeResult,
} from './forge'

export const defaultCharacterSheetModel = 'gemini-3-pro'

export type CharacterSheetReferenceRole =
  | 'Identity_Reference'
  | 'Clothing_Reference'
  | 'Style_Reference'

export type CharacterSheetEncodedReference = {
  data: string
  mimeType: string
  name: string
  role: CharacterSheetReferenceRole
  slot: CharacterSheetReferenceSlot
}

export type CharacterSheetRequestPayload = {
  aspectRatio: '16:9'
  candidateCount: 1
  consistencyEnabled: boolean
  generationMode: CharacterSheetGenerationMode
  modelId: string
  parentId: string | null
  prompt: string
  references: CharacterSheetEncodedReference[]
  responseModalities: ['IMAGE', 'TEXT']
  systemInstruction: string
}

export const characterSheetSystemInstruction =
  'Provide the 5 dominant hex codes for this character at the end of the response.'

const manifestPrefix =
  'Lead Concept Artist Instruction: Design a character from scratch. Output a professional 16:9 composite character sheet. Requirements: Front A-pose, Profile, and Rear view aligned horizontally on a #808080 gray background. Style: Thick line art, cel-shaded.'

const referencePrefix =
  'Lead Concept Artist Instruction: Output a professional 16:9 composite character sheet. Requirements: Front A-pose, Profile, and Rear view aligned horizontally on a #808080 gray background. Style: Thick line art, cel-shaded.'

const characterReferenceRoleMap: Record<
  CharacterSheetReferenceSlot,
  CharacterSheetReferenceRole
> = {
  face: 'Identity_Reference',
  outfit: 'Clothing_Reference',
  'art-style': 'Style_Reference',
}

export function getCharacterSheetPromptSource(state: CharacterSheetState) {
  return state.generationMode === 'manifest'
    ? state.manifestPrompt
    : state.referencePrompt
}

export function buildCharacterSheetPrompt(state: CharacterSheetState) {
  const userInput = getCharacterSheetPromptSource(state).trim()

  if (state.generationMode === 'manifest') {
    return [manifestPrefix, userInput].filter(Boolean).join('\n\n')
  }

  return [
    referencePrefix,
    'Reference roles:',
    'Image 1: Identity_Reference (Face/Face shape).',
    'Image 2: Clothing_Reference (Outfit/Armor).',
    'Image 3: Style_Reference (Line weight/Coloring).',
    userInput ? `Additional direction: ${userInput}` : '',
    'Synthesize these references into a 3-view character sheet. Identity from Image 1 and Clothing from Image 2 must be pixel-perfect across all poses.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function buildCharacterSheetRequest(
  state: CharacterSheetState,
  modelId: string,
): Promise<CharacterSheetRequestPayload> {
  const references = await Promise.all(
    (['face', 'outfit', 'art-style'] as CharacterSheetReferenceSlot[])
      .map((slot) => ({ asset: state.references[slot], slot }))
      .filter(
        (
          entry,
        ): entry is {
          asset: NonNullable<(typeof state.references)[CharacterSheetReferenceSlot]>
          slot: CharacterSheetReferenceSlot
        } => Boolean(entry.asset),
      )
      .map(async ({ asset, slot }) => ({
        data: await fileToBase64(asset.file),
        mimeType: asset.mimeType,
        name: asset.name,
        role: characterReferenceRoleMap[slot],
        slot,
      })),
  )

  return {
    aspectRatio: '16:9',
    candidateCount: 1,
    consistencyEnabled: state.consistencyEnabled,
    generationMode: state.generationMode,
    modelId,
    parentId: state.consistencyEnabled ? state.parentId : null,
    prompt: buildCharacterSheetPrompt(state),
    references,
    responseModalities: ['IMAGE', 'TEXT'],
    systemInstruction: characterSheetSystemInstruction,
  }
}

export async function generateCharacterSheet({
  modelId,
  state,
}: {
  modelId: string
  state: CharacterSheetState
}) {
  const request = await buildCharacterSheetRequest(state, modelId)
  const response = await fetch('/api/character-sheet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = (await response.json()) as
    | {
        error?:
          | string
          | {
              code?: string
              details?: string[]
              message?: string
              retryAfterSeconds?: number
              title?: string
            }
        images?: Array<{
          data: string
          id: string
          mimeType: string
          text?: string
        }>
        model?: string
        prompt?: string
      }
    | undefined

  if (!response.ok || !payload?.images?.length) {
    throw payload?.error ?? 'Character Sheet generation failed.'
  }

  return {
    model: payload.model ?? null,
    prompt: payload.prompt ?? null,
    results: payload.images.map<ForgeResult>((image) => ({
      dataUrl: createDataUrl(image.data, image.mimeType),
      id: image.id,
      mimeType: image.mimeType,
      paletteHexes: extractPaletteHexes(image.text),
      text: image.text,
    })),
  }
}

export function extractPaletteHexes(text?: string) {
  if (!text) {
    return []
  }

  const matches = text.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g) ?? []
  const unique = matches.map((value) => value.toUpperCase())

  return Array.from(new Set(unique)).slice(0, 5)
}
