import { describe, expect, it } from "vitest";

import {
  COMMANDS,
  shortcutForCommand,
  type KeyboardChord,
  type ShortcutOverrides,
} from "./commandRegistry";
import {
  changeShortcut,
  createShortcut,
  findShortcutConflict,
  parseShortcutOverrides,
  restoreDefaultShortcut,
  serializeShortcutOverrides,
  shortcutAriaLabel,
  shortcutDiffersFromDefault,
  shortcutStrokeFromKeyboard,
} from "./shortcutModel";

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

describe("shortcut preferences", () => {
  it("captures safe primary and function-key strokes without IME input", () => {
    expect(
      shortcutStrokeFromKeyboard(
        chord("P", { ctrlKey: true, shiftKey: true }),
      ),
    ).toEqual({
      key: "p",
      primary: true,
      shift: true,
    });
    expect(shortcutStrokeFromKeyboard(chord("F3"))).toEqual({ key: "f3" });
    expect(shortcutStrokeFromKeyboard(chord("a"))).toBeNull();
    expect(
      shortcutStrokeFromKeyboard(
        chord("Process", { ctrlKey: true, isComposing: true }),
      ),
    ).toBeNull();
  });

  it("formats one- and two-stroke shortcuts from one canonical model", () => {
    const shortcut = createShortcut([
      { key: "k", primary: true },
      { key: "s", primary: true, shift: true },
    ]);

    expect(shortcut?.label).toBe("Ctrl+K Ctrl+Shift+S");
    expect(shortcut === null ? "" : shortcutAriaLabel(shortcut)).toBe(
      "Control+K Control+Shift+S",
    );
  });

  it("rejects unsafe or oversized shortcut strokes", () => {
    expect(createShortcut([{ key: "a" }])).toBeNull();
    expect(createShortcut([{ key: "Control", primary: true }])).toBeNull();
    expect(
      createShortcut([{ key: "x".repeat(25), primary: true }]),
    ).toBeNull();
    expect(createShortcut([])).toBeNull();
    expect(
      createShortcut([
        { key: "a", primary: true },
        { key: "b", primary: true },
        { key: "c", primary: true },
      ]),
    ).toBeNull();
  });

  it("round-trips only normalized overrides", () => {
    const custom = createShortcut([
      { key: "j", primary: true, alt: true },
    ]);
    expect(custom).not.toBeNull();
    const overrides: ShortcutOverrides = {
      "view.split": custom,
      "view.preview": null,
    };

    expect(
      parseShortcutOverrides(serializeShortcutOverrides(overrides)),
    ).toEqual(overrides);
  });

  it("fails closed for malformed, duplicate, future, and conflicting records", () => {
    expect(parseShortcutOverrides("{")).toEqual({});
    expect(
      parseShortcutOverrides(
        JSON.stringify({ schemaVersion: 2, overrides: [] }),
      ),
    ).toEqual({});
    expect(
      parseShortcutOverrides(
        JSON.stringify({
          schemaVersion: 1,
          overrides: [
            { commandId: "view.split", shortcut: null },
            { commandId: "view.split", shortcut: null },
          ],
        }),
      ),
    ).toEqual({});
    expect(
      parseShortcutOverrides(
        JSON.stringify({
          schemaVersion: 1,
          overrides: [
            { commandId: "view.preview", shortcut: null },
            { commandId: "unknown.command", shortcut: null },
          ],
        }),
      ),
    ).toEqual({});
    expect(
      parseShortcutOverrides(
        JSON.stringify({
          schemaVersion: 1,
          overrides: [
            {
              commandId: "view.split",
              shortcut: {
                strokes: [
                  {
                    key: "p",
                    primary: true,
                    alt: false,
                    shift: false,
                  },
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual({});
  });

  it("detects exact and prefix conflicts", () => {
    const quickOpen = shortcutForCommand("workbench.quickOpen");
    const shortcutEditor = shortcutForCommand("workbench.shortcutEditor");
    expect(quickOpen).toBeDefined();
    expect(shortcutEditor).toBeDefined();

    expect(
      quickOpen === undefined
        ? null
        : findShortcutConflict("view.split", quickOpen, {}),
    ).toBe("workbench.quickOpen");
    const ctrlK = createShortcut([{ key: "k", primary: true }]);
    expect(
      ctrlK === null
        ? null
        : findShortcutConflict("view.split", ctrlK, {}),
    ).toBe("workbench.shortcutEditor");
  });

  it("requires explicit replacement and unbinds the conflicting command", () => {
    const quickOpen = shortcutForCommand("workbench.quickOpen");
    expect(quickOpen).toBeDefined();
    if (quickOpen === undefined) {
      return;
    }
    const proposed = changeShortcut({}, "view.split", quickOpen);
    expect(proposed.conflictId).toBe("workbench.quickOpen");
    expect(proposed.overrides).toEqual({});

    const replaced = changeShortcut(
      {},
      "view.split",
      quickOpen,
      true,
    );
    expect(replaced.conflictId).toBe("workbench.quickOpen");
    expect(shortcutForCommand("view.split", replaced.overrides)?.label).toBe(
      "Ctrl+P",
    );
    expect(
      shortcutForCommand("workbench.quickOpen", replaced.overrides),
    ).toBeUndefined();
  });

  it("removes redundant overrides and restores defaults", () => {
    const defaultSplit = shortcutForCommand("view.split");
    expect(defaultSplit).toBeDefined();
    if (defaultSplit === undefined) {
      return;
    }
    expect(
      changeShortcut({}, "view.split", defaultSplit).overrides,
    ).toEqual({});

    const unbound = changeShortcut({}, "view.split", null).overrides;
    expect(shortcutForCommand("view.split", unbound)).toBeUndefined();
    expect(shortcutDiffersFromDefault("view.split", unbound)).toBe(true);

    const restored = restoreDefaultShortcut(unbound, "view.split");
    expect(restored.conflictId).toBeNull();
    expect(restored.overrides).toEqual({});
  });

  it("serializes no command text, Markdown, paths, or workspace state", () => {
    const serialized = serializeShortcutOverrides({
      "view.preview": null,
    });
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual([
      "overrides",
      "schemaVersion",
    ]);
    expect(serialized).not.toMatch(
      /title|markdown|content|revision|root|path|attachment/i,
    );
  });

  it("keeps every default shortcut conflict-free, including prefixes", () => {
    for (const command of COMMANDS) {
      if (command.shortcut === undefined) {
        continue;
      }
      expect(
        findShortcutConflict(command.id, command.shortcut, {}),
      ).toBeNull();
    }
  });
});
