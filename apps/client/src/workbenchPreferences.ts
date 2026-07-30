import {
  createTabSession,
  reconcileTabSession,
  type TabSession,
} from "./tabModel";
import {
  EXPLORER_WIDTH,
  INSPECTOR_WIDTH,
  normalizePanelWidth,
} from "./panelLayout";

export type WorkbenchEditorMode = "edit" | "preview" | "split";
export type WorkbenchInspector = "outline" | "backlinks" | "graph" | null;

export interface WorkbenchPreferences {
  readonly activeNoteId: string | null;
  readonly editorMode: WorkbenchEditorMode;
  readonly explorerWidth: number;
  readonly inspector: WorkbenchInspector;
  readonly inspectorWidth: number;
  readonly livePreviewEnabled: boolean;
  readonly sidebarOpen: boolean;
  readonly tabSession: TabSession | null;
  readonly versionsOpen: boolean;
}

export interface RestoredWorkbenchTabSession {
  readonly activeNoteId: string | null;
  readonly session: TabSession;
}

export const WORKBENCH_PREFERENCES_KEY =
  "zhiweave.workbench.preferences.v3";
export const PREVIOUS_WORKBENCH_PREFERENCES_KEY =
  "zhiweave.workbench.preferences.v2";
export const LEGACY_WORKBENCH_PREFERENCES_KEY =
  "zhiweave.workbench.preferences.v1";

const WORKBENCH_PREFERENCES_SCHEMA_VERSION = 3;
const MAX_OPEN_TABS = 50;
const MAX_CLOSED_TABS = 20;
const MAX_NOTE_ID_LENGTH = 200;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = {
  activeNoteId: null,
  editorMode: "edit",
  explorerWidth: EXPLORER_WIDTH.defaultValue,
  inspector: null,
  inspectorWidth: INSPECTOR_WIDTH.defaultValue,
  livePreviewEnabled: true,
  sidebarOpen: true,
  tabSession: null,
  versionsOpen: false,
};

export function parseWorkbenchPreferences(
  storedV3: string | null,
  storedV2: string | null,
  storedLegacyV1: string | null,
): WorkbenchPreferences {
  if (storedV3 !== null) {
    return parseVersionThree(storedV3);
  }
  if (storedV2 !== null) {
    return parseVersionTwo(storedV2);
  }
  if (storedLegacyV1 !== null) {
    return parseLegacyVersionOne(storedLegacyV1);
  }
  return DEFAULT_WORKBENCH_PREFERENCES;
}

export function serializeWorkbenchPreferences(
  preferences: WorkbenchPreferences,
): string {
  return JSON.stringify({
    schemaVersion: WORKBENCH_PREFERENCES_SCHEMA_VERSION,
    activeNoteId: safeNoteId(preferences.activeNoteId),
    editorMode: safeEditorMode(preferences.editorMode),
    explorerWidth: normalizePanelWidth(
      "explorer",
      preferences.explorerWidth,
    ),
    inspector: safeInspector(preferences.inspector),
    inspectorWidth: normalizePanelWidth(
      "inspector",
      preferences.inspectorWidth,
    ),
    livePreviewEnabled: preferences.livePreviewEnabled === true,
    sidebarOpen: preferences.sidebarOpen === true,
    tabSession:
      preferences.tabSession === null
        ? null
        : normalizeTabSession(preferences.tabSession),
    versionsOpen: preferences.versionsOpen === true,
  });
}

export function restoreWorkbenchTabSession(
  preferences: WorkbenchPreferences,
  validNoteIds: ReadonlySet<string>,
  fallbackNoteId: string | null,
): RestoredWorkbenchTabSession {
  const validFallback =
    fallbackNoteId !== null && validNoteIds.has(fallbackNoteId)
      ? fallbackNoteId
      : null;
  const storedSession = preferences.tabSession;
  if (storedSession === null) {
    return {
      activeNoteId: validFallback,
      session: createTabSession(validFallback),
    };
  }

  const validActiveNoteId =
    preferences.activeNoteId !== null &&
    validNoteIds.has(preferences.activeNoteId)
      ? preferences.activeNoteId
      : null;
  let session = reconcileTabSession(
    storedSession,
    validNoteIds,
    validActiveNoteId,
  );
  if (validActiveNoteId !== null) {
    return {
      activeNoteId: validActiveNoteId,
      session,
    };
  }

  const firstOpenNoteId = session.openNoteIds[0] ?? null;
  if (firstOpenNoteId !== null) {
    return {
      activeNoteId: firstOpenNoteId,
      session,
    };
  }

  if (storedSession.openNoteIds.length === 0) {
    return {
      activeNoteId: null,
      session,
    };
  }

  session = reconcileTabSession(session, validNoteIds, validFallback);
  return {
    activeNoteId: validFallback,
    session,
  };
}

