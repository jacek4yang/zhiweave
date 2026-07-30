import {
  COMMANDS,
  commandById,
  shortcutForCommand,
  type CommandDefinition,
  type CommandId,
  type CommandShortcut,
  type CommandShortcutStroke,
  type KeyboardChord,
  type ShortcutOverrides,
} from "./commandRegistry";

export interface ShortcutChangeResult {
  readonly conflictId: CommandId | null;
  readonly overrides: ShortcutOverrides;
}

export const SHORTCUT_PREFERENCES_KEY = "zhiweave.shortcuts.v1";

const SHORTCUT_SCHEMA_VERSION = 1;
const MAX_SHORTCUT_KEY_LENGTH = 24;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const MODIFIER_KEYS = new Set([
  "alt",
  "altgraph",
  "compose",
  "control",
  "dead",
  "meta",
  "process",
  "shift",
  "unidentified",
]);
const EDITABLE_COMMANDS = COMMANDS.filter(
  (command) => command.palette || command.shortcut !== undefined,
);
const EDITABLE_COMMAND_IDS = new Set(
  EDITABLE_COMMANDS.map((command) => command.id),
);

export function editableShortcutCommands(
  overrides: ShortcutOverrides,
): readonly CommandDefinition[] {
  return EDITABLE_COMMANDS.map((command) =>
    commandById(command.id, overrides),
  );
}

export function parseShortcutOverrides(stored: string | null): ShortcutOverrides {
  if (stored === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== SHORTCUT_SCHEMA_VERSION ||
      !Array.isArray(parsed.overrides) ||
      parsed.overrides.length > EDITABLE_COMMANDS.length
    ) {
      return {};
    }
    const result: Partial<Record<CommandId, CommandShortcut | null>> = {};
    const seen = new Set<CommandId>();
    for (const entry of parsed.overrides) {
      if (!isRecord(entry) || !isCommandId(entry.commandId)) {
        return {};
      }
      if (seen.has(entry.commandId)) {
        return {};
      }
      seen.add(entry.commandId);
      if (entry.shortcut === null) {
        setNormalizedOverride(result, entry.commandId, null);
        continue;
      }
      const shortcut = parseStoredShortcut(entry.shortcut);
      if (shortcut === null) {
        return {};
      }
      setNormalizedOverride(result, entry.commandId, shortcut);
    }
    return effectiveShortcutsConflict(result) ? {} : result;
  } catch {
    return {};
  }
}

export function serializeShortcutOverrides(
  overrides: ShortcutOverrides,
): string {
  const normalized = normalizeOverrides(overrides);
  return JSON.stringify({
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    overrides: EDITABLE_COMMANDS.flatMap((command) => {
      if (!Object.prototype.hasOwnProperty.call(normalized, command.id)) {
        return [];
      }
      const shortcut = normalized[command.id];
      return [
        {
          commandId: command.id,
          shortcut:
            shortcut === null || shortcut === undefined
              ? null
              : {
                  strokes: shortcutStrokes(shortcut).map(storedStroke),
                },
        },
      ];
    }),
  });
}

export function shortcutStrokeFromKeyboard(
  chord: KeyboardChord,
): CommandShortcutStroke | null {
  if (chord.defaultPrevented || chord.isComposing) {
    return null;
  }
  const key = normalizeShortcutKey(chord.key);
  if (key === null || MODIFIER_KEYS.has(key)) {
    return null;
  }
  const stroke: CommandShortcutStroke = {
    key,
    ...(chord.ctrlKey || chord.metaKey ? { primary: true } : {}),
    ...(chord.altKey ? { alt: true } : {}),
    ...(chord.shiftKey ? { shift: true } : {}),
  };
  return isSafeShortcutStroke(stroke) ? stroke : null;
}

export function createShortcut(
  strokes: readonly CommandShortcutStroke[],
): CommandShortcut | null {
  if (
    (strokes.length !== 1 && strokes.length !== 2) ||
    strokes.some((stroke) => !isSafeShortcutStroke(stroke))
  ) {
    return null;
  }
  const [first, second] = strokes;
  if (first === undefined) {
    return null;
  }
  const normalizedFirst = normalizeStroke(first);
  const normalizedSecond =
    second === undefined ? undefined : normalizeStroke(second);
  return {
    ...normalizedFirst,
    label: [normalizedFirst, normalizedSecond]
      .filter(
        (stroke): stroke is CommandShortcutStroke => stroke !== undefined,
      )
      .map(formatShortcutStroke)
      .join(" "),
    ...(normalizedSecond === undefined ? {} : { second: normalizedSecond }),
  };
}

