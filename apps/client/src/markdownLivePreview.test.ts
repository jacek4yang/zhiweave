import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { zhiweaveMarkdownExtensions } from "./markdownLezerExtensions";
import {
  collectLivePreviewTokens,
  type LivePreviewToken,
} from "./markdownLivePreview";

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
          token.className === "cm-live-wiki-link",
      ),
    ).toBe(true);
    expect(
      tokens.some(
        (token) =>
          token.kind === "mark" &&
          token.className === "cm-live-wiki-embed",
      ),
    ).toBe(true);
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
});
