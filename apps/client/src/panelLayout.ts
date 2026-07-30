export type ResizablePanel = "explorer" | "inspector";

export interface PanelWidthRange {
  readonly defaultValue: number;
  readonly maximum: number;
  readonly minimum: number;
}

export const EXPLORER_WIDTH: PanelWidthRange = {
  defaultValue: 244,
  minimum: 200,
  maximum: 400,
};

export const INSPECTOR_WIDTH: PanelWidthRange = {
  defaultValue: 270,
  minimum: 220,
  maximum: 420,
};

const KEYBOARD_STEP = 12;
const LARGE_KEYBOARD_STEP = 36;

export function panelWidthRange(panel: ResizablePanel): PanelWidthRange {
  return panel === "explorer" ? EXPLORER_WIDTH : INSPECTOR_WIDTH;
}

export function normalizePanelWidth(
  panel: ResizablePanel,
  value: unknown,
): number {
  const range = panelWidthRange(panel);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return range.defaultValue;
  }
  return Math.min(
    range.maximum,
    Math.max(range.minimum, Math.round(value)),
  );
}

export function panelWidthFromPointerDelta(
  panel: ResizablePanel,
  initialWidth: number,
  deltaX: number,
): number {
  const direction = panel === "explorer" ? 1 : -1;
  return normalizePanelWidth(panel, initialWidth + deltaX * direction);
}

export function panelWidthFromKeyboard(
  panel: ResizablePanel,
  currentWidth: number,
  key: string,
  largeStep = false,
): number | null {
  const range = panelWidthRange(panel);
  if (key === "Home") {
    return range.minimum;
  }
  if (key === "End") {
    return range.maximum;
  }
  if (key === "Enter") {
    return range.defaultValue;
  }
  if (key !== "ArrowLeft" && key !== "ArrowRight") {
    return null;
  }

  const step = largeStep ? LARGE_KEYBOARD_STEP : KEYBOARD_STEP;
  const screenDirection = key === "ArrowRight" ? 1 : -1;
  const panelDirection = panel === "explorer" ? 1 : -1;
  return normalizePanelWidth(
    panel,
    currentWidth + step * screenDirection * panelDirection,
  );
}
