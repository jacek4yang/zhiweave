import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  parseAppearancePreferences,
  serializeAppearancePreferences,
} from "./appearanceModel";

describe("appearance preferences", () => {
  it("uses the documented dark compact defaults", () => {
    expect(parseAppearancePreferences(null)).toEqual(
      DEFAULT_APPEARANCE_PREFERENCES,
    );
  });

  it("round-trips a versioned local-only appearance record", () => {
    const preferences = {
      theme: "high-contrast",
      density: "terminal",
    } as const;

    expect(
      parseAppearancePreferences(
        serializeAppearancePreferences(preferences),
      ),
    ).toEqual(preferences);
  });

  it("fails closed for malformed and future records", () => {
    expect(parseAppearancePreferences("{")).toEqual(
      DEFAULT_APPEARANCE_PREFERENCES,
    );
    expect(
      parseAppearancePreferences(
        JSON.stringify({
          schemaVersion: 2,
          theme: "light",
          density: "comfortable",
        }),
      ),
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it("normalizes invalid fields and serializes no workspace data", () => {
    const parsed = parseAppearancePreferences(
      JSON.stringify({
        schemaVersion: 1,
        theme: "solarized",
        density: "spacious",
        content: "must not survive",
        root: "C:/private",
      }),
    );
    const serialized = serializeAppearancePreferences(parsed);

    expect(parsed).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(Object.keys(JSON.parse(serialized) as object).sort()).toEqual([
      "density",
      "schemaVersion",
      "theme",
    ]);
    expect(serialized).not.toMatch(/content|root|path|markdown|revision/i);
  });
});
