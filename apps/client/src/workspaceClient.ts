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
}

export interface NativeSaveResult {
  readonly document: NativeNoteDocument;
  readonly changed: boolean;
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
