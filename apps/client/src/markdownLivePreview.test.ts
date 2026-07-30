import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { zhiweaveMarkdownExtensions } from "./markdownLezerExtensions";
import {
  advanceCompositionPreviewState,
  collectLivePreviewTokens,
  IME_PREVIEW_SETTLE_DELAY_MS,
  wikiTargetAtPosition,
  type LivePreviewToken,
} from "./markdownLivePreview";
import { MAX_FORMULA_LENGTH } from "./markdownSyntaxContract";

function stateFor(source: string, cursor = 0): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      markdown({
        base: markdownLanguage,
        extensions: zhiweaveMarkdownExtensions,
      }),
    ],
    selection: EditorSelection.cursor(cursor),
  });
}

function allTokens(state: EditorState): readonly LivePreviewToken[] {
  return collectLivePreviewTokens(state, [
    { from: 0, to: state.doc.length },
  ]);
}

function nodeNames(state: EditorState): readonly string[] {
  const names: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

describe("Markdown live preview", () => {
  it("keeps YAML metadata out of heading semantics", () => {
    const state = stateFor("---\ntitle: Example\n---\n# Heading");

    expect(nodeNames(state)).toContain("Frontmatter");
    expect(nodeNames(state)).toContain("FrontmatterContent");
    expect(
      nodeNames(state).filter((name) => name === "SetextHeading2"),
    ).toEqual([]);
  });

  it("recognizes wiki links and embeds without rewriting source", () => {
    const source = "[[UUID|标识符]] 与 ![[diagram.svg]]";
    const state = stateFor(source, source.indexOf("与"));
    const tokens = allTokens(state);

    expect(nodeNames(state)).toEqual(
      expect.arrayContaining(["WikiLink", "WikiAlias", "WikiEmbed"]),
    );
    expect(
      tokens.some(
        (token) =>
          token.kind === "mark" &&
          token.className === "cm-live-wiki-link" &&
          token.wikiTarget === "UUID",
      ),
    ).toBe(true);
    expect(
      tokens.some(
        (token) =>
          token.kind === "wiki-embed" &&
          token.display === "diagram.svg" &&
          token.target === "diagram.svg",
      ),
    ).toBe(true);
    expect(wikiTargetAtPosition(state, source.indexOf("标识符"))).toEqual({
      kind: "link",
      target: "UUID",
    });
    expect(wikiTargetAtPosition(state, source.indexOf("diagram"))).toEqual({
      kind: "embed",
      target: "diagram.svg",
    });
    expect(wikiTargetAtPosition(state, source.indexOf("与"))).toBeNull();
    expect(state.doc.toString()).toBe(source);
  });

  it("hides known markers outside every cursor and reveals the active syntax", () => {
    const source = "# Plan\n\nUse **evidence** and `code`.";
    const passive = stateFor(source, source.length);
    const strongFrom = source.indexOf("**evidence**");
    const active = stateFor(source, strongFrom + 3);

    expect(
      allTokens(passive).filter(
        (token) =>
          token.kind === "replace" &&
          token.from >= strongFrom &&
          token.to <= strongFrom + "**evidence**".length,
      ),
    ).toHaveLength(2);
    expect(
      allTokens(active).filter(
        (token) =>
          token.kind === "replace" &&
          token.from >= strongFrom &&
          token.to <= strongFrom + "**evidence**".length,
      ),
    ).toHaveLength(0);
  });

  it("projects tasks and callouts while preserving the Markdown document", () => {
    const source = "- [x] verified\n\n> [!TIP] compare variants";
    const state = stateFor(source, source.length);
    const tokens = collectLivePreviewTokens(
      state,
      [{ from: 0, to: source.length }],
      [EditorSelection.cursor(0)],
    );

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checked: true, kind: "task" }),
        expect.objectContaining({
          kind: "callout",
          label: "提示",
        }),
      ]),
    );
    expect(state.doc.toString()).toBe(source);
  });

  it("disables structural replacement throughout IME composition", () => {
    const source = "# 中文 **输入**";
    const state = stateFor(source, source.length);

    expect(
      collectLivePreviewTokens(
        state,
        [{ from: 0, to: source.length }],
        state.selection.ranges,
        true,
      ),
    ).toEqual([]);
  });

  it("keeps a newer IME composition closed against stale release timers", () => {
    const initial = { active: false, generation: 0 };
    const first = advanceCompositionPreviewState(initial, {
      kind: "start",
    });
    const second = advanceCompositionPreviewState(first, {
      kind: "start",
    });

    expect(IME_PREVIEW_SETTLE_DELAY_MS).toBeGreaterThanOrEqual(50);
    expect(
      advanceCompositionPreviewState(second, {
        kind: "release",
        generation: first.generation,
      }),
    ).toEqual(second);
    expect(
      advanceCompositionPreviewState(second, {
        kind: "release",
        generation: second.generation,
      }),
    ).toEqual({
      active: false,
      generation: second.generation,
    });
  });

  it("projects math, safe images, footnotes, and closed code fences", () => {
    const source = [
      "Intro",
      "",
      "Euler: $e^{i\\pi}+1=0$.",
      "",
      "$$",
      "\\int_0^1 x^2 dx",
      "$$",
      "",
      "![坐标图](assets/plot.png)",
      "",
      "Claim[^evidence].",
      "",
      "[^evidence]: Reproducible source.",
      "",
      "```ts title=\"demo\"",
      "const value = 42;",
      "```",
    ].join("\n");
    const state = stateFor(source);
    const tokens = allTokens(state);

    expect(nodeNames(state)).toEqual(
      expect.arrayContaining([
        "InlineMath",
        "MathBlock",
        "FootnoteReference",
        "FencedCode",
      ]),
    );
    expect(
      tokens.filter((token) => token.kind === "math"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: false,
          source: "e^{i\\pi}+1=0",
        }),
        expect.objectContaining({
          display: true,
          source: "\\int_0^1 x^2 dx",
        }),
      ]),
    );
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alt: "坐标图",
          kind: "image",
          target: "assets/plot.png",
        }),
        expect.objectContaining({
          definition: false,
          kind: "footnote",
          label: "evidence",
        }),
        expect.objectContaining({
          definition: true,
          kind: "footnote",
          label: "evidence",
        }),
        expect.objectContaining({
          info: 'ts title="demo"',
          kind: "code-header",
        }),
      ]),
    );
    expect(
      tokens.some(
        (token) =>
          token.kind === "line" &&
          token.className.includes("cm-live-code-line"),
      ),
    ).toBe(true);
    for (const token of tokens) {
      if (
        [
          "callout",
          "code-header",
          "footnote",
          "image",
          "math",
          "replace",
          "task",
          "wiki-embed",
        ].includes(token.kind) &&
        "to" in token
      ) {
        expect(source.slice(token.from, token.to)).not.toContain("\n");
      }
    }
    expect(state.doc.toString()).toBe(source);
  });

  it("reveals math and fenced source when any cursor enters the structure", () => {
    const source = "Use **proof** and [[Source]]. Then $x^2$.\n\n```rs\nlet x = 2;\n```";
    const strongFrom = source.indexOf("**proof**");
    const wikiFrom = source.indexOf("[[Source]]");
    const mathFrom = source.indexOf("$x^2$");
    const fenceFrom = source.indexOf("```rs");
    const state = EditorState.create({
      doc: source,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdown({
          base: markdownLanguage,
          extensions: zhiweaveMarkdownExtensions,
        }),
      ],
      selection: EditorSelection.create([
        EditorSelection.cursor(strongFrom + 3),
        EditorSelection.cursor(wikiFrom + 3),
        EditorSelection.cursor(mathFrom + 2),
        EditorSelection.cursor(fenceFrom + 8),
      ]),
    });
    const tokens = allTokens(state);

    expect(
      tokens.some(
        (token) =>
          token.kind === "replace" &&
          token.from >= strongFrom &&
          token.to <= strongFrom + "**proof**".length,
      ),
    ).toBe(false);
    expect(
      tokens.some(
        (token) =>
          "to" in token &&
          token.from >= wikiFrom &&
          token.to <= wikiFrom + "[[Source]]".length,
      ),
    ).toBe(false);
    expect(
      tokens.some(
        (token) =>
          token.kind === "math" && token.from === mathFrom,
      ),
    ).toBe(false);
    expect(
      tokens.some(
        (token) =>
          token.kind === "code-header" && token.from === fenceFrom,
      ),
    ).toBe(false);
  });

  it("leaves truncated and unknown extensions fully visible", () => {
    const source = [
      ":::future-widget",
      "payload: **untouched**",
      ":::",
      "",
      "Unclosed $formula",
      "",
      "```future",
      "still source",
    ].join("\n");
    const state = stateFor(source, source.length);
    const tokens = allTokens(state);
    const unknownTo = source.indexOf("\n\n");
    const fenceFrom = source.indexOf("```future");

    expect(nodeNames(state)).toContain("DirectiveBlock");
    expect(
      tokens.some(
        (token) =>
          "to" in token && token.from < unknownTo && token.to <= unknownTo,
      ),
    ).toBe(false);
    expect(tokens.some((token) => token.kind === "math")).toBe(false);
    expect(
      tokens.some(
        (token) =>
          token.kind === "code-header" && token.from === fenceFrom,
      ),
    ).toBe(false);
    expect(state.doc.toString()).toBe(source);
  });

  it("does not mistake escaped dollars, currency, or oversized math for preview content", () => {
    const oversized = "x".repeat(MAX_FORMULA_LENGTH + 1);
    const source = [
      String.raw`Escaped \$name stays source; prices $20 and $30 stay source.`,
      "",
      "$$",
      oversized,
      "$$",
    ].join("\n");
    const state = stateFor(source, source.length);

    expect(
      allTokens(state).some((token) => token.kind === "math"),
    ).toBe(false);
    expect(state.doc.toString()).toBe(source);
  });
});
