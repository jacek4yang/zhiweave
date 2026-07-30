import { describe, expect, it } from "vitest";

import {
  COMMANDS,
  commandForShortcut,
  commandsForContext,
  commandsForPalette,
  matchCommandShortcut,
  shortcutForCommand,
  type CommandCapability,
  type CommandContext,
  type KeyboardChord,
} from "./commandRegistry";

function context(
  capabilities: readonly CommandCapability[],
  scope?: CommandContext["scope"],
): CommandContext {
  return {
    capabilities: new Set(capabilities),
    ...(scope === undefined ? {} : { scope }),
  };
}

function chord(
  key: string,
  modifiers: Partial<Omit<KeyboardChord, "key">> = {},
): KeyboardChord {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("command registry", () => {
  it("keeps command ids and keyboard chords unique", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);

    const chords = COMMANDS.flatMap((command) => {
      const item = command.shortcut;
      return item === undefined
        ? []
        : [
            [
              item.primary ?? false,
              item.alt ?? false,
              item.shift ?? false,
              item.key.toLocaleLowerCase("en-US"),
              item.second?.primary ?? false,
              item.second?.alt ?? false,
              item.second?.shift ?? false,
              item.second?.key.toLocaleLowerCase("en-US") ?? "",
            ].join(":"),
          ];
    });
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("distinguishes quick open from the command palette and ignores IME", () => {
    expect(
      commandForShortcut(chord("p", { ctrlKey: true }))?.id,
    ).toBe("workbench.quickOpen");
    expect(
      commandForShortcut(
        chord("P", { ctrlKey: true, shiftKey: true }),
      )?.id,
    ).toBe("workbench.commandPalette");
    expect(
      commandForShortcut(
        chord("p", { ctrlKey: true, shiftKey: true, isComposing: true }),
      ),
    ).toBeUndefined();
  });

  it("dispatches a two-stroke shortcut only after its second chord", () => {
    const first = matchCommandShortcut(chord("k", { ctrlKey: true }));
    expect(first.kind).toBe("prefix");
    if (first.kind !== "prefix") {
      return;
    }
    expect(
      matchCommandShortcut(
        chord("Control", { ctrlKey: true }),
        {},
        first.stroke,
      ),
    ).toEqual(first);
    expect(
      matchCommandShortcut(
        chord("s", { ctrlKey: true }),
        {},
        first.stroke,
      ),
    ).toMatchObject({
      kind: "command",
      command: { id: "workbench.shortcutEditor" },
    });
    expect(
      matchCommandShortcut(
        chord("x", { ctrlKey: true }),
        {},
        first.stroke,
      ),
    ).toEqual({ kind: "none" });
  });

  it("uses one effective override for dispatch, palette, and context menus", () => {
    const custom = {
      key: "j",
      label: "Ctrl+Alt+J",
      primary: true,
      alt: true,
    } as const;
    const overrides = {
      "view.split": custom,
      "workbench.quickOpen": null,
    } as const;

    expect(
      commandForShortcut(
        chord("j", { ctrlKey: true, altKey: true }),
        overrides,
      )?.id,
    ).toBe("view.split");
    expect(
      commandForShortcut(chord("p", { ctrlKey: true }), overrides),
    ).toBeUndefined();
    expect(shortcutForCommand("view.split", overrides)?.label).toBe(
      "Ctrl+Alt+J",
    );
    expect(
      commandsForPalette(context(["note"], "workspace"), "分栏", overrides)[0]
        ?.shortcut?.label,
    ).toBe("Ctrl+Alt+J");
    expect(
      commandsForContext(context(["note"], "editor"), overrides).find(
        (command) => command.id === "view.split",
      )?.shortcut?.label,
    ).toBe("Ctrl+Alt+J");
  });

  it("shows only commands that belong to the clicked object", () => {
    const versionCommands = commandsForContext(
      context(["native", "note", "snapshot"], "version-node"),
    );
    expect(versionCommands.map((command) => command.id)).toEqual([
      "version.restore",
      "version.copyMarkdown",
      "version.toggleCheckpoint",
      "version.openNote",
      "version.delete",
    ]);

    const titlebarCommands = commandsForContext(context([], "titlebar"));
    expect(titlebarCommands.map((command) => command.id)).toEqual([
      "window.minimize",
      "window.maximize",
      "window.close",
    ]);

    const panelCommands = commandsForContext(
      context([], "panel-resizer"),
    );
    expect(panelCommands.map((command) => command.id)).toEqual([
      "workbench.resetPanelLayout",
    ]);
  });

  it("offers only the tab state transition that matches the clicked tab", () => {
    const previewCommands = commandsForContext(
      context(["note", "tab", "previewTab", "multiTabs"], "tab"),
    );
    const pinnedCommands = commandsForContext(
      context(["note", "tab", "pinnedTab", "multiTabs"], "tab"),
    );

    expect(
      previewCommands
        .filter((command) => ["tab.pin", "tab.unpin"].includes(command.id))
        .map((command) => command.id),
    ).toEqual(["tab.pin"]);
    expect(
      pinnedCommands
        .filter((command) => ["tab.pin", "tab.unpin"].includes(command.id))
        .map((command) => command.id),
    ).toEqual(["tab.unpin"]);
    expect(
      commandsForPalette(
        context(["note", "tab", "previewTab"]),
        "固定标签",
      ).map((command) => command.id),
    ).toContain("tab.pin");
    expect(
      commandsForPalette(
        context(["note", "tab", "pinnedTab"]),
        "临时预览标签",
      ).map((command) => command.id),
    ).toContain("tab.unpin");
  });

  it("hides native-only commands in browser preview", () => {
    const native = commandsForContext(
      context(["native", "backupIdle"], "workspace"),
    );
    const browser = commandsForContext(context(["browser"], "workspace"));

    expect(native.some((command) => command.id === "backup.create")).toBe(true);
    expect(browser.some((command) => command.id === "backup.create")).toBe(
      false,
    );
  });

  it("keeps unavailable commands visible but disabled when the action is relevant", () => {
    const inputCommands = commandsForContext(
      context(["inputTarget"], "input"),
    );
    expect(inputCommands.map((command) => command.id)).toEqual([
      "edit.paste",
      "edit.selectAll",
    ]);

    const editorCommands = commandsForContext(
      context(["note"], "editor"),
    );
    expect(
      editorCommands.find((command) => command.id === "edit.undo")?.enabled,
    ).toBe(false);
    expect(
      editorCommands.find((command) => command.id === "edit.redo")?.enabled,
    ).toBe(false);
    expect(
      editorCommands
        .filter((command) => command.id.startsWith("note.copy"))
        .map((command) => command.id),
    ).toEqual([
      "note.copyMarkdown",
      "note.copyPlainText",
      "note.copyLearningPrompt",
    ]);
    expect(
      editorCommands
        .filter((command) => command.id.startsWith("view.toggle"))
        .map((command) => command.id),
    ).toEqual(["view.toggleLivePreview", "view.toggleOutline"]);
  });

  it("gives the semantic outline its own location-aware menu", () => {
    const outlineCommands = commandsForContext(
      context(["note"], "outline"),
    );

    expect(outlineCommands.map((command) => command.id)).toEqual([
      "view.toggleOutline",
      "view.toggleLivePreview",
      "note.copyMarkdown",
      "note.copyPlainText",
      "note.copyLearningPrompt",
      "version.save",
      "view.edit",
      "view.split",
      "view.preview",
      "note.showVersions",
    ]);
    expect(
      outlineCommands.some((command) => command.id === "edit.undo"),
    ).toBe(false);
  });

  it("keeps backlink-panel and source-node context menus distinct", () => {
    const panelCommands = commandsForContext(
      context(["native", "note"], "backlinks"),
    );
    expect(panelCommands.map((command) => command.id)).toEqual([
      "view.toggleBacklinks",
      "view.toggleGraph",
      "view.toggleOutline",
      "view.toggleLivePreview",
      "note.copyMarkdown",
      "note.copyPlainText",
      "note.copyLearningPrompt",
      "version.save",
      "view.edit",
      "view.split",
      "view.preview",
      "note.showVersions",
    ]);

    const sourceCommands = commandsForContext(
      context(["native", "note", "noteRename"], "note-item"),
    );
    expect(
      sourceCommands.some((command) => command.id === "view.toggleBacklinks"),
    ).toBe(false);
    expect(sourceCommands[0]?.id).toBe("note.open");
  });

  it("separates graph background commands from graph knowledge nodes", () => {
    const graphCommands = commandsForContext(
      context(["native", "note"], "graph"),
    );
    expect(graphCommands.map((command) => command.id)).toEqual([
      "view.toggleGraph",
      "view.toggleBacklinks",
      "view.toggleOutline",
      "view.toggleLivePreview",
      "note.copyMarkdown",
      "note.copyPlainText",
      "note.copyLearningPrompt",
      "version.save",
      "view.edit",
      "view.split",
      "view.preview",
      "note.showVersions",
    ]);
    const nodeCommands = commandsForContext(
      context(["native", "note", "noteRename"], "note-item"),
    );
    expect(nodeCommands[0]?.id).toBe("note.open");
    expect(
      nodeCommands.some((command) => command.id === "view.toggleGraph"),
    ).toBe(false);
  });

  it("gives Wiki targets a link-specific menu instead of the preview menu", () => {
    const wikiCommands = commandsForContext(
      context(["native", "note", "wikiTarget"], "wiki-link"),
    );

    expect(wikiCommands.map((command) => command.id)).toEqual([
      "wiki.open",
      "wiki.copyTarget",
    ]);
    expect(
      wikiCommands.some((command) => command.id === "note.copyMarkdown"),
    ).toBe(false);
    expect(
      commandsForContext(
        context(["browser", "note", "wikiTarget"], "wiki-link"),
      ).map((command) => command.id),
    ).toEqual(["wiki.copyTarget"]);
  });

  it("gives attachments a minimal resource-specific menu", () => {
    const attachmentCommands = commandsForContext(
      context(["native", "note", "attachmentTarget"], "attachment"),
    );

    expect(attachmentCommands.map((command) => command.id)).toEqual([
      "attachment.copyTarget",
    ]);
    expect(
      attachmentCommands.some(
        (command) => command.id === "note.copyMarkdown",
      ),
    ).toBe(false);
  });

  it("offers native attachment import only at an editable cursor", () => {
    const editorCommands = commandsForContext(
      context(["native", "note", "attachmentImport"], "editor"),
    );
    expect(
      editorCommands.filter((command) => command.id === "attachment.import"),
    ).toHaveLength(1);
    expect(
      commandsForContext(
        context(["browser", "note", "attachmentImport"], "editor"),
      ).some((command) => command.id === "attachment.import"),
    ).toBe(false);
    expect(
      commandsForContext(
        context(["native", "note", "attachmentImport"], "preview"),
      ).some((command) => command.id === "attachment.import"),
    ).toBe(false);
  });

  it("searches Chinese and aliases while preserving the registry order", () => {
    const commandContext = context([
      "native",
      "note",
      "tab",
      "multiTabs",
      "closedTabs",
      "backupIdle",
    ]);

    expect(
      commandsForPalette(commandContext, "UUID").map(
        (command) => command.id,
      ),
    ).toEqual(["workspace.createUuidLab"]);
    expect(
      commandsForPalette(commandContext, "分支").map(
        (command) => command.id,
      ),
    ).toEqual(["note.showVersions"]);
    expect(commandsForPalette(commandContext, "")[0]?.id).toBe(
      "workbench.quickOpen",
    );
  });
});
