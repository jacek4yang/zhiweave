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

export interface NativeKnownNoteState {
  readonly id: string;
  readonly path: string;
  readonly revision: string;
}

export type NativeWorkspaceChangeKind =
  | "created"
  | "modified"
  | "deleted"
  | "moved";

export interface NativeWorkspaceChange {
  readonly kind: NativeWorkspaceChangeKind;
  readonly id: string;
  readonly previousPath: string | null;
  readonly currentPath: string | null;
  readonly currentTitle: string | null;
  readonly contentChanged: boolean;
}

export interface NativeWorkspaceChangesResult {
  readonly snapshot: NativeWorkspaceSnapshot;
  readonly changes: readonly NativeWorkspaceChange[];
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

export interface NativeVersionNode {
  readonly id: string;
  readonly noteId: string;
  readonly noteTitle: string;
  readonly parentId: string | null;
  readonly contentHash: string;
  readonly contentLength: number;
  readonly createdAtMillis: number;
  readonly message: string | null;
  readonly checkpointName: string | null;
}

export interface NativeVersionHistoryStats {
  readonly versionCount: number;
  readonly chunkCount: number;
  readonly logicalBytes: number;
  readonly storedBytes: number;
}

export interface NativeVersionHistory {
  readonly noteId: string;
  readonly head: string | null;
  readonly nodes: readonly NativeVersionNode[];
  readonly stats: NativeVersionHistoryStats;
}

export interface NativeSaveVersionResult {
  readonly node: NativeVersionNode;
  readonly created: boolean;
  readonly history: NativeVersionHistory;
}

export interface NativeVersionContent {
  readonly node: NativeVersionNode;
  readonly markdown: string;
}

export interface NativeDeleteVersionResult {
  readonly history: NativeVersionHistory;
  readonly releasedBytes: number;
}

export interface NativeVersionRetentionPolicy {
  readonly keepLatest: number;
  readonly keepDays: number;
}

export interface NativeVersionRetentionPreview {
  readonly noteId: string;
  readonly expectedHead: string | null;
  readonly policy: NativeVersionRetentionPolicy;
  readonly cutoffAtMillis: number;
  readonly previewToken: string;
  readonly candidates: readonly NativeVersionNode[];
  readonly remainingVersionCount: number;
  readonly releasedBytes: number;
}

export interface NativeApplyVersionRetentionResult {
  readonly history: NativeVersionHistory;
  readonly deletedVersions: number;
  readonly releasedBytes: number;
}

export interface NativeWorkspaceBackupSummary {
  readonly id: string;
  readonly label: string | null;
  readonly createdAtMillis: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly historyVersionCount: number;
  readonly pathDisplay: string;
}

export interface NativeCreateWorkspaceBackupResult {
  readonly backup: NativeWorkspaceBackupSummary;
}

export interface NativeVerifyWorkspaceBackupResult {
  readonly backup: NativeWorkspaceBackupSummary;
  readonly verifiedFiles: number;
  readonly verifiedBytes: number;
}

export interface NativePrepareWorkspaceRestoreResult {
  readonly backup: NativeWorkspaceBackupSummary;
  readonly safetyBackup: NativeWorkspaceBackupSummary;
  readonly restartRequired: boolean;
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

export function detectNativeWorkspaceChanges(
  notes: readonly NativeKnownNoteState[],
): Promise<NativeWorkspaceChangesResult> {
  return invoke<NativeWorkspaceChangesResult>("workspace_changes", {
    request: { notes },
  });
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

export function loadNativeVersionHistory(
  noteId: string,
): Promise<NativeVersionHistory> {
  return invoke<NativeVersionHistory>("version_history", {
    request: { noteId },
  });
}

export function saveNativeVersion(
  noteId: string,
  noteTitle: string,
  markdown: string,
  expectedHead: string | null,
  message: string | null = null,
): Promise<NativeSaveVersionResult> {
  return invoke<NativeSaveVersionResult>("version_save", {
    request: { noteId, noteTitle, markdown, expectedHead, message },
  });
}

export function readNativeVersion(
  versionId: string,
): Promise<NativeVersionContent> {
  return invoke<NativeVersionContent>("version_read", {
    request: { versionId },
  });
}

export function checkoutNativeVersion(
  noteId: string,
  versionId: string,
  expectedHead: string | null,
): Promise<NativeVersionHistory> {
  return invoke<NativeVersionHistory>("version_checkout", {
    request: { noteId, versionId, expectedHead },
  });
}

export function deleteNativeVersion(
  noteId: string,
  versionId: string,
  expectedHead: string | null,
): Promise<NativeDeleteVersionResult> {
  return invoke<NativeDeleteVersionResult>("version_delete", {
    request: { noteId, versionId, expectedHead },
  });
}

export function setNativeVersionCheckpoint(
  noteId: string,
  versionId: string,
  expectedHead: string | null,
  checkpointName: string | null,
): Promise<NativeVersionHistory> {
  return invoke<NativeVersionHistory>("version_set_checkpoint", {
    request: { noteId, versionId, expectedHead, checkpointName },
  });
}

export function previewNativeVersionRetention(
  noteId: string,
  expectedHead: string | null,
  policy: NativeVersionRetentionPolicy,
): Promise<NativeVersionRetentionPreview> {
  return invoke<NativeVersionRetentionPreview>("version_retention_preview", {
    request: { noteId, expectedHead, policy },
  });
}

export function applyNativeVersionRetention(
  preview: NativeVersionRetentionPreview,
): Promise<NativeApplyVersionRetentionResult> {
  return invoke<NativeApplyVersionRetentionResult>("version_retention_apply", {
    request: {
      noteId: preview.noteId,
      expectedHead: preview.expectedHead,
      policy: preview.policy,
      cutoffAtMillis: preview.cutoffAtMillis,
      previewToken: preview.previewToken,
    },
  });
}

export function listNativeWorkspaceBackups(): Promise<
  readonly NativeWorkspaceBackupSummary[]
> {
  return invoke<readonly NativeWorkspaceBackupSummary[]>(
    "workspace_backup_list",
  );
}

export function createNativeWorkspaceBackup(
  label: string | null,
): Promise<NativeCreateWorkspaceBackupResult> {
  return invoke<NativeCreateWorkspaceBackupResult>(
    "workspace_backup_create",
    { request: { label } },
  );
}

export function verifyNativeWorkspaceBackup(
  backupId: string,
): Promise<NativeVerifyWorkspaceBackupResult> {
  return invoke<NativeVerifyWorkspaceBackupResult>(
    "workspace_backup_verify",
    { request: { backupId } },
  );
}

export function prepareNativeWorkspaceRestore(
  backupId: string,
): Promise<NativePrepareWorkspaceRestoreResult> {
  return invoke<NativePrepareWorkspaceRestoreResult>(
    "workspace_restore_prepare",
    { request: { backupId } },
  );
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
