import { buildActionAnimatorPrompt } from '../lib/actionAnimator'
import { getCharacterSheetPromptSource, buildCharacterSheetPrompt } from '../lib/characterSheet'
import {
  getVariantForgeEnabledPresets,
  getVariantForgeFamilyCustomDirection,
  getVariantForgeOptionState,
  initialState,
  modeDefinitions,
  type ForgeMode,
  type ForgeState,
  type ModeDefinition,
} from '../lib/forge'
import { formatVariantForgeLabel } from '../../shared/variantForgeCatalog.js'
import {
  getVfxExportTargetLabel,
  getVfxTextureLabel,
  resolveVfxEffectLabel,
  type VfxTextureKind,
} from '../../shared/vfxForgeCatalog.js'

export type ForgeBriefItem = {
  label: string
  value: string
}

export type ModeFlags = {
  isActionAnimatorMode: boolean
  isCharacterSheetMode: boolean
  isPortraitStudioMode: boolean
  isTextureExpansionMode: boolean
  isTextureLabMode: boolean
  isUvLabMode: boolean
  isVariantForgeMode: boolean
  isVfxForgeMode: boolean
}

export type ModePresentation = {
  activeMode: ModeDefinition
  activePromptValue: string
  briefItems: ForgeBriefItem[]
  controlPanelTitle: string
  flags: ModeFlags
  headerInputLabel: string
  isReadyForApi: boolean
  isSingleResultMode: boolean
  primaryActionDescription: string
  primaryActionLabel: string
  promptPreview: string
  readinessLabel: string
  referenceCount: number
  resultGridTitle: string
  useWideControlGrid: boolean
}

export const defaultTextureExpansionPrompt =
  'Generatively expand this texture. Use the central pattern as a reference to fill the outer edges with a matching material with varied new detail. Maintain identical grain, lighting, and color.'

export function getModePresentation({
  isForging,
  selectedModelSupported,
  state,
}: {
  isForging: boolean
  selectedModelSupported: boolean
  state: ForgeState
  styleText: string
}): ModePresentation {
  const flags = getModeFlags(state.activeMode, state)
  const activeMode = modeDefinitions[state.activeMode]
  const promptPreview = getModePromptPreview(state, flags)
  const activePromptValue = getModeActivePromptValue(state, promptPreview, flags)
  const referenceCount = getReferenceCount(state, flags)
  const isReadyForApi = getIsReadyForApi(state, flags)
  const isSingleResultMode =
    flags.isActionAnimatorMode ||
    flags.isCharacterSheetMode ||
    flags.isPortraitStudioMode ||
    flags.isTextureExpansionMode ||
    flags.isUvLabMode ||
    flags.isVariantForgeMode ||
    flags.isVfxForgeMode

  return {
    activeMode,
    activePromptValue,
    briefItems: getBriefItems(state, flags),
    controlPanelTitle: flags.isCharacterSheetMode
      ? 'Sheet settings'
      : flags.isActionAnimatorMode
        ? 'Animator settings'
        : flags.isVariantForgeMode
          ? 'Variant settings'
          : flags.isPortraitStudioMode
            ? 'Portrait settings'
            : flags.isUvLabMode
              ? 'UV settings'
              : flags.isVfxForgeMode
                ? 'VFX settings'
                : 'Forge settings',
    flags,
    headerInputLabel: flags.isTextureExpansionMode
      ? 'Source'
      : flags.isActionAnimatorMode || flags.isPortraitStudioMode || flags.isVariantForgeMode
        ? 'Image'
        : flags.isUvLabMode
          ? 'Mesh'
          : flags.isVfxForgeMode
            ? 'Config'
            : 'Prompt',
    isReadyForApi,
    isSingleResultMode,
    primaryActionDescription: getPrimaryActionDescription({
      flags,
      isForging,
      selectedModelSupported,
      state,
    }),
    primaryActionLabel: getPrimaryActionLabel({ flags, isForging }),
    promptPreview,
    readinessLabel: getReadinessLabel({ flags, isForging, isReadyForApi }),
    referenceCount,
    resultGridTitle: flags.isCharacterSheetMode
      ? 'Character sheet output slot'
      : flags.isActionAnimatorMode
        ? 'Action Animator sprite sheet'
        : flags.isVariantForgeMode
          ? 'Variant Forge output slot'
          : flags.isPortraitStudioMode
            ? 'Portrait Studio contact sheet'
              : flags.isUvLabMode
                ? 'UV layout, processed mesh, and preview'
                : flags.isVfxForgeMode
                  ? 'VFX Forge texture ingredient outputs'
                  : 'Output slots for the current forge pass',
    useWideControlGrid: !flags.isActionAnimatorMode && !flags.isCharacterSheetMode,
  }
}

