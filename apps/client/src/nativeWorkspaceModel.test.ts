import { describe, expect, it } from "vitest";

import {
  folderForView,
  mergeExternalSnapshot,
  mergeSavedDocument,
  nativeDocumentToLearningNote,
  nativeHistoryToSnapshots,
  nativeSnapshotToWorkspace,
  portableSlug,
  utf16OffsetFromUtf8ByteOffset,
} from "./nativeWorkspaceModel";
import type { NativeNoteDocument } from "./workspaceClient";

const DOCUMENT: NativeNoteDocument = {
  id: "0189f4c1-a818-8000-8000-000000000001",
  title: "今天",
  path: "daily/2026-07-30.md",
  kind: "daily",
  markdown: "# 今天\n",
  revision: "before",
  lineEnding: "crlf",
  hasUtf8Bom: true,
  modifiedAtMillis: Date.parse("2026-07-30T00:00:00.000Z"),
};

describe("native workspace model", () => {
  it("maps native files without leaking browser demo state", () => {
    const workspace = nativeSnapshotToWorkspace({
      rootDisplay: "fixed-test-root",
      documents: [DOCUMENT],
      index: {
        state: "ready",
        schemaVersion: 1,
        noteCount: 1,
        issue: null,
      },
    });

    expect(workspace.notes).toHaveLength(1);
    expect(workspace.snapshots).toEqual([]);
    expect(workspace.notes[0]).toMatchObject({
      id: DOCUMENT.id,
      path: DOCUMENT.path,
      view: "today",
      kind: "journal",
      journalDate: "2026-07-30",
      lineEnding: "crlf",
      hasUtf8Bom: true,
    });
  });

  it("updates the revision without discarding edits made during a save", () => {
    const opened = nativeDocumentToLearningNote(DOCUMENT);
    const editedAgain = {
      ...opened,
      markdown: "# Newer editor title\n",
    };
    const savedDocument = {
      ...DOCUMENT,
      title: "Saved title",
      revision: "after",
    };

    expect(
      mergeSavedDocument(editedAgain, "# Earlier save\n", savedDocument),
    ).toMatchObject({
      markdown: "# Newer editor title\n",
      title: "Newer editor title",
      revision: "after",
    });
  });

  it("maps durable version nodes without pretending metadata contains Markdown", () => {
    const mapped = nativeHistoryToSnapshots({
      noteId: DOCUMENT.id,
      head: "01900000-0000-7000-8000-000000000002",
      nodes: [
        {
          id: "01900000-0000-7000-8000-000000000002",
          noteId: DOCUMENT.id,
          noteTitle: "今天",
          parentId: "01900000-0000-7000-8000-000000000001",
          contentHash: "a".repeat(64),
          contentLength: 128,
          createdAtMillis: Date.parse("2026-07-30T01:00:00.000Z"),
          message: "恢复前保护",
          checkpointName: "可发布基线",
        },
      ],
      stats: {
        versionCount: 1,
        chunkCount: 1,
        logicalBytes: 128,
        storedBytes: 64,
      },
    });

    expect(mapped.versionHeads[DOCUMENT.id]).toBe(
      "01900000-0000-7000-8000-000000000002",
    );
    expect(mapped.snapshots[0]).toMatchObject({
      noteId: DOCUMENT.id,
      contentHash: "a".repeat(64),
      contentLength: 128,
      message: "恢复前保护",
      checkpointName: "可发布基线",
      delta: { insertedText: "" },
    });
  });

  it("creates portable bounded filenames and stable view folders", () => {
    expect(portableSlug('  Rust: "借用" / 所有权?  ')).toBe(
      "Rust-借用-所有权",
    );
    expect(portableSlug("<>:?*")).toBe("note");
    expect(portableSlug("a".repeat(100))).toHaveLength(80);
    expect(folderForView("sources")).toBe("sources");
    expect(folderForView("today")).toBe("daily");
  });

  it("maps Rust UTF-8 backlink offsets to CodeMirror UTF-16 positions", () => {
    const markdown = "前😀 [[UUID]]";
    expect(utf16OffsetFromUtf8ByteOffset(markdown, 8)).toBe(4);
    expect(utf16OffsetFromUtf8ByteOffset(markdown, 2)).toBe(0);
    expect(utf16OffsetFromUtf8ByteOffset(markdown, 10_000)).toBe(
      markdown.length,
    );
    expect(utf16OffsetFromUtf8ByteOffset(markdown, -1)).toBe(0);
  });

  it("applies clean external changes while preserving dirty editor buffers", () => {
    const clean = nativeDocumentToLearningNote(DOCUMENT);
    const dirty = {
      ...nativeDocumentToLearningNote({
        ...DOCUMENT,
        id: "0189f4c1-a818-8000-8000-000000000002",
        path: "topics/dirty.md",
        kind: "topic",
      }),
      markdown: "# Unsaved local text\n",
    };
    const deletedDirty = {
      ...nativeDocumentToLearningNote({
        ...DOCUMENT,
        id: "0189f4c1-a818-8000-8000-000000000003",
        path: "topics/deleted.md",
        kind: "topic",
      }),
      markdown: "# Unsaved deleted note\n",
    };
    const workspace = {
      notes: [clean, dirty, deletedDirty],
      selectedNoteId: dirty.id,
      completedChecks: {},
      snapshots: [],
      versionHeads: {},
    };
    const result = mergeExternalSnapshot(
      workspace,
      {
        rootDisplay: "fixed-test-root",
        documents: [
          { ...DOCUMENT, markdown: "# External clean\n", revision: "clean-2" },
          {
            ...DOCUMENT,
            id: dirty.id,
            path: "topics/moved.md",
            kind: "topic",
            markdown: "# External dirty\n",
            revision: "dirty-2",
          },
        ],
        index: {
          state: "ready",
          schemaVersion: 1,
          noteCount: 2,
          issue: null,
        },
      },
      new Map([
        [clean.id, clean.markdown],
        [dirty.id, "# Before dirty edit\n"],
        [deletedDirty.id, "# Before deleted edit\n"],
      ]),
    );

    expect(result.workspace.notes.find((note) => note.id === clean.id)?.markdown)
      .toBe("# External clean\n");
    expect(result.workspace.notes.find((note) => note.id === dirty.id)).toBe(
      dirty,
    );
    expect(
      result.workspace.notes.find((note) => note.id === deletedDirty.id),
    ).toBe(deletedDirty);
    expect([...result.unresolvedNoteIds]).toEqual([
      dirty.id,
      deletedDirty.id,
    ]);
  });
});
