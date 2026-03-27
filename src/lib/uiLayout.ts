import { allForgeModes, isForgeMode } from '../../shared/modeCatalog.js'
import type { ForgeMode } from './forge'

export const uiLayoutVersion = 1 as const

export const layoutShellZoneOrder = ['header', 'left', 'right', 'footer'] as const
export const layoutControlZoneOrder = ['primary', 'secondary'] as const
export const layoutWorkspaceZoneOrder = ['top', 'main', 'bottom'] as const

export type LayoutShellZoneId = (typeof layoutShellZoneOrder)[number]
export type LayoutControlZoneId = (typeof layoutControlZoneOrder)[number]
export type LayoutWorkspaceZoneId = (typeof layoutWorkspaceZoneOrder)[number]

export const layoutShellItemIds = [
  'header-summary',
  'mode-tabs',
  'control-panel',
  'workspace-panel',
] as const

export const layoutPanelItemIds = [
  'model-selector',
  'style-input',
  'prompt-panel',
  'style-reference',
  'subject-reference',
  'batch-panel',
  'texture-workflow',
  'texture-expansion',
  'character-sheet-panel',
  'action-animator-panel',
  'variant-forge-panel',
  'portrait-studio-panel',
  'portrait-direction',
  'uv-lab-panel',
  'vfx-forge-panel',
  'forge-action',
  'top-panel',
  'forge-brief',
  'uv-brief',
  'result-grid',
  'uv-workspace',
] as const

export type LayoutShellItemId = (typeof layoutShellItemIds)[number]
export type LayoutPanelItemId = (typeof layoutPanelItemIds)[number]
export type LayoutZoneId = LayoutShellZoneId | LayoutControlZoneId | LayoutWorkspaceZoneId
export type LayoutArea = 'control' | 'workspace'

export type ShellLayout = Record<LayoutShellZoneId, LayoutShellItemId[]>
export type ControlLayout = Record<LayoutControlZoneId, LayoutPanelItemId[]>
export type WorkspaceLayout = Record<LayoutWorkspaceZoneId, LayoutPanelItemId[]>
export type ModePanelLayout = {
  control: ControlLayout
  workspace: WorkspaceLayout
}

export type UiLayoutGlobalState = {
  modeTabs: ForgeMode[]
  shell: ShellLayout
}

export type UiLayoutState = {
  byMode: Partial<Record<ForgeMode, ModePanelLayout>>
  global: UiLayoutGlobalState
  version: typeof uiLayoutVersion
}

const defaultShellLayout: ShellLayout = {
  footer: [],
  header: ['header-summary', 'mode-tabs'],
  left: ['control-panel'],
  right: ['workspace-panel'],
}

