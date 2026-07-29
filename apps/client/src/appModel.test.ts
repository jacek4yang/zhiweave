import { describe, expect, it } from "vitest";

import {
  addSnapshot,
  applyTextDelta,
  createBlankNote,
  createInitialWorkspace,
  createLearningPrompt,
  createTextDelta,
  deleteSnapshot,
  openOrCreateDailyJournal,
  parseWorkspace,
  resolveSnapshotMarkdown,
  restoreSnapshot,
  searchNotes,
  snapshotStorageBytes,
  titleFromMarkdown,
} from "./appModel";

describe("workspace model", () => {
  it("falls back safely when persisted data is corrupt", () => {
    const workspace = parseWorkspace("{not-json");

    expect(workspace.selectedNoteId).toBe("welcome");
    expect(workspace.notes.length).toBeGreaterThan(0);
  });

  it("searches both titles and Markdown content", () => {
    const workspace = createInitialWorkspace();

    expect(searchNotes(workspace.notes, "ownership")[0]?.id).toBe(
      "english-learning",
    );
    expect(searchNotes(workspace.notes, "证据检查")[0]?.id).toBe(
      "paper-reading",
    );
  });

  it("creates a structured Markdown note", () => {
    const note = createBlankNote(
      "  线性代数中的特征向量  ",
      "topics",
      new Date("2026-07-29T15:00:00.000Z"),
    );

    expect(note.title).toBe("线性代数中的特征向量");
    expect(note.markdown).toContain("# 线性代数中的特征向量");
    expect(note.markdown).toContain("## 证据与例子");
  });

  it("builds an AI prompt that preserves the current note", () => {
    const note = createInitialWorkspace().notes[0];
    if (note === undefined) {
      throw new Error("seed note is missing");
    }

    const prompt = createLearningPrompt(note);

    expect(prompt).toContain(note.title);
    expect(prompt).toContain(note.markdown);
    expect(prompt).toContain("主动回答");
  });

  it("restores a snapshot without losing the current content", () => {
    const original = createInitialWorkspace();
    const note = original.notes[0];
    if (note === undefined) {
      throw new Error("seed note is missing");
    }
    const withSnapshot = addSnapshot(
      original,
      note,
      new Date("2026-07-29T15:01:00.000Z"),
    );
    const changed = {
      ...withSnapshot,
      notes: withSnapshot.notes.map((item) =>
        item.id === note.id ? { ...item, markdown: "# changed" } : item,
      ),
    };
    const snapshot = changed.snapshots[0];
    if (snapshot === undefined) {
      throw new Error("snapshot is missing");
    }

    const restored = restoreSnapshot(
      changed,
      snapshot.id,
      new Date("2026-07-29T15:02:00.000Z"),
    );

    expect(
      restored.notes.find((item) => item.id === note.id)?.markdown,
    ).toBe(note.markdown);
  });

  it("stores compact deltas that reconstruct the exact Markdown", () => {
    const base = "# 标题\n\n一段不会变化的正文。\n";
    const target = "# 标题\n\n一段不会变化的正文，补充一个结论。\n";
    const delta = createTextDelta(base, target);

    expect(applyTextDelta(base, delta)).toBe(target);
    expect(delta.insertedText.length).toBeLessThan(target.length);
  });

  it("keeps branches restorable when an old version is deleted", () => {
    const initial = createInitialWorkspace();
    const note = initial.notes[0];
    if (note === undefined) {
      throw new Error("seed note is missing");
    }
    const first = addSnapshot(
      initial,
      note,
      new Date("2026-07-29T15:00:00.000Z"),
    );
    const firstSnapshot = first.snapshots[0];
    if (firstSnapshot === undefined) {
      throw new Error("first snapshot is missing");
    }
    const mainMarkdown = `${note.markdown}\n主线结论`;
    const mainNote = { ...note, markdown: mainMarkdown };
    const main = addSnapshot(
      {
        ...first,
        notes: first.notes.map((item) =>
          item.id === note.id ? mainNote : item,
        ),
      },
      mainNote,
      new Date("2026-07-29T15:01:00.000Z"),
    );
    const restored = restoreSnapshot(
      main,
      firstSnapshot.id,
      new Date("2026-07-29T15:02:00.000Z"),
    );
    const branchMarkdown = `${note.markdown}\n分支结论`;
    const branchNote = { ...note, markdown: branchMarkdown };
    const branched = addSnapshot(
      {
        ...restored,
        notes: restored.notes.map((item) =>
          item.id === note.id ? branchNote : item,
        ),
      },
      branchNote,
      new Date("2026-07-29T15:03:00.000Z"),
    );
    const branchSnapshot = branched.snapshots[0];
    const mainSnapshot = branched.snapshots[1];
    if (branchSnapshot === undefined || mainSnapshot === undefined) {
      throw new Error("branch snapshots are missing");
    }

    expect(branchSnapshot.parentId).toBe(firstSnapshot.id);
    expect(mainSnapshot.parentId).toBe(firstSnapshot.id);
    expect(snapshotStorageBytes(branchSnapshot)).toBeLessThan(
      branchMarkdown.length,
    );

    const pruned = deleteSnapshot(branched, firstSnapshot.id);

    expect(resolveSnapshotMarkdown(pruned, branchSnapshot.id)).toBe(
      branchMarkdown,
    );
    expect(resolveSnapshotMarkdown(pruned, mainSnapshot.id)).toBe(
      mainMarkdown,
    );
    expect(
      pruned.snapshots.find((item) => item.id === branchSnapshot.id)?.parentId,
    ).toBeNull();
  });

  it("migrates legacy full snapshots without losing restore data", () => {
    const initial = createInitialWorkspace();
    const note = initial.notes[0];
    if (note === undefined) {
      throw new Error("seed note is missing");
    }
    const legacyMarkdown = `${note.markdown}\n旧版本仍可恢复`;
    const parsed = parseWorkspace(
      JSON.stringify({
        ...initial,
        versionHeads: undefined,
        snapshots: [
          {
            id: "legacy-1",
            noteId: note.id,
            noteTitle: note.title,
            markdown: legacyMarkdown,
            createdAt: "2026-07-29T15:00:00.000Z",
          },
        ],
      }),
    );

    expect(resolveSnapshotMarkdown(parsed, "legacy-1")).toBe(legacyMarkdown);
    expect(parsed.versionHeads[note.id]).toBe("legacy-1");
  });

  it("opens one idempotent local journal per calendar day", () => {
    const initial = createInitialWorkspace();
    const first = openOrCreateDailyJournal(
      initial,
      new Date("2026-07-30T08:00:00.000Z"),
    );
    const second = openOrCreateDailyJournal(
      first.workspace,
      new Date("2026-07-30T12:00:00.000Z"),
    );

    expect(second.note.id).toBe(first.note.id);
    expect(second.workspace.notes.length).toBe(first.workspace.notes.length);
    expect(second.note.markdown).toContain("## 今日记录");
  });

  it("uses the first level-one heading as the knowledge-node name", () => {
    expect(
      titleFromMarkdown(
        "前言\n# **新的节点名称**\n\n## 子标题\n",
        "旧名称",
      ),
    ).toBe("新的节点名称");
    expect(titleFromMarkdown("## 只有二级标题", "保留名称")).toBe("保留名称");
  });
});
