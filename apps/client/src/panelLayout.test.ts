import { describe, expect, it } from "vitest";

import {
  EXPLORER_WIDTH,
  INSPECTOR_WIDTH,
  normalizePanelWidth,
  panelWidthFromKeyboard,
  panelWidthFromPointerDelta,
} from "./panelLayout";

describe("resizable panel layout", () => {
  it("normalizes invalid and out-of-range persisted widths", () => {
    expect(normalizePanelWidth("explorer", undefined)).toBe(
      EXPLORER_WIDTH.defaultValue,
    );
    expect(normalizePanelWidth("inspector", Number.NaN)).toBe(
      INSPECTOR_WIDTH.defaultValue,
    );
    expect(normalizePanelWidth("explorer", 10)).toBe(
      EXPLORER_WIDTH.minimum,
    );
    expect(normalizePanelWidth("inspector", 999)).toBe(
      INSPECTOR_WIDTH.maximum,
    );
    expect(normalizePanelWidth("explorer", 277.6)).toBe(278);
  });

  it("applies pointer movement from each panel's physical edge", () => {
    expect(panelWidthFromPointerDelta("explorer", 244, 30)).toBe(274);
    expect(panelWidthFromPointerDelta("explorer", 244, -30)).toBe(214);
    expect(panelWidthFromPointerDelta("inspector", 270, 30)).toBe(240);
    expect(panelWidthFromPointerDelta("inspector", 270, -30)).toBe(300);
  });

  it("supports directional, accelerated, boundary, and reset keys", () => {
    expect(panelWidthFromKeyboard("explorer", 244, "ArrowRight")).toBe(
      256,
    );
    expect(panelWidthFromKeyboard("explorer", 244, "ArrowLeft", true)).toBe(
      208,
    );
    expect(panelWidthFromKeyboard("inspector", 270, "ArrowLeft")).toBe(
      282,
    );
    expect(panelWidthFromKeyboard("inspector", 270, "ArrowRight", true)).toBe(
      234,
    );
    expect(panelWidthFromKeyboard("explorer", 244, "Home")).toBe(
      EXPLORER_WIDTH.minimum,
    );
    expect(panelWidthFromKeyboard("inspector", 270, "End")).toBe(
      INSPECTOR_WIDTH.maximum,
    );
    expect(panelWidthFromKeyboard("inspector", 333, "Enter")).toBe(
      INSPECTOR_WIDTH.defaultValue,
    );
    expect(panelWidthFromKeyboard("explorer", 244, "Escape")).toBeNull();
  });
});