function parseVersionThree(stored: string): WorkbenchPreferences {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== WORKBENCH_PREFERENCES_SCHEMA_VERSION
    ) {
      return DEFAULT_WORKBENCH_PREFERENCES;
    }
    return {
      activeNoteId: safeNoteId(parsed.activeNoteId),
      editorMode: safeEditorMode(parsed.editorMode),
      explorerWidth: normalizePanelWidth(
        "explorer",
        parsed.explorerWidth,
      ),
      inspector: safeInspector(parsed.inspector),
      inspectorWidth: normalizePanelWidth(
        "inspector",
        parsed.inspectorWidth,
      ),
      livePreviewEnabled: readBoolean(
        parsed.livePreviewEnabled,
        DEFAULT_WORKBENCH_PREFERENCES.livePreviewEnabled,
      ),
      sidebarOpen: readBoolean(
        parsed.sidebarOpen,
        DEFAULT_WORKBENCH_PREFERENCES.sidebarOpen,
      ),
      tabSession: parseStoredTabSession(parsed.tabSession),
      versionsOpen: readBoolean(
        parsed.versionsOpen,
        DEFAULT_WORKBENCH_PREFERENCES.versionsOpen,
      ),
    };
  } catch {
    return DEFAULT_WORKBENCH_PREFERENCES;
  }
}

function parseVersionTwo(stored: string): WorkbenchPreferences {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || parsed.schemaVersion !== 2) {
      return DEFAULT_WORKBENCH_PREFERENCES;
    }
    return {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      activeNoteId: safeNoteId(parsed.activeNoteId),
      editorMode: safeEditorMode(parsed.editorMode),
      inspector: safeInspector(parsed.inspector),
      livePreviewEnabled: readBoolean(
        parsed.livePreviewEnabled,
        DEFAULT_WORKBENCH_PREFERENCES.livePreviewEnabled,
      ),
      sidebarOpen: readBoolean(
        parsed.sidebarOpen,
        DEFAULT_WORKBENCH_PREFERENCES.sidebarOpen,
      ),
      tabSession: parseStoredTabSession(parsed.tabSession),
      versionsOpen: readBoolean(
        parsed.versionsOpen,
        DEFAULT_WORKBENCH_PREFERENCES.versionsOpen,
      ),
    };
  } catch {
    return DEFAULT_WORKBENCH_PREFERENCES;
  }
}

function parseLegacyVersionOne(stored: string): WorkbenchPreferences {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) {
      return DEFAULT_WORKBENCH_PREFERENCES;
    }
    const outlineOpen = readBoolean(parsed.outlineOpen, false);
    const backlinksOpen = readBoolean(parsed.backlinksOpen, false);
    const localGraphOpen = readBoolean(parsed.localGraphOpen, false);
    return {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      inspector: outlineOpen
        ? "outline"
        : backlinksOpen
          ? "backlinks"
          : localGraphOpen
            ? "graph"
            : null,
      livePreviewEnabled: readBoolean(
        parsed.livePreviewEnabled,
        DEFAULT_WORKBENCH_PREFERENCES.livePreviewEnabled,
      ),
    };
  } catch {
    return DEFAULT_WORKBENCH_PREFERENCES;
  }
}

function parseStoredTabSession(value: unknown): TabSession | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.openNoteIds)) {
    return null;
  }
  return normalizeTabSession({
    openNoteIds: value.openNoteIds,
    closedNoteIds: Array.isArray(value.closedNoteIds)
      ? value.closedNoteIds
      : [],
    previewNoteId: safeNoteId(value.previewNoteId),
  });
}

function normalizeTabSession(session: {
  readonly openNoteIds: readonly unknown[];
  readonly closedNoteIds: readonly unknown[];
  readonly previewNoteId: unknown;
}): TabSession {
  const openNoteIds = safeNoteIds(
    session.openNoteIds,
    MAX_OPEN_TABS,
  );
  const openSet = new Set(openNoteIds);
  const closedNoteIds = safeNoteIds(
    session.closedNoteIds,
    MAX_OPEN_TABS + MAX_CLOSED_TABS,
  )
    .filter((id) => !openSet.has(id))
    .slice(0, MAX_CLOSED_TABS);
  const previewNoteId = safeNoteId(session.previewNoteId);
  return {
    openNoteIds,
    closedNoteIds,
    previewNoteId:
      previewNoteId !== null && openSet.has(previewNoteId)
        ? previewNoteId
        : null,
  };
}

function safeNoteIds(values: readonly unknown[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = safeNoteId(value);
    if (id === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
    if (result.length === limit) {
      break;
    }
  }
  return result;
}

function safeNoteId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NOTE_ID_LENGTH &&
    !CONTROL_CHARACTER.test(value)
    ? value
    : null;
}

function safeEditorMode(value: unknown): WorkbenchEditorMode {
  return value === "preview" || value === "split" ? value : "edit";
}

function safeInspector(value: unknown): WorkbenchInspector {
  return value === "outline" ||
    value === "backlinks" ||
    value === "graph"
    ? value
    : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
