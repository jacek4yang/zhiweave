import { syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import {
  CALLOUT_TITLES,
  MAX_FOOTNOTE_LABEL_LENGTH,
  MAX_FORMULA_LENGTH,
  calloutKindFromName,
} from "./markdownSyntaxContract";

export type LivePreviewToken =
  | {
      readonly kind: "line";
      readonly from: number;
      readonly className: string;
    }
  | {
      readonly kind: "mark";
      readonly from: number;
      readonly to: number;
      readonly className: string;
    }
  | {
      readonly kind: "replace";
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "task";
      readonly from: number;
      readonly to: number;
      readonly checked: boolean;
    }
  | {
      readonly kind: "callout";
      readonly from: number;
      readonly to: number;
      readonly label: string;
    }
  | {
      readonly kind: "code-header";
      readonly from: number;
      readonly to: number;
      readonly info: string;
    }
  | {
      readonly kind: "footnote";
      readonly from: number;
      readonly to: number;
      readonly definition: boolean;
      readonly label: string;
    }
  | {
      readonly kind: "image";
      readonly from: number;
      readonly to: number;
      readonly alt: string;
      readonly target: string;
    }
  | {
      readonly kind: "math";
      readonly from: number;
      readonly to: number;
      readonly display: boolean;
      readonly source: string;
    };

interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

const setComposition = StateEffect.define<boolean>();
const compositionState = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setComposition)) {
        return effect.value;
      }
    }
    return value;
  },
});

export function markdownLivePreview(): Extension {
  return [
    compositionState,
    livePreviewPlugin,
    EditorView.domEventHandlers({
      compositionstart(_event, view) {
        view.dispatch({ effects: setComposition.of(true) });
        return false;
      },
      compositionend(_event, view) {
        view.dispatch({ effects: setComposition.of(false) });
        return false;
      },
    }),
  ];
}

export function collectLivePreviewTokens(
  state: EditorState,
  visibleRanges: readonly VisibleRange[],
  selections: readonly SelectionRange[] = state.selection.ranges,
  composing = false,
): readonly LivePreviewToken[] {
  if (composing) {
    return [];
  }

  const tokens: LivePreviewToken[] = [];
  const visitedLines = new Set<number>();
  const tree = syntaxTree(state);

  for (const visible of visibleRanges) {
    const from = state.doc.lineAt(
      Math.max(0, Math.min(visible.from, state.doc.length)),
    ).from;
    const to = state.doc.lineAt(
      Math.max(0, Math.min(visible.to, state.doc.length)),
    ).to;

    tree.iterate({
      from,
      to,
      enter(reference) {
        const node = reference.node;
        const name = node.name;
        if (name === "DirectiveBlock") {
          return false;
        }
        if (name === "FencedCode") {
          collectFencedCodeTokens(
            state,
            node,
            { from, to },
            selections,
            tokens,
          );
          return false;
        }

        if (
          (name === "InlineMath" || name === "MathBlock") &&
          !isRevealed(node, selections)
        ) {
          collectMathToken(state, node, tokens);
          return false;
        }

        if (
          name === "FootnoteReference" &&
          !isRevealed(node, selections)
        ) {
          const label = directChildren(node, "FootnoteLabel")[0];
          if (label !== undefined) {
            tokens.push({
              definition: false,
              from: node.from,
              kind: "footnote",
              label: state.doc.sliceString(label.from, label.to),
              to: node.to,
            });
          }
          return false;
        }

        if (isHeading(name)) {
          const line = state.doc.lineAt(node.from);
          tokens.push({
            className: `cm-live-heading cm-live-heading-${headingDepth(name)}`,
            from: line.from,
            kind: "line",
          });
          if (!isRevealed(node, selections)) {
            for (const child of directChildren(node, "HeaderMark")) {
              tokens.push(replaceToken(child));
            }
          }
          return;
        }

        if (
          (name === "StrongEmphasis" ||
            name === "Emphasis" ||
            name === "Strikethrough" ||
            name === "InlineCode") &&
          !isRevealed(node, selections)
        ) {
          const markerName =
            name === "Strikethrough"
              ? "StrikethroughMark"
              : name === "InlineCode"
                ? "CodeMark"
                : "EmphasisMark";
          for (const child of directChildren(node, markerName)) {
            tokens.push(replaceToken(child));
          }
          tokens.push({
            className: `cm-live-${name.toLocaleLowerCase("en-US")}`,
            from: node.from,
            kind: "mark",
            to: node.to,
          });
          return false;
        }

        if (name === "Image" && !isRevealed(node, selections)) {
          collectImageToken(state, node, tokens);
          return false;
        }

        if (
          (name === "Link" ||
            name === "WikiLink" ||
            name === "WikiEmbed") &&
          !isRevealed(node, selections)
        ) {
          collectLinkTokens(node, tokens);
          return false;
        }

        if (name === "Task" && !isRevealed(node, selections)) {
          const marker = directChildren(node, "TaskMarker")[0];
          if (marker !== undefined) {
            tokens.push({
              checked: /\[[xX]\]/.test(
                state.doc.sliceString(marker.from, marker.to),
              ),
              from: marker.from,
              kind: "task",
              to: marker.to,
            });
          }
        }
      },
    });

    for (
      let lineNumber = state.doc.lineAt(from).number;
      lineNumber <= state.doc.lineAt(to).number;
      lineNumber += 1
    ) {
      if (visitedLines.has(lineNumber)) {
        continue;
      }
      visitedLines.add(lineNumber);
      const line = state.doc.line(lineNumber);
      const footnote = footnoteDefinitionPattern.exec(line.text);
      if (
        footnote !== null &&
        !selectionIntersects(line.from, line.to, selections)
      ) {
        tokens.push({
          definition: true,
          from: line.from,
          kind: "footnote",
          label: footnote[2] ?? "",
          to: line.from + footnote[0].length,
        });
        tokens.push({
          className: "cm-live-footnote-definition",
          from: line.from,
          kind: "line",
        });
        continue;
      }
      const match = /^(\s*>\s*)\[!([A-Za-z]+)\](?:[+-])?/.exec(line.text);
      if (match === null || selectionIntersects(line.from, line.to, selections)) {
        continue;
      }
      const kind = calloutKindFromName(match[2] ?? "");
      if (kind === null) {
        continue;
      }
      tokens.push({
        from: line.from,
        kind: "callout",
        label: CALLOUT_TITLES[kind],
        to: line.from + match[0].length,
      });
      tokens.push({
        className: "cm-live-callout",
        from: line.from,
        kind: "line",
      });
    }
  }

  return deduplicateTokens(tokens);
}

