import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKBENCH_PREFERENCES,
  parseWorkbenchPreferences,
  restoreWorkbenchTabSession,
  serializeWorkbenchPreferences,
  type WorkbenchPreferences,
} from "./workbenchPreferences";

describe("workbench preferences", () => {
  it("uses safe defaults when no stored state exists", () => {
    expect(parseWorkbenchPreferences(null, null)).toEqual(
      DEFAULT_WORKBENCH_PREFERENCES,
    );
  });

  it("migrates legacy display toggles into one inspector", () => {
    expect(
      parseWorkbenchPreferences(
        null,
        JSON.stringify({
          backlinksOpen: true,
          livePreviewEnabled: false,
          localGraphOpen: true,
          outlineOpen: true,
        }),
      ),
    ).toEqual({
      ...DEFAULT_WORKBENCH_PREFERENCES,
      inspector: "outline",
      livePreviewEnabled: false,
    });
  });

  it("round-trips the versioned UI session", () => {
    const preferences: WorkbenchPreferences = {
      activeNoteId: "note-b",
      editorMode: "split",
      inspector: "backlinks",
      livePreviewEnabled: false,
      sidebarOpen: false,
      tabSession: {
        openNoteIds: ["note-a", "note-b"],
        closedNoteIds: ["note-c"],
        previewNoteId: "note-b",
      },
      versionsOpen: true,
    };

    expect(
      parseWorkbenchPreferences(
        serializeWorkbenchPreferences(preferences),
        null,
      ),
    ).toEqual(preferences);
  });

  it("fails closed for malformed and future schema records", () => {
    expect(
      parseWorkbenchPreferences(
        "{",
        JSON.stringify({ outlineOpen: true }),
      ),
    ).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
    expect(
      parseWorkbenchPreferences(
        JSON.stringify({
          schemaVersion: 3,
          editorMode: "split",
        }),
        JSON.stringify({ outlineOpen: true }),
      ),
    ).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
  });

  it("bounds and normalizes stored note identifiers", () => {
    const openNoteIds = Array.from(
      { length: 55 },
      (_, index) => `open-${index}`,
    );
    const closedNoteIds = [
      "open-1",
      ...Array.from({ length: 25 }, (_, index) => `closed-${index}`),
    ];
    const parsed = parseWorkbenchPreferences(
      JSON.stringify({
        schemaVersion: 2,
        activeNoteId: "bad\u0000id",
        editorMode: "unexpected",
        inspector: "unexpected",
        livePreviewEnabled: "yes",
        sidebarOpen: "yes",
        tabSession: {
          openNoteIds: [
            ...openNoteIds,
            "open-0",
            "",
            "bad\u0000id",
            "x".repeat(201),
          ],
          closedNoteIds,
          previewNoteId: "open-2",
        },
        versionsOpen: "yes",
      }),
      null,
    );

    expect(parsed.activeNoteId).toBeNull();
    expect(parsed.editorMode).toBe("edit");
    expect(parsed.inspector).toBeNull();
    expect(parsed.livePreviewEnabled).toBe(true);
    expect(parsed.sidebarOpen).toBe(true);
    expect(parsed.versionsOpen).toBe(false);
    expect(parsed.tabSession?.openNoteIds).toHaveLength(50);
    expect(parsed.tabSession?.openNoteIds[0]).toBe("open-0");
    expect(parsed.tabSession?.closedNoteIds).toHaveLength(20);
    expect(parsed.tabSession?.closedNoteIds).not.toContain("open-1");
    expect(parsed.tabSession?.previewNoteId).toBe("open-2");
  });

  it("restores valid tabs and ensures the active tab is open", () => {
    const restored = restoreWorkbenchTabSession(
      {
        ...DEFAULT_WORKBENCH_PREFERENCES,
        activeNoteId: "note-b",
        tabSession: {
          openNoteIds: ["note-a", "removed"],
          closedNoteIds: ["note-c", "removed"],
          previewNoteId: "removed",
        },
      },
      new Set(["note-a", "note-b", "note-c"]),
      "note-a",
    );

    expect(restored).toEqual({
      activeNoteId: "note-b",
      session: {
        openNoteIds: ["note-a", "note-b"],
        closedNoteIds: ["note-c"],
        previewNoteId: null,
      },
    });
  });

  it("falls back after all previously open notes disappear", () => {
    const restored = restoreWorkbenchTabSession(
      {
        ...DEFAULT_WORKBENCH_PREFERENCES,
        activeNoteId: "removed",
        tabSession: {
          openNoteIds: ["removed"],
          closedNoteIds: [],
          previewNoteId: "removed",
        },
      },
      new Set(["fallback"]),
      "fallback",
    );

    expect(restored).toEqual({
      activeNoteId: "fallback",
      session: {
        openNoteIds: ["fallback"],
        closedNoteIds: [],
        previewNoteId: null,
      },
    });
  });

  it("preserves an intentionally empty tab strip", () => {
    const restored = restoreWorkbenchTabSession(
      {
        ...DEFAULT_WORKBENCH_PREFERENCES,
        tabSession: {
          openNoteIds: [],
          closedNoteIds: ["note-a"],
          previewNoteId: null,
        },
      },
      new Set(["note-a", "fallback"]),
      "fallback",
    );

    expect(restored).toEqual({
      activeNoteId: null,
      session: {
        openNoteIds: [],
        closedNoteIds: ["note-a"],
        previewNoteId: null,
      },
    });
  });

  it("serializes only bounded UI state and never note content", () => {
    const serialized = serializeWorkbenchPreferences({
      activeNoteId: "note-a",
      editorMode: "preview",
      inspector: "graph",
      livePreviewEnabled: true,
      sidebarOpen: true,
      tabSession: {
        openNoteIds: ["note-a"],
        closedNoteIds: [],
        previewNoteId: null,
      },
      versionsOpen: false,
    });
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual([
      "activeNoteId",
      "editorMode",
      "inspector",
      "livePreviewEnabled",
      "schemaVersion",
      "sidebarOpen",
      "tabSession",
      "versionsOpen",
    ]);
    expect(serialized).not.toMatch(
      /markdown|content|revision|root|path|attachment/i,
    );
  });
});