export function shortcutAriaLabel(shortcut: CommandShortcut): string {
  return shortcutStrokes(shortcut)
    .map((stroke) => {
      const parts = [
        ...(stroke.primary === true ? ["Control"] : []),
        ...(stroke.alt === true ? ["Alt"] : []),
        ...(stroke.shift === true ? ["Shift"] : []),
        ariaKeyLabel(stroke.key),
      ];
      return parts.join("+");
    })
    .join(" ");
}

export function findShortcutConflict(
  commandId: CommandId,
  shortcut: CommandShortcut,
  overrides: ShortcutOverrides,
): CommandId | null {
  for (const command of EDITABLE_COMMANDS) {
    if (command.id === commandId) {
      continue;
    }
    const candidate = shortcutForCommand(command.id, overrides);
    if (candidate !== undefined && shortcutsConflict(shortcut, candidate)) {
      return command.id;
    }
  }
  return null;
}

export function changeShortcut(
  overrides: ShortcutOverrides,
  commandId: CommandId,
  shortcut: CommandShortcut | null,
  replaceConflict = false,
): ShortcutChangeResult {
  if (!EDITABLE_COMMAND_IDS.has(commandId)) {
    return { conflictId: null, overrides };
  }
  const conflictId =
    shortcut === null
      ? null
      : findShortcutConflict(commandId, shortcut, overrides);
  if (conflictId !== null && !replaceConflict) {
    return { conflictId, overrides };
  }

  const next: Partial<Record<CommandId, CommandShortcut | null>> = {
    ...overrides,
  };
  if (conflictId !== null) {
    setNormalizedOverride(next, conflictId, null);
  }
  setNormalizedOverride(next, commandId, shortcut);
  return {
    conflictId,
    overrides: normalizeOverrides(next),
  };
}

export function restoreDefaultShortcut(
  overrides: ShortcutOverrides,
  commandId: CommandId,
  replaceConflict = false,
): ShortcutChangeResult {
  const defaultShortcut = COMMANDS.find(
    (command) => command.id === commandId,
  )?.shortcut;
  return changeShortcut(
    overrides,
    commandId,
    defaultShortcut ?? null,
    replaceConflict,
  );
}

export function shortcutDiffersFromDefault(
  commandId: CommandId,
  overrides: ShortcutOverrides,
): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, commandId);
}

export function commandTitle(commandId: CommandId): string {
  return commandById(commandId).title;
}

function parseStoredShortcut(value: unknown): CommandShortcut | null {
  if (!isRecord(value) || !Array.isArray(value.strokes)) {
    return null;
  }
  const strokes = value.strokes.flatMap((stroke) => {
    const parsed = parseStoredStroke(stroke);
    return parsed === null ? [] : [parsed];
  });
  if (strokes.length !== value.strokes.length) {
    return null;
  }
  return createShortcut(strokes);
}

function parseStoredStroke(value: unknown): CommandShortcutStroke | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = normalizeShortcutKey(value.key);
  if (key === null) {
    return null;
  }
  const stroke: CommandShortcutStroke = {
    key,
    ...(value.primary === true ? { primary: true } : {}),
    ...(value.alt === true ? { alt: true } : {}),
    ...(value.shift === true ? { shift: true } : {}),
  };
  return isSafeShortcutStroke(stroke) ? stroke : null;
}

function storedStroke(stroke: CommandShortcutStroke): {
  readonly key: string;
  readonly primary: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
} {
  return {
    key: normalizeShortcutKey(stroke.key) ?? stroke.key,
    primary: stroke.primary === true,
    alt: stroke.alt === true,
    shift: stroke.shift === true,
  };
}

function normalizeOverrides(
  overrides: ShortcutOverrides,
): ShortcutOverrides {
  const normalized: Partial<Record<CommandId, CommandShortcut | null>> = {};
  for (const command of EDITABLE_COMMANDS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, command.id)) {
      continue;
    }
    const value = overrides[command.id];
    if (value === null || value === undefined) {
      setNormalizedOverride(normalized, command.id, null);
      continue;
    }
    const shortcut = createShortcut(shortcutStrokes(value));
    if (shortcut !== null) {
      setNormalizedOverride(normalized, command.id, shortcut);
    }
  }
  return normalized;
}

function setNormalizedOverride(
  target: Partial<Record<CommandId, CommandShortcut | null>>,
  commandId: CommandId,
  shortcut: CommandShortcut | null,
): void {
  const defaultShortcut = COMMANDS.find(
    (command) => command.id === commandId,
  )?.shortcut;
  if (
    (shortcut === null && defaultShortcut === undefined) ||
    (shortcut !== null &&
      defaultShortcut !== undefined &&
      shortcutSignature(shortcut) === shortcutSignature(defaultShortcut))
  ) {
    delete target[commandId];
    return;
  }
  target[commandId] = shortcut;
}