export function getModeFlags(activeMode: ForgeMode, state: ForgeState): ModeFlags {
  const isActionAnimatorMode = activeMode === 'action-animator'
  const isCharacterSheetMode = activeMode === 'character-sheet'
  const isPortraitStudioMode = activeMode === 'portrait-studio'
  const isTextureLabMode = activeMode === 'texture-lab'
  const isUvLabMode = activeMode === 'uv-lab'
  const isVariantForgeMode = activeMode === 'variant-forge'
  const isTextureExpansionMode =
    isTextureLabMode && state.textureLab.workflow === 'expand'
  const isVfxForgeMode = activeMode === 'vfx-forge'

  return {
    isActionAnimatorMode,
    isCharacterSheetMode,
    isPortraitStudioMode,
    isTextureExpansionMode,
    isTextureLabMode,
    isUvLabMode,
    isVariantForgeMode,
    isVfxForgeMode,
  }
}

export function buildActiveVariantForgeOptions(state: typeof initialState.variantForge) {
  return getVariantForgeEnabledPresets(state.variantFamily, state.optionStates).map((preset) => ({
    customSetting: getVariantForgeOptionState(state.optionStates, preset).customSetting.trim(),
    preset,
  }))
}

export function buildVariantForgePromptPreview(state: typeof initialState.variantForge) {
  const activeOptions = buildActiveVariantForgeOptions(state)
  const activeFamilyCustomDirection = getVariantForgeFamilyCustomDirection(
    state.variantFamily,
    state.familyCustomDirections,
  )

  return [
    activeOptions.length > 0
      ? `Transform the base asset using the ${formatVariantForgeLabel(state.variantFamily)} family with a ${formatVariantForgeLabel(state.variantPreset)} preset.`
      : `Transform the base asset using the ${formatVariantForgeLabel(state.variantFamily)} family with no preset toggles enabled.`,
    activeOptions.length > 1
      ? `Blend these active options: ${activeOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')}.`
      : null,
    ...activeOptions
      .filter((option) => option.customSetting)
      .map(
        (option) =>
          `${formatVariantForgeLabel(option.preset)} custom setting: ${option.customSetting}.`,
      ),
    state.preserveSilhouette
      ? 'Preserve the silhouette and core item class.'
      : 'Keep the item class and subject identity intact while allowing modest silhouette drift.',
    state.preservePalette
      ? 'Stay close to the original palette while changing finish and material cues.'
      : 'Palette shifts are allowed when the preset benefits from them.',
    `Intensity: ${state.intensity}/100.`,
    activeFamilyCustomDirection.trim()
      ? `Additional direction: ${activeFamilyCustomDirection.trim()}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildPortraitStudioPromptPreview(prompt: string) {
  const normalizedPrompt = prompt.trim()

  return [
    'Generate a 3 column by 2 row portrait sheet.',
    'Keep the facial structure, hair, and eye color 100% identical while shifting only expression.',
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildVfxForgePromptPreview(
  effectLabel: string,
  textureOutputs: VfxTextureKind[],
  exportTarget: typeof initialState.vfxForge.exportTarget,
  looping: boolean,
  intensity: number,
  frameCount: number,
  prompt: string,
) {
  const normalizedEffectLabel = resolveVfxEffectLabel(effectLabel)
  const normalizedPrompt = prompt.trim()
  const normalizedTextureOutputs = textureOutputs.length > 0
    ? textureOutputs.map((kind) => getVfxTextureLabel(kind)).join(', ')
    : 'None selected'

  return [
    'Generate game-ready VFX texture ingredients.',
    `Effect: ${normalizedEffectLabel}.`,
    `Texture outputs: ${normalizedTextureOutputs}.`,
    exportTarget !== 'none'
      ? `Export target: ${getVfxExportTargetLabel(exportTarget)}.`
      : 'No Unity export target selected.',
    looping ? 'Author the textures for a looping in-game effect.' : 'Author the textures for a one-shot effect.',
    `Intensity: ${Math.max(0, Math.min(100, Math.round(intensity)))}/100.`,
    normalizedPrompt ? `Additional direction: ${normalizedPrompt}.` : null,
    textureOutputs.includes('flipbook')
      ? `If a flipbook is requested, use a pure #000000 black background and ${Math.max(4, Math.min(30, Math.round(frameCount)))} frames in one horizontal row.`
      : 'Frame count only applies when a flipbook output is enabled.',
  ]
    .filter(Boolean)
    .join(' ')
}

