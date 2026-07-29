import type {
  BlockContent,
  Definition,
  DefinitionContent,
  Heading,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type { Position } from "unist";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";

import {
  CALLOUT_TITLES,
  calloutKindFromName,
  MAX_WIKI_TARGET_LENGTH,
  type CalloutKind,
} from "./markdownSyntaxContract";

export {
  MAX_WIKI_TARGET_LENGTH,
  type CalloutKind,
} from "./markdownSyntaxContract";

export interface WikiLinkNode {
  readonly type: "wikiLink";
  readonly target: string;
  readonly display: string;
  readonly position?: Position | undefined;
}

export interface WikiEmbedNode {
  readonly type: "wikiEmbed";
  readonly target: string;
  readonly display: string;
  readonly position?: Position | undefined;
}

export interface CalloutNode {
  readonly type: "callout";
  readonly kind: CalloutKind;
  readonly title: string;
  readonly fold: "collapsed" | "expanded" | null;
  readonly children: Array<BlockContent | DefinitionContent>;
  readonly position?: Position | undefined;
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikiLink: WikiLinkNode;
    wikiEmbed: WikiEmbedNode;
  }

  interface RootContentMap {
    callout: CalloutNode;
  }
}

export interface MarkdownDocument {
  readonly source: string;
  readonly root: Root;
}

export interface MarkdownOutlineItem {
  readonly depth: Heading["depth"];
  readonly text: string;
  readonly offset: number | null;
}

export interface CodeFenceInfo {
  readonly language: string;
  readonly title: string | null;
  readonly highlight: string | null;
  readonly rawMeta: string;
}

export function parseMarkdownDocument(source: string): MarkdownDocument {
  const root = fromMarkdown(source, {
    extensions: [
      gfm(),
      frontmatter("yaml"),
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [
      gfmFromMarkdown(),
      frontmatterFromMarkdown("yaml"),
      mathFromMarkdown(),
    ],
  });

  enhanceWikiSyntax(root);
  enhanceCallouts(root);
  return { root, source };
}

export function firstLevelOneHeading(
  document: MarkdownDocument,
): string | null {
  for (const node of document.root.children) {
    if (node.type !== "heading" || node.depth !== 1) {
      continue;
    }
    const text = phrasingText(node.children).trim().slice(0, 200);
    if (text.length > 0) {
      return text;
    }
  }
  return null;
}

export function outlineFromMarkdown(
  document: MarkdownDocument,
): readonly MarkdownOutlineItem[] {
  const outline: MarkdownOutlineItem[] = [];
  walk(document.root, (node) => {
    if (node.type !== "heading") {
      return;
    }
    const text = phrasingText(node.children).trim();
    if (text.length === 0) {
      return;
    }
    outline.push({
      depth: node.depth,
      offset: node.position?.start.offset ?? null,
      text,
    });
  });
  return outline;
}

export function definitionsFromMarkdown(
  document: MarkdownDocument,
): ReadonlyMap<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const node of document.root.children) {
    if (node.type === "definition") {
      definitions.set(normalizeIdentifier(node.identifier), node);
    }
  }
  return definitions;
}

export function plainTextFromMarkdown(
  document: MarkdownDocument,
  options: { readonly includeFrontmatter?: boolean } = {},
): string {
  const lines: string[] = [];
  const footnotes: string[] = [];

  for (const node of document.root.children) {
    if (node.type === "definition") {
      continue;
    }
    if (node.type === "footnoteDefinition") {
      const text = blockChildrenText(node.children, document.source, 0);
      footnotes.push(`[${node.label ?? node.identifier}] ${text}`.trim());
      continue;
    }
    if (node.type === "yaml" && options.includeFrontmatter !== true) {
      continue;
    }
    const text = blockText(node, document.source, 0);
    if (text.length > 0) {
      lines.push(text);
    }
  }

  if (footnotes.length > 0) {
    lines.push(footnotes.join("\n"));
  }
  return lines.join("\n\n").replaceAll(/\n{3,}/g, "\n\n").trim();
}

export function parseCodeFenceInfo(
  language: string | null | undefined,
  meta: string | null | undefined,
): CodeFenceInfo {
  const normalizedLanguage = (language ?? "")
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9_+#.-]/g, "")
    .slice(0, 48);
  const rawMeta = (meta ?? "").trim().slice(0, 500);
  const titleMatch = /(?:^|\s)title=(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|([^\s]{1,200}))/i
    .exec(rawMeta);
  const highlightMatch = /(?:^|\s)(\{[\d,\s-]{1,200}\})(?:\s|$)/.exec(rawMeta);
  return {
    highlight: highlightMatch?.[1] ?? null,
    language: normalizedLanguage,
    rawMeta,
    title: titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3] ?? null,
  };
}

function enhanceWikiSyntax(root: Root): void {
  transformChildren(root, (child) => {
    if (child.type !== "text") {
      return [child];
    }
    return splitWikiText(child);
  });
}

function splitWikiText(node: Text): PhrasingContent[] {
  const pattern = /(!)?\[\[([^\]\r\n]{1,500})\]\]/g;
  const result: PhrasingContent[] = [];
  let cursor = 0;

  for (const match of node.value.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) {
      result.push({ type: "text", value: node.value.slice(cursor, index) });
    }
    const rawTarget = (match[2] ?? "").trim();
    const separator = rawTarget.indexOf("|");
    const target = (separator < 0 ? rawTarget : rawTarget.slice(0, separator))
      .trim()
      .slice(0, MAX_WIKI_TARGET_LENGTH);
    const alias = (separator < 0 ? "" : rawTarget.slice(separator + 1))
      .trim()
      .slice(0, MAX_WIKI_TARGET_LENGTH);
    if (target.length === 0) {
      result.push({ type: "text", value: match[0] });
    } else if (match[1] === "!") {
      result.push({
        display: alias.length > 0 ? alias : target,
        target,
        type: "wikiEmbed",
      });
    } else {
      result.push({
        display: alias.length > 0 ? alias : target,
        target,
        type: "wikiLink",
      });
    }
    cursor = index + match[0].length;
  }

  if (cursor === 0) {
    return [node];
  }
  if (cursor < node.value.length) {
    result.push({ type: "text", value: node.value.slice(cursor) });
  }
  return result;
}

