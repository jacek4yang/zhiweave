import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Keyboard,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  commandById,
  type CommandId,
  type CommandShortcut,
  type CommandShortcutStroke,
  type ShortcutOverrides,
} from "./commandRegistry";
import {
  changeShortcut,
  commandTitle,
  createShortcut,
  editableShortcutCommands,
  shortcutAriaLabel,
  shortcutDiffersFromDefault,
  shortcutStrokeFromKeyboard,
} from "./shortcutModel";

interface ShortcutEditorProps {
  readonly onChange: (overrides: ShortcutOverrides) => void;
  readonly onClose: () => void;
  readonly overrides: ShortcutOverrides;
}

interface RecordingState {
  readonly commandId: CommandId;
  readonly strokes: readonly CommandShortcutStroke[];
}

interface PendingConflict {
  readonly commandId: CommandId;
  readonly conflictId: CommandId;
  readonly shortcut: CommandShortcut;
}

export function ShortcutEditor({
  onChange,
  onClose,
  overrides,
}: ShortcutEditorProps) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [pendingConflict, setPendingConflict] =
    useState<PendingConflict | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [announcement, setAnnouncement] = useState(
    "选择一个命令，然后录制一段或两段快捷键。",
  );
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const commands = useMemo(
    () => editableShortcutCommands(overrides),
    [overrides],
  );
  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (normalized.length === 0) {
      return commands;
    }
    return commands.filter((command) =>
      [
        command.title,
        command.category,
        command.id,
        command.shortcut?.label ?? "未绑定",
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(normalized),
    );
  }, [commands, query]);
  const customizedCount = Object.keys(overrides).length;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    searchRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected === true) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (recording !== null) {
      recorderRef.current?.focus();
    }
  }, [recording]);

  function beginRecording(commandId: CommandId) {
    setPendingConflict(null);
    setResetArmed(false);
    setRecording({ commandId, strokes: [] });
    setAnnouncement(
      `正在修改“${commandTitle(commandId)}”。请按下包含 Ctrl 的组合键，或 F1 到 F12。`,
    );
  }

  function finishRecording() {
    if (recording === null) {
      return;
    }
    const shortcut = createShortcut(recording.strokes);
    if (shortcut === null) {
      setAnnouncement("还没有可用的按键，请先录制快捷键。");
      return;
    }
    proposeShortcut(recording.commandId, shortcut);
  }

  function proposeShortcut(
    commandId: CommandId,
    shortcut: CommandShortcut,
  ) {
    const result = changeShortcut(overrides, commandId, shortcut);
    if (result.conflictId !== null) {
      setPendingConflict({
        commandId,
        conflictId: result.conflictId,
        shortcut,
      });
      setAnnouncement(
        `${shortcut.label} 已由“${commandTitle(result.conflictId)}”使用，需要确认替换。`,
      );
      return;
    }
    onChange(result.overrides);
    setRecording(null);
    setPendingConflict(null);
    setAnnouncement(
      `已将“${commandTitle(commandId)}”设置为 ${shortcut.label}。`,
    );
  }

  function replaceConflict() {
    if (pendingConflict === null) {
      return;
    }
    const result = changeShortcut(
      overrides,
      pendingConflict.commandId,
      pendingConflict.shortcut,
      true,
    );
    onChange(result.overrides);
    setRecording(null);
    setPendingConflict(null);
    setAnnouncement(
      `已将 ${pendingConflict.shortcut.label} 分配给“${commandTitle(
        pendingConflict.commandId,
      )}”，原命令已解除绑定。`,
    );
  }

  function unbind(commandId: CommandId) {
    onChange(changeShortcut(overrides, commandId, null).overrides);
    setAnnouncement(`已解除“${commandTitle(commandId)}”的快捷键。`);
  }

  function restoreDefault(commandId: CommandId) {
    const defaultShortcut = commandById(commandId).shortcut;
    if (defaultShortcut === undefined) {
      onChange(changeShortcut(overrides, commandId, null).overrides);
      setAnnouncement(`已清除“${commandTitle(commandId)}”的自定义快捷键。`);
      return;
    }
    proposeShortcut(commandId, defaultShortcut);
  }

  function handleRecorderKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Tab") {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setRecording(null);
      setPendingConflict(null);
      setAnnouncement("已取消快捷键录制。");
      return;
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      setRecording((current) =>
        current === null ? null : { ...current, strokes: [] },
      );
      setPendingConflict(null);
      setAnnouncement("已清空本次录制。");
      return;
    }
    if (
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      finishRecording();
      return;
    }
    const stroke = shortcutStrokeFromKeyboard(event.nativeEvent);
    event.preventDefault();
    if (stroke === null) {
      setAnnouncement(
        "为避免覆盖普通输入，请使用含 Ctrl 的组合键，或 F1 到 F12。",
      );
      return;
    }
    if (recording === null) {
      return;
    }
    setPendingConflict(null);
    const strokes =
      recording.strokes.length >= 2
        ? [stroke]
        : [...recording.strokes, stroke];
    const shortcut = createShortcut(strokes);
    setRecording({ ...recording, strokes });
    if (shortcut !== null) {
      setAnnouncement(
        strokes.length === 1
          ? `已录制 ${shortcut.label}。可直接使用，或继续按第二段组合键。`
          : `已录制两段快捷键 ${shortcut.label}。`,
      );
    }
  }

  function handleDialogKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (pendingConflict !== null) {
        setPendingConflict(null);
        setAnnouncement("未替换已有快捷键。");
      } else if (recording !== null) {
        setRecording(null);
        setAnnouncement("已取消快捷键录制。");
      } else if (resetArmed) {
        setResetArmed(false);
      } else {
        onClose();
      }
      return;
    }
    if (event.key === "Tab") {
      trapFocus(event, dialogRef.current);
    }
  }

  const recordedShortcut =
    recording === null ? null : createShortcut(recording.strokes);

  return (
    <div
      className="shortcut-editor-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="shortcut-editor-title"
        aria-modal="true"
        className="shortcut-editor"
        onKeyDown={handleDialogKeyboard}
        ref={dialogRef}
        role="dialog"
      >
        <header className="shortcut-editor-header">
          <div>
            <span className="shortcut-editor-icon" aria-hidden="true">
              <Keyboard />
            </span>
            <span>
              <h2 id="shortcut-editor-title">键盘快捷键</h2>
              <p>
                使用 VS Code 风格的一段或两段组合键；修改仅保存在本机设置中。
              </p>
            </span>
          </div>
          <button
            aria-label="关闭快捷键编辑器"
            className="shortcut-icon-button"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X />
          </button>
        </header>

        <div className="shortcut-editor-tools">
          <label className="shortcut-editor-search">
            <Search aria-hidden="true" />
            <input
              aria-label="搜索快捷键命令"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索命令名称、分类、标识或按键"
              ref={searchRef}
              spellCheck={false}
              value={query}
            />
            <kbd>Esc</kbd>
          </label>
          {resetArmed ? (
            <span className="shortcut-reset-confirm" role="group">
              <span>恢复全部默认设置？</span>
              <button
                className="danger"
                onClick={() => {
                  onChange({});
                  setResetArmed(false);
                  setAnnouncement("已恢复全部默认快捷键。");
                }}
                type="button"
              >
                确认恢复
              </button>
              <button onClick={() => setResetArmed(false)} type="button">
                取消
              </button>
            </span>
          ) : (
            <button
              disabled={customizedCount === 0}
              onClick={() => setResetArmed(true)}
              type="button"
            >
              <RotateCcw />
              恢复全部
            </button>
          )}
        </div>

        {recording !== null && (
          <div
            aria-label={`录制“${commandTitle(recording.commandId)}”的快捷键`}
            className="shortcut-recorder"
            onKeyDown={handleRecorderKeyboard}
            ref={recorderRef}
            role="group"
            tabIndex={0}
          >
            <span>
              <small>正在录制</small>
              <strong>{commandTitle(recording.commandId)}</strong>
            </span>
            <span className="shortcut-recorder-value">
              {recordedShortcut === null ? (
                <em>请按组合键…</em>
              ) : (
                <kbd aria-label={shortcutAriaLabel(recordedShortcut)}>
                  {recordedShortcut.label}
                </kbd>
              )}
            </span>
            <span className="shortcut-recorder-actions">
              <button
                disabled={recordedShortcut === null}
                onClick={finishRecording}
                type="button"
              >
                使用这个快捷键
              </button>
              <button
                onClick={() => {
                  setRecording(null);
                  setPendingConflict(null);
                  setAnnouncement("已取消快捷键录制。");
                }}
                type="button"
              >
                取消
              </button>
            </span>
            <small>
              第一段后可继续按第二段；Enter 确认，Backspace 清空，Esc
              取消。
            </small>
          </div>
        )}

        {pendingConflict !== null && (
          <div className="shortcut-conflict" role="alert">
            <span>
              <strong>{pendingConflict.shortcut.label} 已被占用</strong>
              <small>
                “{commandTitle(pendingConflict.conflictId)}”正在使用该按键。
                替换后，原命令将解除绑定。
              </small>
            </span>
            <button className="danger" onClick={replaceConflict} type="button">
              解除原绑定并替换
            </button>
            <button
              onClick={() => {
                setPendingConflict(null);
                setAnnouncement("未替换已有快捷键，可以继续录制。");
              }}
              type="button"
            >
              返回
            </button>
          </div>
        )}

        <div
          aria-label={`${filteredCommands.length} 个快捷键命令`}
          className="shortcut-list"
          role="list"
        >
          {filteredCommands.length === 0 ? (
            <p className="shortcut-empty">
              没有匹配命令。可以尝试“版本”“预览”或“节点”。
            </p>
          ) : (
            filteredCommands.map((command) => {
              const defaultShortcut = commandById(command.id).shortcut;
              const customized = shortcutDiffersFromDefault(
                command.id,
                overrides,
              );
              return (
                <article
                  className={customized ? "is-customized" : undefined}
                  key={command.id}
                  role="listitem"
                >
                  <span className="shortcut-command-copy">
                    <strong>{command.title}</strong>
                    <small>
                      {command.category} · {command.id}
                    </small>
                  </span>
                  <span className="shortcut-binding">
                    {command.shortcut === undefined ? (
                      <em>未绑定</em>
                    ) : (
                      <kbd aria-label={shortcutAriaLabel(command.shortcut)}>
                        {command.shortcut.label}
                      </kbd>
                    )}
                    {customized && <small>自定义</small>}
                  </span>
                  <span className="shortcut-row-actions">
                    <button
                      aria-label={`更改“${command.title}”的快捷键`}
                      onClick={() => beginRecording(command.id)}
                      type="button"
                    >
                      更改
                    </button>
                    {command.shortcut !== undefined && (
                      <button
                        aria-label={`解除“${command.title}”的快捷键`}
                        onClick={() => unbind(command.id)}
                        title="解除绑定"
                        type="button"
                      >
                        <Trash2 />
                      </button>
                    )}
                    {customized && (
                      <button
                        aria-label={`恢复“${command.title}”的默认快捷键`}
                        onClick={() => restoreDefault(command.id)}
                        title={
                          defaultShortcut === undefined
                            ? "清除自定义快捷键"
                            : `恢复 ${defaultShortcut.label}`
                        }
                        type="button"
                      >
                        <RotateCcw />
                      </button>
                    )}
                  </span>
                </article>
              );
            })
          )}
        </div>

        <footer className="shortcut-editor-footer">
          <span aria-live="polite">{announcement}</span>
          <span>
            {customizedCount === 0
              ? "当前使用全部默认设置"
              : `${customizedCount} 项自定义设置`}
          </span>
        </footer>
      </section>
    </div>
  );
}

function trapFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
) {
  if (container === null) {
    return;
  }
  const focusable = [
    ...container.querySelectorAll<HTMLElement>(
      'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null);
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
