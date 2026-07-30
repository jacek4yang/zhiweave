export type AppearanceTheme = "dark" | "light" | "high-contrast";
export type AppearanceDensity = "comfortable" | "compact" | "terminal";

export interface AppearancePreferences {
  readonly theme: AppearanceTheme;
  readonly density: AppearanceDensity;
}

export interface AppearanceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
}

export const APPEARANCE_PREFERENCES_KEY = "zhiweave.appearance.v1";

const APPEARANCE_SCHEMA_VERSION = 1;

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  theme: "dark",
  density: "compact",
};

export const THEME_OPTIONS: readonly AppearanceOption<AppearanceTheme>[] = [
  {
    value: "dark",
    label: "月夜深色",
    description: "柔和冷色表面，适合长时间编辑。",
  },
  {
    value: "light",
    label: "暖纸浅色",
    description: "低眩光暖白画布，保持语法层次。",
  },
  {
    value: "high-contrast",
    label: "高对比",
    description: "强化文字、边界与焦点，不依赖透明度。",
  },
];

export const DENSITY_OPTIONS: readonly AppearanceOption<AppearanceDensity>[] = [
  {
    value: "comfortable",
    label: "舒适",
    description: "更宽松的控件与正文，适合沉浸阅读。",
  },
  {
    value: "compact",
    label: "紧凑",
    description: "默认专业工作台密度，兼顾信息量与可读性。",
  },
  {
    value: "terminal",
    label: "终端",
    description: "更小行高与间距，为键盘工作流保留空间。",
  },
];

export function parseAppearancePreferences(
  stored: string | null,
): AppearancePreferences {
  if (stored === null) {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== APPEARANCE_SCHEMA_VERSION
    ) {
      return DEFAULT_APPEARANCE_PREFERENCES;
    }
    return {
      theme: safeTheme(parsed.theme),
      density: safeDensity(parsed.density),
    };
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

export function serializeAppearancePreferences(
  preferences: AppearancePreferences,
): string {
  return JSON.stringify({
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    theme: safeTheme(preferences.theme),
    density: safeDensity(preferences.density),
  });
}

export function appearanceThemeLabel(theme: AppearanceTheme): string {
  return (
    THEME_OPTIONS.find((option) => option.value === theme)?.label ??
    "月夜深色"
  );
}

export function appearanceDensityLabel(
  density: AppearanceDensity,
): string {
  return (
    DENSITY_OPTIONS.find((option) => option.value === density)?.label ??
    "紧凑"
  );
}

function safeTheme(value: unknown): AppearanceTheme {
  return value === "light" || value === "high-contrast" ? value : "dark";
}

function safeDensity(value: unknown): AppearanceDensity {
  return value === "comfortable" || value === "terminal"
    ? value
    : "compact";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
