import { tags } from "@lezer/highlight";
import type {
  BlockContext,
  InlineContext,
  Line,
  MarkdownExtension,
} from "@lezer/markdown";

import { MAX_WIKI_TARGET_LENGTH } from "./markdownSyntaxContract";

export const zhiweaveMarkdownExtensions: MarkdownExtension = [
  {
    defineNodes: [
      {
        name: "Frontmatter",
        block: true,
        style: {
          FrontmatterContent: tags.meta,
          FrontmatterMark: tags.contentSeparator,
        },
      },
      "FrontmatterMark",
      "FrontmatterContent",
    ],
    parseBlock: [
      {
        name: "Frontmatter",
        before: "HorizontalRule",
        parse: parseFrontmatter,
      },
    ],
  },
  {
    defineNodes: [
      {
        name: "WikiLink",
        style: {
          WikiAlias: tags.link,
          WikiMark: tags.punctuation,
          WikiTarget: tags.url,
        },
      },
      {
        name: "WikiEmbed",
        style: {
          WikiAlias: tags.link,
          WikiMark: tags.punctuation,
          WikiTarget: tags.url,
        },
      },
      "WikiMark",
      "WikiTarget",
      "WikiAlias",
    ],
    parseInline: [
      {
        name: "WikiLink",
        before: "Link",
        parse: parseWikiSyntax,
      },
    ],
  },
];

function parseFrontmatter(cx: BlockContext, line: Line): boolean {
  if (
    cx.lineStart !== 0 ||
    line.pos !== 0 ||
    line.text.trimEnd() !== "---"
  ) {
    return false;
  }

  const children = [cx.elt("FrontmatterMark", 0, line.text.length)];
  let contentFrom = -1;
  let contentTo = line.text.length;
  let end = line.text.length;

  while (cx.nextLine()) {
    const lineFrom = cx.lineStart;
    const lineTo = lineFrom + line.text.length;
    const isClosing = line.pos === 0 && /^(?:---|\.\.\.)\s*$/.test(line.text);
    if (isClosing) {
      if (contentFrom >= 0 && contentFrom < contentTo) {
        children.push(cx.elt("FrontmatterContent", contentFrom, contentTo));
      }
      children.push(cx.elt("FrontmatterMark", lineFrom, lineTo));
      end = lineTo;
      cx.nextLine();
      cx.addElement(cx.elt("Frontmatter", 0, end, children));
      return true;
    }
    if (contentFrom < 0) {
      contentFrom = lineFrom;
    }
    contentTo = lineTo;
    end = lineTo;
  }

  if (contentFrom >= 0 && contentFrom < contentTo) {
    children.push(cx.elt("FrontmatterContent", contentFrom, contentTo));
  }
  cx.addElement(cx.elt("Frontmatter", 0, end, children));
  return true;
}

function parseWikiSyntax(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  const embedded = next === 33;
  const openFrom = embedded ? pos + 1 : pos;
  if (
    (next !== 91 && !embedded) ||
    cx.char(openFrom) !== 91 ||
    cx.char(openFrom + 1) !== 91
  ) {
    return -1;
  }

  const contentFrom = openFrom + 2;
  const scanTo = Math.min(
    cx.end,
    contentFrom + MAX_WIKI_TARGET_LENGTH + 2,
  );
  let closeFrom = -1;
  for (let cursor = contentFrom; cursor < scanTo - 1; cursor += 1) {
    const character = cx.char(cursor);
    if (character === 10 || character === 13) {
      return -1;
    }
    if (character === 93 && cx.char(cursor + 1) === 93) {
      closeFrom = cursor;
      break;
    }
  }
  if (closeFrom <= contentFrom) {
    return -1;
  }

  const separator = cx.slice(contentFrom, closeFrom).indexOf("|");
  const aliasFrom =
    separator < 0 ? -1 : contentFrom + separator + 1;
  const targetTo = separator < 0 ? closeFrom : aliasFrom - 1;
  if (
    targetTo <= contentFrom ||
    (aliasFrom >= 0 && aliasFrom >= closeFrom)
  ) {
    return -1;
  }

  const children = [
    cx.elt("WikiMark", pos, contentFrom),
    cx.elt("WikiTarget", contentFrom, targetTo),
  ];
  if (aliasFrom >= 0) {
    children.push(cx.elt("WikiMark", targetTo, aliasFrom));
    children.push(cx.elt("WikiAlias", aliasFrom, closeFrom));
  }
  children.push(cx.elt("WikiMark", closeFrom, closeFrom + 2));
  return cx.addElement(
    cx.elt(
      embedded ? "WikiEmbed" : "WikiLink",
      pos,
      closeFrom + 2,
      children,
    ),
  );
}