function getModePromptPreview(
  state: ForgeState,
  flags: ModeFlags,
) {
  if (flags.isCharacterSheetMode) {
    return buildCharacterSheetPrompt(state.characterSheet)
  }

  if (flags.isActionAnimatorMode) {
    return buildActionAnimatorPrompt(state.actionAnimator)
  }

  if (flags.isVariantForgeMode) {
    return buildVariantForgePromptPreview(state.variantForge)
  }

  if (flags.isPortraitStudioMode) {
    return buildPortraitStudioPromptPreview(state.portraitStudio.prompt)
  }

  if (flags.isUvLabMode) {
    return 'Automatic UV unwrap, packing, atlas export, and downloadable processed mesh.'
  }

  if (flags.isTextureExpansionMode) {
    return state.prompt.trim() || defaultTextureExpansionPrompt
  }

  if (flags.isVfxForgeMode) {
    return buildVfxForgePromptPreview(
      state.vfxForge.effectLabel,
      state.vfxForge.textureOutputs,
      state.vfxForge.exportTarget,
      state.vfxForge.looping,
      state.vfxForge.intensity,
      state.vfxForge.frameCount,
      state.vfxForge.prompt,
    )
  }

  return state.prompt.trim() || modeDefinitions[state.activeMode].instruction
}

function getModeActivePromptValue(
  state: ForgeState,
  promptPreview: string,
  flags: ModeFlags,
) {
  if (flags.isCharacterSheetMode) {
    return getCharacterSheetPromptSource(state.characterSheet)
  }

  if (flags.isActionAnimatorMode) {
    return buildActionAnimatorPrompt(state.actionAnimator)
  }

  if (flags.isVariantForgeMode) {
    return buildVariantForgePromptPreview(state.variantForge)
  }

  if (flags.isPortraitStudioMode) {
    return state.portraitStudio.prompt
  }

  if (flags.isUvLabMode) {
    return state.uvLab.mesh
      ? `Source mesh: ${state.uvLab.mesh.name}. ${promptPreview}`
      : promptPreview
  }

  if (flags.isVfxForgeMode) {
    return buildVfxForgePromptPreview(
      state.vfxForge.effectLabel,
      state.vfxForge.textureOutputs,
      state.vfxForge.exportTarget,
      state.vfxForge.looping,
      state.vfxForge.intensity,
      state.vfxForge.frameCount,
      state.vfxForge.prompt,
    )
  }

  return state.prompt
}

function getReferenceCount(state: ForgeState, flags: ModeFlags) {
  const characterReferenceCount = Object.values(
    state.characterSheet.references,
  ).filter(Boolean).length
  const standardReferenceCount = Object.values(state.references).filter(Boolean).length

  if (flags.isCharacterSheetMode) {
    return characterReferenceCount
  }

  if (flags.isActionAnimatorMode) {
    return Number(Boolean(state.actionAnimator.characterImage))
  }

  if (flags.isVariantForgeMode) {
    return Number(Boolean(state.variantForge.baseAsset))
  }

  if (flags.isPortraitStudioMode) {
    return Number(Boolean(state.portraitStudio.heroImage))
  }

  if (flags.isUvLabMode) {
    return Number(Boolean(state.uvLab.mesh))
  }

  if (flags.isTextureExpansionMode) {
    return Number(Boolean(state.textureLab.expansionSource))
  }

  if (flags.isVfxForgeMode) {
    return Number(Boolean(state.references.style))
  }

  return standardReferenceCount
}

