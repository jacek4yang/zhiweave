import { useEffect, useRef, type KeyboardEvent } from "react";
import { Palette, RotateCcw, X } from "lucide-react";

import {
  DENSITY_OPTIONS,
  THEME_OPTIONS,
  type AppearanceDensity,
  type AppearancePreferences,
  type AppearanceTheme,
} from "./appearanceModel";
import type { CommandId } from "./commandRegistry";

interface AppearancePanelProps {
  readonly appearance: AppearancePreferences;
  readonly onClose: () => void;
  readonly onRunCommand: (id: CommandId) => void;
}

const THEME_COMMANDS: Readonly<Record<AppearanceTheme, CommandId>> = {
  dark: "appearance.themeDark",
  light: "appearance.themeLight",
  "high-contrast": "appearance.themeHighContrast",
};

const DENSITY_COMMANDS: Readonly<Record<AppearanceDensity, CommandId>> = {
  comfortable: "appearance.densityComfortable",
  compact: "appearance.densityCompact",
  terminal: "appearance.densityTerminal",
};

export function AppearancePanel({
  appearance,
  onClose,
  onRunCommand,
}: AppearancePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const timer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    function closeFromOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !(
          event.target instanceof Element &&
          event.target.closest("[data-appearance-trigger]") !== null
        ) &&
        !panelRef.current?.contains(event.target)
      ) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [onClose]);

  function handlePanelKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (focusable === undefined || focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <section
      aria-labelledby="appearance-title"
      aria-modal="false"
      className="appearance-panel"
      data-context="appearance"
      onKeyDown={handlePanelKeyboard}
      ref={panelRef}
      role="dialog"
    >
      <header>
        <div>
          <span className="eyebrow">工作台外观</span>
          <h2 id="appearance-title">
            <Palette />
            主题与密度
          </h2>
        </div>
        <button aria-label="关闭外观设置" onClick={onClose} type="button">
          <X />
        </button>
      </header>

      <AppearanceOptionGroup
        current={appearance.theme}
        label="颜色主题"
        onChoose={(value) => onRunCommand(THEME_COMMANDS[value])}
        options={THEME_OPTIONS}
      />
      <AppearanceOptionGroup
        current={appearance.density}
        label="界面密度"
        onChoose={(value) => onRunCommand(DENSITY_COMMANDS[value])}
        options={DENSITY_OPTIONS}
      />

      <footer>
        <button
          className="appearance-reset"
          onClick={() => onRunCommand("appearance.reset")}
          type="button"
        >
          <RotateCcw />
          恢复深色紧凑默认值
        </button>
      </footer>
    </section>
  );
}

interface AppearanceOptionGroupProps<T extends string> {
  readonly current: T;
  readonly label: string;
  readonly onChoose: (value: T) => void;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    readonly description: string;
  }[];
}

function AppearanceOptionGroup<T extends string>({
  current,
  label,
  onChoose,
  options,
}: AppearanceOptionGroupProps<T>) {
  function handleOptionKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) {
      return;
    }
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    const option = options[next];
    if (option === undefined) {
      return;
    }
    onChoose(option.value);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [next]?.focus();
  }

  return (
    <fieldset className="appearance-group">
      <legend>{label}</legend>
      <div aria-label={label} role="radiogroup">
        {options.map((option, index) => (
          <button
            aria-checked={current === option.value}
            className={current === option.value ? "is-selected" : ""}
            data-appearance-option={option.value}
            key={option.value}
            onClick={() => onChoose(option.value)}
            onKeyDown={(event) => handleOptionKeyboard(event, index)}
            role="radio"
            tabIndex={current === option.value ? 0 : -1}
            type="button"
          >
            <i aria-hidden="true" />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
