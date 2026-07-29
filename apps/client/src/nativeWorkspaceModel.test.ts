import { describe, expect, it } from "vitest";

import {
  folderForView,
  mergeSavedDocument,
  nativeDocumentToLearningNote,
  nativeSnapshotToWorkspace,
  portableSlug,
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

  it("creates portable bounded filenames and stable view folders", () => {
    expect(portableSlug('  Rust: "借用" / 所有权?  ')).toBe(
      "Rust-借用-所有权",
    );
    expect(portableSlug("<>:?*")).toBe("note");
    expect(portableSlug("a".repeat(100))).toHaveLength(80);
    expect(folderForView("sources")).toBe("sources");
    expect(folderForView("today")).toBe("daily");
  });
});