function getIsReadyForApi(state: ForgeState, flags: ModeFlags) {
  const characterReferenceCount = Object.values(
    state.characterSheet.references,
  ).filter(Boolean).length
  const isCharacterSheetReady =
    state.characterSheet.generationMode === 'manifest'
      ? state.characterSheet.manifestPrompt.trim().length > 0
      : characterReferenceCount === 3

  if (flags.isCharacterSheetMode) {
    return isCharacterSheetReady
  }

  if (flags.isActionAnimatorMode) {
    return Boolean(state.actionAnimator.characterImage)
  }

  if (flags.isVariantForgeMode) {
    return Boolean(state.variantForge.baseAsset)
  }

  if (flags.isPortraitStudioMode) {
    return Boolean(state.portraitStudio.heroImage)
  }

  if (flags.isUvLabMode) {
    return Boolean(state.uvLab.mesh)
  }

  if (flags.isTextureExpansionMode) {
    return Boolean(state.textureLab.expansionSource)
  }

  if (flags.isVfxForgeMode) {
    return (
      state.vfxForge.textureOutputs.length > 0
    )
  }

  return state.prompt.trim().length > 0
}

function getBriefItems(state: ForgeState, flags: ModeFlags): ForgeBriefItem[] {
  if (flags.isCharacterSheetMode) {
    return [
      {
        label: 'Face Ref',
        value: state.characterSheet.references.face?.name ?? 'Not attached',
      },
      {
        label: 'Outfit Ref',
        value: state.characterSheet.references.outfit?.name ?? 'Not attached',
      },
      {
        label: 'Style Ref',
        value: state.characterSheet.references['art-style']?.name ?? 'Not attached',
      },
      {
        label: 'Mode',
        value: state.characterSheet.generationMode === 'manifest' ? 'Manifest' : 'Reference',
      },
    ]
  }

  if (flags.isActionAnimatorMode) {
    return [
      {
        label: 'Source',
        value: state.actionAnimator.characterImage?.name ?? 'Not attached',
      },
      {
        label: 'Pipeline',
        value:
          state.actionAnimator.pipeline === 'image-strip' ? 'Image Strip' : 'Gemini Omni Video',
      },
      {
        label: 'Action',
        value:
          state.actionAnimator.actionType === 'custom'
            ? state.actionAnimator.customActionPrompt.trim() || 'Custom'
            : state.actionAnimator.actionType,
      },
      {
        label: 'Frames',
        value: `${state.actionAnimator.frameCount} @ ${state.actionAnimator.fps} fps`,
      },
      {
        label: 'Key',
        value: state.actionAnimator.keyColor === 'blue' ? 'Blue' : 'Green',
      },
    ]
  }

  if (flags.isVariantForgeMode) {
    const activeOptions = buildActiveVariantForgeOptions(state.variantForge)

    return [
      {
        label: 'Base Asset',
        value: state.variantForge.baseAsset?.name ?? 'Not attached',
      },
      {
        label: 'Family',
        value: formatVariantForgeLabel(state.variantForge.variantFamily),
      },
      {
        label: 'Lead Preset',
        value: activeOptions.length
          ? formatVariantForgeLabel(state.variantForge.variantPreset)
          : 'None selected',
      },
      {
        label: 'Active Options',
        value: activeOptions.length
          ? activeOptions.map((option) => formatVariantForgeLabel(option.preset)).join(', ')
          : 'None selected',
      },
      {
        label: 'Intensity',
        value: `${state.variantForge.intensity}/100`,
      },
    ]
  }

  if (flags.isPortraitStudioMode) {
    return [
      {
        label: 'Hero Image',
        value: state.portraitStudio.heroImage?.name ?? 'Not attached',
      },
      {
        label: 'Direction',
        value: state.portraitStudio.prompt.trim() || 'Default expression pack',
      },
      {
        label: 'Expressions',
        value: '5 locked portraits',
      },
    ]
  }

  if (flags.isUvLabMode) {
    return [
      {
        label: 'Mesh',
        value: state.uvLab.mesh?.name ?? 'Not attached',
      },
      {
        label: 'Atlas',
        value: `${state.uvLab.atlasSize}px`,
      },
      {
        label: 'Padding',
        value: `${state.uvLab.paddingPx}px`,
      },
      {
        label: 'Format',
        value: state.uvLab.mesh?.format.toUpperCase() ?? 'N/A',
      },
    ]
  }

  if (flags.isTextureExpansionMode) {
    return [
      {
        label: 'Workflow',
        value: 'Expand Texture',
      },
      {
        label: 'Source',
        value: state.textureLab.expansionSource?.name ?? 'Not attached',
      },
      {
        label: 'Output',
        value: `${state.textureLab.expansionTargetSize} x ${state.textureLab.expansionTargetSize}`,
      },
    ]
  }

  if (flags.isVfxForgeMode) {
    return [
      {
        label: 'Effect',
        value: resolveVfxEffectLabel(state.vfxForge.effectLabel),
      },
      {
        label: 'Style Ref',
        value: state.references.style?.name ?? 'Not attached',
      },
      {
        label: 'Export',
        value: getVfxExportTargetLabel(state.vfxForge.exportTarget),
      },
      {
        label: 'Intensity',
        value: `${state.vfxForge.intensity}/100`,
      },
      {
        label: 'Textures',
        value: state.vfxForge.textureOutputs.map((kind) => getVfxTextureLabel(kind)).join(', '),
      },
      {
        label: 'Looping',
        value: state.vfxForge.looping ? 'Yes' : 'No',
      },
    ]
  }

  return [
    {
      label: 'Style Ref',
      value: state.references.style?.name ?? 'Not attached',
    },
    {
      label: 'Subject Ref',
      value: state.references.subject?.name ?? 'Not attached',
    },
  ]
}

