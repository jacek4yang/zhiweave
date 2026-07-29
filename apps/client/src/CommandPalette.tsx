import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  commandsForPalette,
  type CommandContext,
  type CommandId,
  type ResolvedCommand,
} from "./commandRegistry";

interface CommandPaletteProps {
  readonly context: CommandContext;
  readonly onClose: () => void;
  readonly onRun: (id: CommandId) => void;
}

export function CommandPalette({
  context,
  onClose,
  onRun,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<CommandId | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const commands = useMemo(
    () => commandsForPalette(context, query),
    [context, query],
  );
  const enabledCommands = useMemo(
    () => commands.filter((command) => command.enabled),
    [commands],
  );

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected === true) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (!enabledCommands.some((command) => command.id === activeId)) {
      setActiveId(enabledCommands[0]?.id ?? null);
    }
  }, [activeId, enabledCommands]);

  function moveSelection(direction: 1 | -1) {
    if (enabledCommands.length === 0) {
      setActiveId(null);
      return;
    }
    const currentIndex = enabledCommands.findIndex(
      (command) => command.id === activeId,
    );
    const nextIndex =
      (Math.max(currentIndex, 0) + direction + enabledCommands.length) %
      enabledCommands.length;
    const next = enabledCommands[nextIndex];
    if (next !== undefined) {
      setActiveId(next.id);
      document
        .getElementById(optionId(next))
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveId(enabledCommands[0]?.id ?? null);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveId(enabledCommands.at(-1)?.id ?? null);
      return;
    }
    if (event.key === "Enter" && activeId !== null) {
      event.preventDefault();
      onRun(activeId);
      return;
    }
    if (event.key === "Tab") {
      trapFocus(event);
    }
  }

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="command-palette"
        onKeyDown={handleKeyboard}
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="sr-only" id="command-palette-title">
          命令面板
        </h2>
        <label className="command-palette-search">
          <span aria-hidden="true">&gt;</span>
          <input
            aria-activedescendant={
              activeId === null ? undefined : optionId({ id: activeId })
            }
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            aria-expanded="true"
            aria-label="搜索知织命令"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="输入命令名称，例如“版本”“日记”“分栏”"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            value={query}
          />
          <kbd>Esc</kbd>
        </label>
        <div
          aria-label={`${commands.length} 个可见命令`}
          className="command-palette-results"
          id="command-palette-results"
          role="listbox"
        >
          {commands.length === 0 ? (
            <p className="command-palette-empty">
              没有匹配命令。可以尝试“节点”“学习”或“版本”。
            </p>
          ) : (
            commands.map((command) => (
              <button
                aria-disabled={!command.enabled}
                aria-selected={command.id === activeId}
                className={command.id === activeId ? "is-active" : undefined}
                disabled={!command.enabled}
                id={optionId(command)}
                key={command.id}
                onClick={() => onRun(command.id)}
                onMouseMove={() => {
                  if (command.enabled) {
                    setActiveId(command.id);
                  }
                }}
                role="option"
                type="button"
              >
                <span>
                  <strong>{command.title}</strong>
                  <small>{command.category}</small>
                </span>
                {command.shortcut !== undefined && (
                  <kbd>{command.shortcut.label}</kbd>
                )}
              </button>
            ))
          )}
        </div>
        <footer>
          <span>
            <kbd>↑↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 执行
          </span>
          <span>不可用命令会明确禁用</span>
        </footer>
      </section>
    </div>
  );
}

function optionId(command: Pick<ResolvedCommand, "id">): string {
  return `command-option-${command.id.replaceAll(".", "-")}`;
}
