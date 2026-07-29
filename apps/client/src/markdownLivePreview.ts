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

        if (
          (name === "Link" ||
            name === "Image" ||
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
    return Decoration.replace({
      widget: new CalloutWidget(token.label),
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
  constructor(readonly label: string) {
    super();
  }

  eq(other: CalloutWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "cm-live-callout-badge";
    badge.textContent = this.label;
    badge.setAttribute("aria-hidden", "true");
    return badge;
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