function getPrimaryActionLabel({
  flags,
  isForging,
}: {
  flags: ModeFlags
  isForging: boolean
}) {
  if (isForging) {
    if (flags.isActionAnimatorMode) {
      return 'GENERATING SPRITES'
    }

    if (flags.isCharacterSheetMode) {
      return 'BUILDING SHEET'
    }

    if (flags.isVariantForgeMode) {
      return 'FORGING VARIANT'
    }

    if (flags.isPortraitStudioMode) {
      return 'BUILDING PORTRAITS'
    }

    if (flags.isUvLabMode) {
      return 'UNWRAPPING UVS'
    }

    if (flags.isTextureExpansionMode) {
      return 'EXPANDING TEXTURE'
    }

    if (flags.isVfxForgeMode) {
      return 'GENERATING TEXTURES'
    }

    return 'FORGING'
  }

  if (flags.isActionAnimatorMode) {
    return 'GENERATE SPRITES'
  }

  if (flags.isCharacterSheetMode) {
    return 'BUILD SHEET'
  }

  if (flags.isVariantForgeMode) {
    return 'FORGE VARIANT'
  }

  if (flags.isPortraitStudioMode) {
    return 'BUILD PORTRAITS'
  }

  if (flags.isUvLabMode) {
    return 'ONE-CLICK UNWRAP'
  }

  if (flags.isTextureExpansionMode) {
    return 'EXPAND TEXTURE'
  }

  if (flags.isVfxForgeMode) {
    return 'GENERATE TEXTURES'
  }

  return 'FORGE'
}

