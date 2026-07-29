import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { zhiweaveMarkdownExtensions } from "./markdownLezerExtensions";
import { collectLivePreviewTokens } from "./markdownLivePreview";

function stateFor(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      markdown({
        base: markdownLanguage,
        extensions: zhiweaveMarkdownExtensions,
      }),
    ],
    selection: EditorSelection.cursor(0),
  });
}

describe("Markdown live preview performance boundaries", () => {
  it("opens and projects a narrow viewport in a 2 MiB note within the initial budget", () => {
    const line = "Plain evidence line with no structural replacement.\n";
    const source = `${"# Two MiB note\n\n"}${line.repeat(
      Math.ceil((2 * 1024 * 1024) / line.length),
    )}`;
    const startedAt = performance.now();
    const state = stateFor(source);
    const tokens = collectLivePreviewTokens(state, [{ from: 0, to: 640 }]);
    const elapsed = performance.now() - startedAt;

    expect(source.length).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    expect(tokens.length).toBeLessThan(32);
    expect(state.doc.toString()).toBe(source);
    expect(
      elapsed,
      `2 MiB narrow-viewport projection took ${elapsed.toFixed(1)} ms`,
    ).toBeLessThan(1_500);
  });

  it("decorates only visible lines in a 10,000-line fenced block", () => {
    const source = [
      "```rust",
      ...Array.from(
        { length: 10_000 },
        (_, index) => `let value_${index} = ${index};`,
      ),
      "```",
    ].join("\n");
    const state = stateFor(source);
    const viewportTo = state.doc.line(24).to;
    const tokens = collectLivePreviewTokens(state, [
      { from: 0, to: viewportTo },
    ]);
    const codeLines = tokens.filter(
      (token) =>
        token.kind === "line" &&
        token.className.includes("cm-live-code-line"),
    );

    expect(codeLines.length).toBeLessThanOrEqual(24);
    expect(
      codeLines.every((token) => token.from <= viewportTo),
    ).toBe(true);
    expect(state.doc.toString()).toBe(source);
  });
});