class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.startState.field(compositionState) !==
        update.state.field(compositionState)
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (plugin) => plugin.decorations,
});

function buildDecorations(view: EditorView): DecorationSet {
  const tokens = collectLivePreviewTokens(
    view.state,
    view.visibleRanges,
    view.state.selection.ranges,
    view.state.field(compositionState),
  );
  const decorations = tokens.map((token) => {
    if (token.kind === "line") {
      return Decoration.line({ class: token.className }).range(token.from);
    }
    if (token.kind === "mark") {
      return Decoration.mark({ class: token.className }).range(
        token.from,
        token.to,
      );
    }
    if (token.kind === "replace") {
      return Decoration.replace({}).range(token.from, token.to);
    }
    if (token.kind === "task") {
      return Decoration.replace({
        widget: new TaskWidget(token.from, token.checked),
      }).range(token.from, token.to);
    }
    if (token.kind === "callout") {
      return Decoration.replace({
        widget: new CalloutWidget(token.from, token.label),
      }).range(token.from, token.to);
    }
    if (token.kind === "code-header") {
      return Decoration.replace({
        widget: new CodeHeaderWidget(token.from, token.info),
      }).range(token.from, token.to);
    }
    if (token.kind === "footnote") {
      return Decoration.replace({
        widget: new FootnoteWidget(
          token.from,
          token.label,
          token.definition,
        ),
      }).range(token.from, token.to);
    }
    if (token.kind === "image") {
      return Decoration.replace({
        widget: new ImageWidget(
          token.from,
          token.alt,
          token.target,
        ),
      }).range(token.from, token.to);
    }
    return Decoration.replace({
      block: token.display,
      widget: new MathWidget(
        token.from,
        token.source,
        token.display,
      ),
    }).range(token.from, token.to);
  });
  return Decoration.set(decorations, true);
}

class TaskWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly checked: boolean,
  ) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return other.from === this.from && other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.className = "cm-live-task";
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute(
      "aria-label",
      this.checked ? "标记为未完成" : "标记为已完成",
    );
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: this.checked ? " " : "x",
        },
      });
      view.focus();
    });
    return input;
  }
}

class CalloutWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly label: string,
  ) {
    super();
  }

  eq(other: CalloutWidget): boolean {
    return other.from === this.from && other.label === this.label;
  }

  toDOM(view: EditorView): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "cm-live-callout-badge";
    badge.textContent = this.label;
    badge.setAttribute("aria-hidden", "true");
    makeSourceRevealable(badge, view, this.from);
    return badge;
  }
}

class CodeHeaderWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly info: string,
  ) {
    super();
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.from === this.from && other.info === this.info;
  }

  toDOM(view: EditorView): HTMLElement {
    const header = document.createElement("span");
    header.className = "cm-live-code-header";
    header.textContent = this.info.length > 0 ? this.info : "纯文本";
    header.title = "点击查看代码围栏源码";
    makeSourceRevealable(header, view, this.from);
    return header;
  }
}

class FootnoteWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly label: string,
    readonly definition: boolean,
  ) {
    super();
  }

  eq(other: FootnoteWidget): boolean {
    return (
      other.from === this.from &&
      other.label === this.label &&
      other.definition === this.definition
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.definition ? "span" : "sup");
    element.className = this.definition
      ? "cm-live-footnote-definition-label"
      : "cm-live-footnote-reference";
    element.textContent = this.definition ? `注 ${this.label}` : this.label;
    element.title = "点击查看脚注源码";
    makeSourceRevealable(element, view, this.from);
    return element;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly alt: string,
    readonly target: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.from === this.from &&
      other.alt === this.alt &&
      other.target === this.target
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-live-image-placeholder";
    const name = this.alt.trim() || targetName(this.target) || "未命名图片";
    element.textContent = `▧ 图像 · ${name}`;
    element.title =
      this.target.length > 0
        ? `${this.target}\n点击查看图片源码`
        : "点击查看图片源码";
    makeSourceRevealable(element, view, this.from);
    return element;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly source: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return (
      other.from === this.from &&
      other.source === this.source &&
      other.display === this.display
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.display ? "div" : "span");
    element.className = this.display
      ? "cm-live-math-block"
      : "cm-live-math-inline";
    element.textContent = this.source;
    element.setAttribute(
      "aria-label",
      `${this.display ? "公式" : "行内公式"}：${this.source}`,
    );
    element.title = "点击查看 LaTeX 源码";
    makeSourceRevealable(element, view, this.from);
    void import("./mathRenderer")
      .then(({ renderMathInto }) => {
        if (element.isConnected) {
          renderMathInto(element, this.source, this.display);
          view.requestMeasure();
        }
      })
      .catch(() => {
        element.dataset.mathState = "unavailable";
      });
    return element;
  }
}

function collectLinkTokens(
  node: SyntaxNode,
  tokens: LivePreviewToken[],
): void {
  const children = directChildren(node);
  if (node.name === "WikiLink" || node.name === "WikiEmbed") {
    const alias = children.find((child) => child.name === "WikiAlias");
    for (const child of children) {
      if (
        child.name === "WikiMark" ||
        (child.name === "WikiTarget" && alias !== undefined)
      ) {
        tokens.push(replaceToken(child));
      }
    }
    const visible =
      alias ?? children.find((child) => child.name === "WikiTarget");
    if (visible !== undefined) {
      tokens.push({
        className:
          node.name === "WikiEmbed" ? "cm-live-wiki-embed" : "cm-live-wiki-link",
        from: visible.from,
        kind: "mark",
        to: visible.to,
      });
    }
    return;
  }

  for (const child of children) {
    if (
      child.name === "LinkMark" ||
      child.name === "LinkLabel" ||
      child.name === "URL"
    ) {
      tokens.push(replaceToken(child));
    }
  }
  tokens.push({
    className: node.name === "Image" ? "cm-live-image" : "cm-live-link",
    from: node.from,
    kind: "mark",
    to: node.to,
  });
}

function collectImageToken(
  state: EditorState,
  node: SyntaxNode,
  tokens: LivePreviewToken[],
): void {
  const marks = directChildren(node, "LinkMark");
  const altFrom = marks[0]?.to;
  const altTo = marks[1]?.from;
  if (altFrom === undefined || altTo === undefined || altTo < altFrom) {
    return;
  }
  const target =
    directChildren(node, "URL")[0] ??
    directChildren(node, "LinkLabel")[0];
  tokens.push({
    alt: state.doc.sliceString(altFrom, altTo),
    from: node.from,
    kind: "image",
    target:
      target === undefined
        ? ""
        : state.doc.sliceString(target.from, target.to),
    to: node.to,
  });
}

