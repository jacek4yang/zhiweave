import { invoke } from "@tauri-apps/api/core";

export type NativeLineEnding = "none" | "lf" | "crlf" | "cr" | "mixed";

export type NativeNoteKind =
  | "topic"
  | "node"
  | "source"
  | "paper"
  | "experiment"
  | "english_term"
  | "review_card"
  | "daily"
  | "note";

export interface NativeNoteDocument {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: NativeNoteKind;
  readonly markdown: string;
  readonly revision: string;
  readonly lineEnding: NativeLineEnding;
  readonly hasUtf8Bom: boolean;
  readonly modifiedAtMillis: number;
}

export interface NativeWorkspaceSnapshot {
  readonly rootDisplay: string;
  readonly documents: readonly NativeNoteDocument[];
  readonly index: NativeIndexStatus;
}

export type NativeIndexState = "ready" | "needsRebuild" | "unavailable";

export interface NativeIndexStatus {
  readonly state: NativeIndexState;
  readonly schemaVersion: number;
  readonly noteCount: number;
  readonly issue: string | null;
}

export interface NativeSaveResult {
  readonly document: NativeNoteDocument;
  readonly changed: boolean;
  readonly indexUpdated: boolean;
}

export interface NativeSearchNoteResult {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: NativeNoteKind;
  readonly snippet: string;
  readonly rank: number;
}

export interface NativeRebuildIndexResult {
  readonly indexedNotes: number;
  readonly schemaVersion: number;
  readonly preservedPreviousDatabase: boolean;
}

export interface NativeWorkspaceFailure {
  readonly code: string;
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly operation?: string;
  readonly kind?: string;
  readonly limit?: string;
  readonly limitBytes?: number;
}

export function loadNativeWorkspace(): Promise<NativeWorkspaceSnapshot> {
  return invoke<NativeWorkspaceSnapshot>("workspace_snapshot");
}

export function createNativeNote(
  path: string,
  markdown: string,
): Promise<NativeNoteDocument> {
  return invoke<NativeNoteDocument>("note_create", {
    request: { path, markdown },
  });
}

export function saveNativeNote(
  document: Pick<
    NativeNoteDocument,
    "path" | "markdown" | "revision" | "lineEnding" | "hasUtf8Bom"
  >,
): Promise<NativeSaveResult> {
  return invoke<NativeSaveResult>("note_save", {
    request: {
      path: document.path,
      markdown: document.markdown,
      expectedRevision: document.revision,
      lineEnding: document.lineEnding,
      hasUtf8Bom: document.hasUtf8Bom,
    },
  });
}

export function renameNativeNote(
  path: string,
  newPath: string,
  expectedRevision: string,
): Promise<NativeNoteDocument> {
  return invoke<NativeNoteDocument>("note_rename", {
    request: { path, newPath, expectedRevision },
  });
}

export function searchNativeNotes(
  query: string,
  limit = 50,
): Promise<readonly NativeSearchNoteResult[]> {
  return invoke<readonly NativeSearchNoteResult[]>("workspace_search", {
    request: { query, limit },
  });
}

export function rebuildNativeIndex(): Promise<NativeRebuildIndexResult> {
  return invoke<NativeRebuildIndexResult>("workspace_rebuild_index");
}

export function asWorkspaceFailure(
  error: unknown,
): NativeWorkspaceFailure | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return undefined;
  }
  return error as NativeWorkspaceFailure;
}
