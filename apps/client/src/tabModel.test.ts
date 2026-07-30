import { describe, expect, it } from "vitest";

import {
  closeOtherTabsInSession,
  closeTabInSession,
  createTabSession,
  makeTabPreview,
  openPinnedTab,
  openPreviewTab,
  pinTab,
  reconcileTabSession,
  remapTabSession,
  reopenClosedTabInSession,
} from "./tabModel";

describe("tab session", () => {
  it("keeps one replaceable preview slot without polluting closed history", () => {
    const initial = openPinnedTab(createTabSession("a"), "b");
    const firstPreview = openPreviewTab(initial, "c");
    const secondPreview = openPreviewTab(firstPreview, "d");

    expect(firstPreview).toEqual({
      openNoteIds: ["a", "b", "c"],
      closedNoteIds: [],
      previewNoteId: "c",
    });
    expect(secondPreview).toEqual({
      openNoteIds: ["a", "b", "d"],
      closedNoteIds: [],
      previewNoteId: "d",
    });
  });

  it("does not turn an existing pinned tab into a preview on single click", () => {
    const withPreview = openPreviewTab(
      openPinnedTab(createTabSession("a"), "b"),
      "c",
    );

    expect(openPreviewTab(withPreview, "b")).toEqual(withPreview);
  });

  it("pins the preview after an explicit open or edit", () => {
    const preview = openPreviewTab(createTabSession("a"), "b");

    expect(pinTab(preview, "b").previewNoteId).toBeNull();
    expect(openPinnedTab(preview, "b").previewNoteId).toBeNull();
  });

  it("turns a pinned tab into the only preview and discards the old preview", () => {
    const session = openPreviewTab(
      openPinnedTab(createTabSession("a"), "b"),
      "c",
    );

    expect(makeTabPreview(session, "b")).toEqual({
      openNoteIds: ["a", "b"],
      closedNoteIds: [],
      previewNoteId: "b",
    });
  });

  it("records explicit closes and reopens a valid tab as pinned", () => {
    const closed = closeTabInSession(
      openPreviewTab(createTabSession("a"), "b"),
      "b",
    );
    const reopened = reopenClosedTabInSession(closed, new Set(["a", "b"]));

    expect(closed.closedNoteIds).toEqual(["b"]);
    expect(reopened.noteId).toBe("b");
    expect(reopened.session).toEqual({
      openNoteIds: ["a", "b"],
      closedNoteIds: [],
      previewNoteId: null,
    });
  });

  it("closes every other tab and keeps the target pinned", () => {
    const session = openPreviewTab(
      openPinnedTab(createTabSession("a"), "b"),
      "c",
    );

    expect(closeOtherTabsInSession(session, "b")).toEqual({
      openNoteIds: ["b"],
      closedNoteIds: ["a", "c"],
      previewNoteId: null,
    });
  });

  it("reconciles removed notes without leaving a dangling preview", () => {
    const session = openPreviewTab(
      openPinnedTab(createTabSession("a"), "b"),
      "c",
    );

    expect(reconcileTabSession(session, new Set(["a", "b", "d"]), "d"))
      .toEqual({
        openNoteIds: ["a", "b", "d"],
        closedNoteIds: [],
        previewNoteId: null,
      });
  });

  it("remaps recovered tabs while preserving preview semantics", () => {
    const session = openPreviewTab(createTabSession("removed"), "preview");
    const replacements = new Map([
      ["removed", "recovery-a"],
      ["preview", "recovery-b"],
    ]);

    expect(
      remapTabSession(
        session,
        (id) => replacements.get(id) ?? id,
        new Set(["recovery-a", "recovery-b"]),
        "recovery-a",
      ),
    ).toEqual({
      openNoteIds: ["recovery-a", "recovery-b"],
      closedNoteIds: [],
      previewNoteId: "recovery-b",
    });
  });
});