function getPrimaryActionDescription({
  flags,
  isForging,
  selectedModelSupported,
  state,
}: {
  flags: ModeFlags
  isForging: boolean
  selectedModelSupported: boolean
  state: ForgeState
}) {
  if (isForging) {
    if (flags.isActionAnimatorMode) {
      return state.actionAnimator.pipeline === 'image-strip'
        ? 'Generating a guided sprite strip and preparing keyed frame tiles'
        : 'Generating a Gemini Omni clip and extracting keyed sprite frames'
    }

    if (flags.isCharacterSheetMode) {
      return 'Sending character sheet request to the selected image model'
    }

    if (flags.isVariantForgeMode) {
      return 'Applying the selected transformation pass to the base asset'
    }

    if (flags.isPortraitStudioMode) {
      return 'Generating a locked five-expression portrait sheet'
    }

    if (flags.isUvLabMode) {
      return 'Unwrapping and exporting the mesh with the in-browser UV engine'
    }

    if (flags.isTextureExpansionMode) {
      return 'Processing the current texture operation'
    }

    if (flags.isVfxForgeMode) {
      return state.vfxForge.exportTarget === 'none'
        ? `Generating ${state.vfxForge.textureOutputs.length} VFX output${state.vfxForge.textureOutputs.length === 1 ? '' : 's'} for 2D workflow use`
        : `Generating ${state.vfxForge.textureOutputs.length} VFX output${state.vfxForge.textureOutputs.length === 1 ? '' : 's'} for ${getVfxExportTargetLabel(state.vfxForge.exportTarget)} export`
    }

    return 'Sending prompt and references to the selected image model'
  }

  if (!selectedModelSupported) {
    return 'Selected model is not supported for this tab'
  }

  if (flags.isActionAnimatorMode) {
    return state.actionAnimator.pipeline === 'image-strip'
      ? 'Character image staged for guided sprite-strip generation'
      : 'Character image staged for video-based sprite extraction'
  }

  if (getIsReadyForApi(state, flags)) {
    if (flags.isVariantForgeMode) {
      return 'Base asset staged for single-variant transformation'
    }

    if (flags.isPortraitStudioMode) {
      return 'Hero image staged for expression pack generation'
    }

    if (flags.isUvLabMode) {
      return 'Mesh staged for in-browser unwrap and packing'
    }

    if (flags.isTextureExpansionMode) {
      return 'Source ready for protected expansion'
    }

    if (flags.isVfxForgeMode) {
      return state.vfxForge.exportTarget === 'none'
        ? `${state.vfxForge.textureOutputs.length} VFX output${state.vfxForge.textureOutputs.length === 1 ? '' : 's'} staged for generation`
        : `${state.vfxForge.textureOutputs.length} VFX output${state.vfxForge.textureOutputs.length === 1 ? '' : 's'} staged for ${getVfxExportTargetLabel(state.vfxForge.exportTarget)} export`
    }

    return 'Request staged for API execution'
  }

  if (flags.isCharacterSheetMode) {
    return 'Attach all required references or write a manifest'
  }

  if (flags.isActionAnimatorMode) {
    return 'Attach a character image to generate keyed sprite frames'
  }

  if (flags.isVariantForgeMode) {
    return 'Attach a base asset to begin forging a variant'
  }

  if (flags.isPortraitStudioMode) {
    return 'Attach a hero portrait or reuse the latest character sheet'
  }

  if (flags.isUvLabMode) {
    return 'Attach an OBJ or FBX mesh to start UV Lab'
  }

  if (flags.isTextureExpansionMode) {
    return 'Attach a source texture to prepare the expansion pass'
  }

  if (flags.isVfxForgeMode) {
    return 'Choose at least one output to prepare the VFX generation pass'
  }

  return 'Add a prompt to prepare the request'
}

function getReadinessLabel({
  flags,
  isForging,
  isReadyForApi,
}: {
  flags: ModeFlags
  isForging: boolean
  isReadyForApi: boolean
}) {
  if (isForging) {
    if (flags.isTextureExpansionMode) {
      return 'Source processing'
    }

    if (flags.isActionAnimatorMode) {
      return 'Sprite extraction'
    }

    if (flags.isUvLabMode) {
      return 'Unwrapping'
    }

    return 'Generating'
  }

  if (isReadyForApi) {
    if (flags.isTextureExpansionMode) {
      return 'Source ready'
    }

    if (flags.isUvLabMode) {
      return 'Mesh ready'
    }

    if (flags.isVfxForgeMode) {
      return 'Texture plan ready'
    }

    return 'Prompt ready'
  }

  if (flags.isTextureExpansionMode) {
    return 'Source required'
  }

  if (flags.isActionAnimatorMode) {
    return 'Image required'
  }

  if (flags.isPortraitStudioMode || flags.isVariantForgeMode) {
    return 'Image required'
  }

  if (flags.isUvLabMode) {
    return 'Mesh required'
  }

  if (flags.isVfxForgeMode) {
    return 'Effect config required'
  }

  return 'Prompt required'
}