function effectiveShortcutsConflict(overrides: ShortcutOverrides): boolean {
  const assigned: CommandShortcut[] = [];
  for (const command of EDITABLE_COMMANDS) {
    const shortcut = shortcutForCommand(command.id, overrides);
    if (shortcut === undefined) {
      continue;
    }
    if (assigned.some((candidate) => shortcutsConflict(shortcut, candidate))) {
      return true;
    }
    assigned.push(shortcut);
  }
  return false;
}

function shortcutsConflict(
  left: CommandShortcut,
  right: CommandShortcut,
): boolean {
  const leftStrokes = shortcutStrokes(left);
  const rightStrokes = shortcutStrokes(right);
  const sharedLength = Math.min(leftStrokes.length, rightStrokes.length);
  return (
    leftStrokes
      .slice(0, sharedLength)
      .every(
        (stroke, index) =>
          strokeSignature(stroke) ===
          strokeSignature(rightStrokes[index] as CommandShortcutStroke),
      )
  );
}

function shortcutSignature(shortcut: CommandShortcut): string {
  return shortcutStrokes(shortcut).map(strokeSignature).join(" ");
}

function strokeSignature(stroke: CommandShortcutStroke): string {
  return [
    stroke.primary === true ? "p" : "-",
    stroke.alt === true ? "a" : "-",
    stroke.shift === true ? "s" : "-",
    normalizeShortcutKey(stroke.key) ?? stroke.key,
  ].join(":");
}

function shortcutStrokes(
  shortcut: CommandShortcut,
): readonly CommandShortcutStroke[] {
  return [
    {
      key: shortcut.key,
      ...(shortcut.primary === true ? { primary: true } : {}),
      ...(shortcut.alt === true ? { alt: true } : {}),
      ...(shortcut.shift === true ? { shift: true } : {}),
    },
    ...(shortcut.second === undefined ? [] : [shortcut.second]),
  ];
}

function normalizeStroke(
  stroke: CommandShortcutStroke,
): CommandShortcutStroke {
  return {
    key: normalizeShortcutKey(stroke.key) ?? stroke.key,
    ...(stroke.primary === true ? { primary: true } : {}),
    ...(stroke.alt === true ? { alt: true } : {}),
    ...(stroke.shift === true ? { shift: true } : {}),
  };
}

function normalizeShortcutKey(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SHORTCUT_KEY_LENGTH ||
    CONTROL_CHARACTER.test(value)
  ) {
    return null;
  }
  if (value === " ") {
    return "space";
  }
  const normalized = value.toLocaleLowerCase("en-US");
  return normalized === "spacebar" ? "space" : normalized;
}

function isSafeShortcutStroke(stroke: CommandShortcutStroke): boolean {
  const key = normalizeShortcutKey(stroke.key);
  if (key === null || MODIFIER_KEYS.has(key)) {
    return false;
  }
  const hasPrimary = stroke.primary === true;
  const functionKey = /^f(?:[1-9]|1[0-2])$/u.test(key);
  return hasPrimary || functionKey;
}

function formatShortcutStroke(stroke: CommandShortcutStroke): string {
  return [
    ...(stroke.primary === true ? ["Ctrl"] : []),
    ...(stroke.alt === true ? ["Alt"] : []),
    ...(stroke.shift === true ? ["Shift"] : []),
    displayKeyLabel(stroke.key),
  ].join("+");
}

function displayKeyLabel(key: string): string {
  const normalized = normalizeShortcutKey(key) ?? key;
  const named: Readonly<Record<string, string>> = {
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    backspace: "Backspace",
    delete: "Delete",
    end: "End",
    enter: "Enter",
    home: "Home",
    pagedown: "PageDown",
    pageup: "PageUp",
    space: "Space",
    tab: "Tab",
  };
  return (
    named[normalized] ??
    (/^f(?:[1-9]|1[0-2])$/u.test(normalized)
      ? normalized.toLocaleUpperCase("en-US")
      : normalized.length === 1
        ? normalized.toLocaleUpperCase("en-US")
        : normalized)
  );
}

function ariaKeyLabel(key: string): string {
  const normalized = normalizeShortcutKey(key) ?? key;
  const named: Readonly<Record<string, string>> = {
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    arrowup: "ArrowUp",
    space: "Space",
  };
  return normalized.length === 1
    ? normalized.toLocaleUpperCase("en-US")
    : (named[normalized] ?? displayKeyLabel(normalized));
}

function isCommandId(value: unknown): value is CommandId {
  return (
    typeof value === "string" &&
    EDITABLE_COMMAND_IDS.has(value as CommandId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
