import { describe, expect, it } from "vitest";

import {
  COMMANDS,
  commandForShortcut,
  commandsForContext,
  commandsForPalette,
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