function collectMathToken(
  state: EditorState,
  node: SyntaxNode,
  tokens: LivePreviewToken[],
): void {
  const marks = directChildren(node, "MathMark");
  const content = directChildren(node, "MathContent")[0];
  if (marks.length !== 2 || content === undefined) {
    return;
  }
  if (content.to - content.from > MAX_FORMULA_LENGTH) {
    return;
  }
  const source = state.doc.sliceString(content.from, content.to).trim();
  if (source.length === 0) {
    return;
  }
  tokens.push({
    display:
      node.name === "MathBlock" || state.doc.sliceString(
        marks[0]?.from ?? node.from,
        marks[0]?.to ?? node.from,
      ).length === 2,
    from: node.from,
    kind: "math",
    source,
    to: node.to,
  });
}

function collectFencedCodeTokens(
  state: EditorState,
  node: SyntaxNode,
  visible: VisibleRange,
  selections: readonly SelectionRange[],
  tokens: LivePreviewToken[],
): void {
  const marks = directChildren(node, "CodeMark");
  const info = directChildren(node, "CodeInfo")[0];
  const firstLine = state.doc.lineAt(node.from);
  const lastLine = state.doc.lineAt(Math.max(node.from, node.to));
  const visibleFrom = Math.max(firstLine.from, visible.from);
  const visibleTo = Math.min(lastLine.to, visible.to);

  if (visibleFrom <= visibleTo) {
    const firstVisibleLine = state.doc.lineAt(visibleFrom).number;
    const lastVisibleLine = state.doc.lineAt(visibleTo).number;
    for (
      let lineNumber = firstVisibleLine;
      lineNumber <= lastVisibleLine;
      lineNumber += 1
    ) {
      const line = state.doc.line(lineNumber);
      const classes = ["cm-live-code-line"];
      if (line.number === firstLine.number) {
        classes.push("cm-live-code-first");
      }
      if (line.number === lastLine.number) {
        classes.push("cm-live-code-last");
      }
      tokens.push({
        className: classes.join(" "),
        from: line.from,
        kind: "line",
      });
    }
  }

  if (isRevealed(node, selections) || marks.length !== 2) {
    return;
  }
  if (firstLine.to >= visible.from && firstLine.from <= visible.to) {
    tokens.push({
      from: node.from,
      info:
        info === undefined
          ? ""
          : state.doc.sliceString(info.from, info.to).trim().slice(0, 160),
      kind: "code-header",
      to: firstLine.to,
    });
  }
  const closing = marks[1];
  if (
    closing !== undefined &&
    closing.to >= visible.from &&
    closing.from <= visible.to
  ) {
    tokens.push(replaceToken(closing));
  }
}

function directChildren(
  node: SyntaxNode,
  name?: string,
): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (name === undefined || child.name === name) {
      children.push(child);
    }
  }
  return children;
}

function isHeading(name: string): boolean {
  return /^(?:ATX|Setext)Heading[1-6]$/.test(name);
}

function headingDepth(name: string): number {
  return Number(name.at(-1) ?? "1");
}

function isRevealed(
  node: SyntaxNode,
  selections: readonly SelectionRange[],
): boolean {
  return selectionIntersects(node.from, node.to, selections);
}

function selectionIntersects(
  from: number,
  to: number,
  selections: readonly SelectionRange[],
): boolean {
  return selections.some((selection) => {
    if (selection.empty) {
      return selection.head >= from && selection.head <= to;
    }
    return selection.from < to && selection.to > from;
  });
}

function replaceToken(node: SyntaxNode): LivePreviewToken {
  return { from: node.from, kind: "replace", to: node.to };
}

function deduplicateTokens(
  tokens: readonly LivePreviewToken[],
): readonly LivePreviewToken[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = `${token.kind}:${token.from}:${"to" in token ? token.to : ""}:${
      "className" in token ? token.className : ""
    }`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function makeSourceRevealable(
  element: HTMLElement,
  view: EditorView,
  from: number,
): void {
  element.addEventListener("mousedown", (event) => {
    event.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  });
}

function targetName(target: string): string {
  const normalized = target.replaceAll("\\", "/").replace(/[\]\s]+$/u, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

const footnoteDefinitionPattern = new RegExp(
  `^(\\s*)\\[\\^([^\\]\\r\\n]{1,${MAX_FOOTNOTE_LABEL_LENGTH}})\\]:\\s*`,
  "u",
);