const defaultModePanelLayouts: Record<ForgeMode, ModePanelLayout> = {
  armory: {
    control: {
      primary: [
        'model-selector',
        'style-input',
        'prompt-panel',
        'style-reference',
        'subject-reference',
        'batch-panel',
      ],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  'action-animator': {
    control: {
      primary: ['model-selector', 'action-animator-panel'],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  'character-sheet': {
    control: {
      primary: ['model-selector', 'character-sheet-panel'],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  'portrait-studio': {
    control: {
      primary: ['model-selector', 'portrait-studio-panel', 'portrait-direction'],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  'texture-lab': {
    control: {
      primary: [
        'model-selector',
        'texture-workflow',
        'style-input',
        'prompt-panel',
        'texture-expansion',
        'style-reference',
        'subject-reference',
        'batch-panel',
      ],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  'uv-lab': {
    control: {
      primary: ['uv-lab-panel'],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['uv-workspace'],
      top: ['top-panel', 'uv-brief'],
    },
  },
  'variant-forge': {
    control: {
      primary: ['model-selector', 'variant-forge-panel'],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  'vfx-forge': {
    control: {
      primary: ['model-selector', 'vfx-forge-panel'],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
  visualizer: {
    control: {
      primary: [
        'model-selector',
        'style-input',
        'prompt-panel',
        'style-reference',
        'subject-reference',
        'batch-panel',
      ],
      secondary: ['forge-action'],
    },
    workspace: {
      bottom: [],
      main: ['forge-brief', 'result-grid'],
      top: ['top-panel'],
    },
  },
}

const panelAreaByItem: Record<LayoutPanelItemId, LayoutArea> = {
  'action-animator-panel': 'control',
  'batch-panel': 'control',
  'character-sheet-panel': 'control',
  'forge-action': 'control',
  'forge-brief': 'workspace',
  'model-selector': 'control',
  'portrait-direction': 'control',
  'portrait-studio-panel': 'control',
  'prompt-panel': 'control',
  'result-grid': 'workspace',
  'style-input': 'control',
  'style-reference': 'control',
  'subject-reference': 'control',
  'texture-expansion': 'control',
  'texture-workflow': 'control',
  'top-panel': 'workspace',
  'uv-brief': 'workspace',
  'uv-lab-panel': 'control',
  'uv-workspace': 'workspace',
  'variant-forge-panel': 'control',
  'vfx-forge-panel': 'control',
}

function cloneShellLayout(layout: ShellLayout): ShellLayout {
  return {
    footer: [...layout.footer],
    header: [...layout.header],
    left: [...layout.left],
    right: [...layout.right],
  }
}

function cloneControlLayout(layout: ControlLayout): ControlLayout {
  return {
    primary: [...layout.primary],
    secondary: [...layout.secondary],
  }
}

function cloneWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    bottom: [...layout.bottom],
    main: [...layout.main],
    top: [...layout.top],
  }
}

function cloneModePanelLayout(layout: ModePanelLayout): ModePanelLayout {
  return {
    control: cloneControlLayout(layout.control),
    workspace: cloneWorkspaceLayout(layout.workspace),
  }
}

function isShellItemId(value: unknown): value is LayoutShellItemId {
  return typeof value === 'string' && layoutShellItemIds.includes(value as LayoutShellItemId)
}

function isPanelItemId(value: unknown): value is LayoutPanelItemId {
  return typeof value === 'string' && layoutPanelItemIds.includes(value as LayoutPanelItemId)
}

function normalizeTabOrder(value: unknown): ForgeMode[] {
  const orderedModes = Array.isArray(value)
    ? value.filter((entry): entry is ForgeMode => isForgeMode(entry))
    : []

  return appendMissingItems(orderedModes, allForgeModes)
}

function appendMissingItems<T extends string>(items: T[], defaults: readonly T[]) {
  const nextItems = [...items]
  const seen = new Set(nextItems)

  for (const defaultItem of defaults) {
    if (!seen.has(defaultItem)) {
      nextItems.push(defaultItem)
      seen.add(defaultItem)
    }
  }

  return nextItems
}

function flattenZoneItems<TZone extends string, TItem extends string>(
  zoneOrder: readonly TZone[],
  layout: Record<TZone, TItem[]>,
) {
  return zoneOrder.flatMap((zoneId) => layout[zoneId])
}

function buildDefaultZoneByItem<TZone extends string, TItem extends string>(
  zoneOrder: readonly TZone[],
  layout: Record<TZone, TItem[]>,
) {
  return Object.fromEntries(
    flattenZoneItems(zoneOrder, layout).map((itemId) => [
      itemId,
      zoneOrder.find((zoneId) => layout[zoneId].includes(itemId)) ?? zoneOrder[0],
    ]),
  ) as Record<TItem, TZone>
}

function normalizeZoneLayout<TZone extends string, TItem extends string>({
  defaultLayout,
  isAllowedItem,
  zoneOrder,
  value,
}: {
  defaultLayout: Record<TZone, TItem[]>
  isAllowedItem: (value: unknown) => value is TItem
  value: unknown
  zoneOrder: readonly TZone[]
}) {
  const nextLayout = Object.fromEntries(
    zoneOrder.map((zoneId) => [zoneId, [] as TItem[]]),
  ) as Record<TZone, TItem[]>
  const rawLayout: Partial<Record<TZone, unknown>> =
    value && typeof value === 'object' ? (value as Partial<Record<TZone, unknown>>) : {}
  const seen = new Set<TItem>()

  for (const zoneId of zoneOrder) {
    const rawItems = Array.isArray(rawLayout[zoneId]) ? rawLayout[zoneId] : []

    nextLayout[zoneId] = rawItems.filter((entry): entry is TItem => {
      if (!isAllowedItem(entry) || seen.has(entry)) {
        return false
      }

      seen.add(entry)
      return true
    })
  }

  const defaultZoneByItem = buildDefaultZoneByItem(zoneOrder, defaultLayout)
  const missingItems = flattenZoneItems(zoneOrder, defaultLayout).filter((itemId) => !seen.has(itemId))

  for (const itemId of missingItems) {
    nextLayout[defaultZoneByItem[itemId]].push(itemId)
  }

  return nextLayout
}

function isModePanelLayoutEqual(left: ModePanelLayout, right: ModePanelLayout) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function getDefaultUiLayout(): UiLayoutState {
  return {
    byMode: {},
    global: {
      modeTabs: [...allForgeModes],
      shell: cloneShellLayout(defaultShellLayout),
    },
    version: uiLayoutVersion,
  }
}

export function getDefaultModePanelLayout(mode: ForgeMode): ModePanelLayout {
  return cloneModePanelLayout(defaultModePanelLayouts[mode])
}

export function sanitizeModePanelLayout(mode: ForgeMode, value: unknown): ModePanelLayout {
  const defaultLayout = defaultModePanelLayouts[mode]

  return {
    control: normalizeZoneLayout({
      defaultLayout: defaultLayout.control,
      isAllowedItem: (entry): entry is LayoutPanelItemId =>
        isPanelItemId(entry) && panelAreaByItem[entry] === 'control',
      value: value && typeof value === 'object' ? (value as { control?: unknown }).control : null,
      zoneOrder: layoutControlZoneOrder,
    }),
    workspace: normalizeZoneLayout({
      defaultLayout: defaultLayout.workspace,
      isAllowedItem: (entry): entry is LayoutPanelItemId =>
        isPanelItemId(entry) && panelAreaByItem[entry] === 'workspace',
      value:
        value && typeof value === 'object' ? (value as { workspace?: unknown }).workspace : null,
      zoneOrder: layoutWorkspaceZoneOrder,
    }),
  }
}

export function sanitizeUiLayout(value: unknown): UiLayoutState {
  const rawState = value && typeof value === 'object' ? (value as Partial<UiLayoutState>) : {}
  const rawByMode =
    rawState.byMode && typeof rawState.byMode === 'object'
      ? (rawState.byMode as Partial<Record<ForgeMode, unknown>>)
      : {}
  const sanitizedByMode: Partial<Record<ForgeMode, ModePanelLayout>> = {}

  for (const mode of allForgeModes) {
    if (rawByMode[mode] === undefined) {
      continue
    }

    const nextLayout = sanitizeModePanelLayout(mode, rawByMode[mode])

    if (!isModePanelLayoutEqual(nextLayout, defaultModePanelLayouts[mode])) {
      sanitizedByMode[mode] = nextLayout
    }
  }

  return {
    byMode: sanitizedByMode,
    global: {
      modeTabs: normalizeTabOrder(rawState.global?.modeTabs),
      shell: normalizeZoneLayout({
        defaultLayout: defaultShellLayout,
        isAllowedItem: isShellItemId,
        value: rawState.global?.shell,
        zoneOrder: layoutShellZoneOrder,
      }),
    },
    version: uiLayoutVersion,
  }
}

export function getEffectiveModePanelLayout(
  layout: UiLayoutState,
  mode: ForgeMode,
): ModePanelLayout {
  return sanitizeModePanelLayout(mode, layout.byMode[mode] ?? defaultModePanelLayouts[mode])
}

export function setModePanelLayout(
  layout: UiLayoutState,
  mode: ForgeMode,
  nextLayout: ModePanelLayout,
): UiLayoutState {
  const sanitizedLayout = sanitizeModePanelLayout(mode, nextLayout)
  const defaultLayout = defaultModePanelLayouts[mode]
  const nextByMode = {
    ...layout.byMode,
  }

  if (isModePanelLayoutEqual(sanitizedLayout, defaultLayout)) {
    delete nextByMode[mode]
  } else {
    nextByMode[mode] = sanitizedLayout
  }

  return {
    ...layout,
    byMode: nextByMode,
  }
}

export function setShellLayout(layout: UiLayoutState, nextShell: ShellLayout): UiLayoutState {
  return {
    ...layout,
    global: {
      ...layout.global,
      shell: normalizeZoneLayout({
        defaultLayout: defaultShellLayout,
        isAllowedItem: isShellItemId,
        value: nextShell,
        zoneOrder: layoutShellZoneOrder,
      }),
    },
  }
}

export function setModeTabOrder(layout: UiLayoutState, nextModeTabs: ForgeMode[]): UiLayoutState {
  return {
    ...layout,
    global: {
      ...layout.global,
      modeTabs: normalizeTabOrder(nextModeTabs),
    },
  }
}

export function resetModePanelLayout(layout: UiLayoutState, mode: ForgeMode): UiLayoutState {
  const nextByMode = {
    ...layout.byMode,
  }

  delete nextByMode[mode]

  return {
    ...layout,
    byMode: nextByMode,
  }
}

export function resetAllUiLayouts(): UiLayoutState {
  return getDefaultUiLayout()
}
