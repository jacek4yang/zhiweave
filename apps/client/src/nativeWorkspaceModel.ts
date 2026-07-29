import {
  titleFromMarkdown,
  type LearningNote,
  type NoteSnapshot,
  type ViewKey,
  type WorkspaceState,
} from "./appModel";
import type {
  NativeNoteDocument,
  NativeVersionHistory,
  NativeWorkspaceSnapshot,
} from "./workspaceClient";

export interface ExternalWorkspaceMerge {
  readonly workspace: WorkspaceState;
  readonly persistedMarkdown: ReadonlyMap<string, string>;
  readonly unresolvedNoteIds: ReadonlySet<string>;
}

export function nativeSnapshotToWorkspace(
  snapshot: NativeWorkspaceSnapshot,
): WorkspaceState {
  const notes = snapshot.documents.map(nativeDocumentToLearningNote);
  const selected =
    notes.find((note) => note.path === "learning/welcome.md") ??
    notes[0];
  return {
    notes,
    selectedNoteId: selected?.id ?? "",
    completedChecks: {},
    snapshots: [],
    versionHeads: {},
  };
}

export function nativeHistoryToSnapshots(
  history: NativeVersionHistory,
): {
  readonly snapshots: readonly NoteSnapshot[];
  readonly versionHeads: Readonly<Record<string, string>>;
} {
  return {
    snapshots: history.nodes.map((node) => ({
      id: node.id,
      noteId: node.noteId,
      noteTitle: node.noteTitle,
      parentId: node.parentId,
      delta: {
        prefixLength: 0,
        deleteCount: 0,
        insertedText: "",
      },
      contentLength: node.contentLength,
      createdAt: new Date(node.createdAtMillis).toISOString(),
      contentHash: node.contentHash,
      ...(node.message === null ? {} : { message: node.message }),
    })),
    versionHeads:
      history.head === null ? {} : { [history.noteId]: history.head },
  };
}

export function nativeDocumentToLearningNote(
  document: NativeNoteDocument,
): LearningNote {
  const journalDate = /^daily\/(\d{4}-\d{2}-\d{2})\.md$/u.exec(
    document.path,
  )?.[1];
  return {
    id: document.id,
    title: document.title,
    view: viewForNativeDocument(document),
    kind:
      document.kind === "daily"
        ? "journal"
        : document.kind === "note"
          ? "note"
          : "learning_node",
    ...(journalDate === undefined ? {} : { journalDate }),
    path: document.path,
    revision: document.revision,
    lineEnding: document.lineEnding,
    hasUtf8Bom: document.hasUtf8Bom,
    markdown: document.markdown,
    updatedAt: timestampToIso(document.modifiedAtMillis),
  };
}

export function mergeSavedDocument(
  note: LearningNote,
  savedMarkdown: string,
  document: NativeNoteDocument,
): LearningNote {
  const currentIsSaved = note.markdown === savedMarkdown;
  return {
    ...note,
    title: currentIsSaved
      ? document.title
      : titleFromMarkdown(note.markdown, note.title),
    revision: document.revision,
    lineEnding: document.lineEnding,
    hasUtf8Bom: document.hasUtf8Bom,
    updatedAt: timestampToIso(document.modifiedAtMillis),
  };
}

export function mergeExternalSnapshot(
  current: WorkspaceState,
  snapshot: NativeWorkspaceSnapshot,
  persistedMarkdown: ReadonlyMap<string, string>,
): ExternalWorkspaceMerge {
  const currentById = new Map(current.notes.map((note) => [note.id, note]));
  const snapshotIds = new Set(
    snapshot.documents.map((document) => document.id),
  );
  const nextPersisted = new Map(persistedMarkdown);
  const unresolvedNoteIds = new Set<string>();
  const notes = snapshot.documents.map((document) => {
    const local = currentById.get(document.id);
    const localIsDirty =
      local !== undefined &&
      persistedMarkdown.get(local.id) !== local.markdown;
    const diskChangedSinceAccepted =
      local !== undefined &&
      (local.path !== document.path || local.revision !== document.revision);
    if (localIsDirty) {
      if (diskChangedSinceAccepted) {
        unresolvedNoteIds.add(local.id);
      }
      return local;
    }
    nextPersisted.set(document.id, document.markdown);
    return nativeDocumentToLearningNote(document);
  });

  for (const local of current.notes) {
    if (snapshotIds.has(local.id)) {
      continue;
    }
    if (persistedMarkdown.get(local.id) !== local.markdown) {
      notes.push(local);
      unresolvedNoteIds.add(local.id);
    } else {
      nextPersisted.delete(local.id);
    }
  }

  const selectedNoteId = notes.some(
    (note) => note.id === current.selectedNoteId,
  )
    ? current.selectedNoteId
    : (notes[0]?.id ?? "");
  return {
    workspace: {
      ...current,
      notes,
      selectedNoteId,
    },
    persistedMarkdown: nextPersisted,
    unresolvedNoteIds,
  };
}

export function folderForView(
  view: Exclude<ViewKey, "versions">,
): string {
  switch (view) {
    case "today":
      return "daily";
    case "continue":
      return "learning";
    case "topics":
      return "topics";
    case "sources":
      return "sources";
    case "experiments":
      return "experiments";
    case "review":
      return "review";
  }
}

export function portableSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .replaceAll(/[<>:"/\\|?*\u0000-\u001f]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/[. ]+$/gu, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : "note";
}

export function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function viewForNativeDocument(
  document: NativeNoteDocument,
): Exclude<ViewKey, "versions"> {
  switch (document.kind) {
    case "daily":
      return "today";
    case "topic":
    case "node":
    case "english_term":
      return document.path.startsWith("learning/") ? "continue" : "topics";
    case "source":
    case "paper":
      return "sources";
    case "experiment":
      return "experiments";
    case "review_card":
      return "review";
    case "note":
      return document.path.startsWith("daily/")
        ? "today"
        : document.path.startsWith("experiments/")
          ? "experiments"
          : "continue";
  }
}

function timestampToIso(modifiedAtMillis: number): string {
  return new Date(
    modifiedAtMillis > 0 ? modifiedAtMillis : Date.now(),
  ).toISOString();
}