function enhanceCallouts(root: Root): void {
  root.children = root.children.map((node) => {
    if (node.type !== "blockquote") {
      return node;
    }
    const paragraph = node.children[0];
    if (paragraph?.type !== "paragraph") {
      return node;
    }
    const first = paragraph.children[0];
    if (first?.type !== "text") {
      return node;
    }
    const marker = /^\[!([A-Za-z]+)\]([+-])?[ \t]*([^\r\n]*)(?:\r?\n|$)/.exec(
      first.value,
    );
    if (marker === null) {
      return node;
    }
    const kind = calloutKindFromName(marker[1] ?? "");
    if (kind === null) {
      return node;
    }
    const remainder = first.value.slice(marker[0].length);
    const nextChildren = [...node.children];
    const nextParagraphChildren = [...paragraph.children];
    if (remainder.length > 0) {
      nextParagraphChildren[0] = { type: "text", value: remainder };
    } else {
      nextParagraphChildren.shift();
    }
    if (nextParagraphChildren.length === 0) {
      nextChildren.shift();
    } else {
      nextChildren[0] = { ...paragraph, children: nextParagraphChildren };
    }
    return {
      children: nextChildren,
      fold:
        marker[2] === "-"
          ? "collapsed"
          : marker[2] === "+"
            ? "expanded"
            : null,
      kind,
      position: node.position,
      title: (marker[3] ?? "").trim() || CALLOUT_TITLES[kind],
      type: "callout",
    };
  });
}

function transformChildren(
  node: unknown,
  transform: (child: PhrasingContent) => PhrasingContent[],
): void {
  if (!hasChildren(node)) {
    return;
  }
  const next: unknown[] = [];
  for (const child of node.children) {
    if (isPhrasing(child)) {
      next.push(...transform(child));
    } else {
      next.push(child);
    }
    transformChildren(child, transform);
  }
  node.children = next;
}

function isPhrasing(node: unknown): node is PhrasingContent {
  if (!isNode(node)) {
    return false;
  }
  return ![
    "blockquote",
    "callout",
    "code",
    "definition",
    "footnoteDefinition",
    "heading",
    "html",
    "list",
    "listItem",
    "math",
    "paragraph",
    "root",
    "table",
    "tableCell",
    "tableRow",
    "thematicBreak",
    "toml",
    "yaml",
  ].includes(node.type);
}

function hasChildren(
  node: unknown,
): node is { children: unknown[] } {
  return (
    typeof node === "object" &&
    node !== null &&
    Array.isArray((node as { children?: unknown }).children)
  );
}

function isNode(node: unknown): node is { readonly type: string } {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as { type?: unknown }).type === "string"
  );
}

function walk(node: unknown, visit: (node: RootContent) => void): void {
  if (isNode(node) && node.type !== "root") {
    visit(node as RootContent);
  }
  if (!hasChildren(node)) {
    return;
  }
  for (const child of node.children) {
    walk(child, visit);
  }
}

function phrasingText(children: readonly PhrasingContent[]): string {
  return children.map((node) => inlineText(node)).join("");
}

function inlineText(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "inlineMath":
      return node.value;
    case "break":
      return "\n";
    case "image":
      return node.alt ?? node.url;
    case "imageReference":
      return node.alt ?? node.label ?? node.identifier;
    case "footnoteReference":
      return `[${node.label ?? node.identifier}]`;
    case "wikiLink":
    case "wikiEmbed":
      return node.display;
    default:
      return "children" in node ? phrasingText(node.children) : "";
  }
}

function blockChildrenText(
  children: readonly (BlockContent | DefinitionContent)[],
  source: string,
  depth: number,
): string {
  return children
    .map((child) => blockText(child, source, depth))
    .filter(Boolean)
    .join("\n");
}

function blockText(node: RootContent, source: string, depth: number): string {
  switch (node.type) {
    case "heading":
    case "paragraph":
    case "tableCell":
      return phrasingText(node.children);
    case "blockquote":
      return blockChildrenText(node.children, source, depth)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "callout": {
      const body = blockChildrenText(node.children, source, depth);
      return body.length > 0 ? `${node.title}\n${body}` : node.title;
    }
    case "list":
      return node.children
        .map((item, index) => {
          const marker = node.ordered
            ? `${(node.start ?? 1) + index}.`
            : item.checked === null || item.checked === undefined
              ? "-"
              : item.checked
                ? "- [x]"
                : "- [ ]";
          const content = blockChildrenText(item.children, source, depth + 1);
          return `${"  ".repeat(depth)}${marker} ${content}`;
        })
        .join("\n");
    case "listItem":
      return blockChildrenText(node.children, source, depth + 1);
    case "table":
      return node.children
        .map((row) => row.children.map((cell) => phrasingText(cell.children)).join("\t"))
        .join("\n");
    case "tableRow":
      return node.children.map((cell) => phrasingText(cell.children)).join("\t");
    case "code":
      return node.value;
    case "math":
      return node.value;
    case "html":
    case "yaml":
      return node.value;
    case "thematicBreak":
      return "——";
    default:
      return sourceForNode(node, source);
  }
}

function sourceForNode(node: RootContent, source: string): string {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  return from === undefined || to === undefined ? "" : source.slice(from, to);
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}
