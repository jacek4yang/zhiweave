import { describe, expect, it } from "vitest";

import {
  addSnapshot,
  createBlankNote,
  createInitialWorkspace,
  createLearningPrompt,
  parseWorkspace,
  restoreSnapshot,
  searchNotes,
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
});
