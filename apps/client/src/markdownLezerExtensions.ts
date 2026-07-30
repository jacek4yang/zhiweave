import { tags } from "@lezer/highlight";
import type {
  BlockContext,
  InlineContext,
  Line,
  MarkdownExtension,
} from "@lezer/markdown";

import {
  MAX_FOOTNOTE_LABEL_LENGTH,
  MAX_FORMULA_LENGTH,
  MAX_WIKI_TARGET_LENGTH,
} from "./markdownSyntaxContract";

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
  {
    defineNodes: [
      {
        name: "MathBlock",
        block: true,
        style: {
          MathContent: tags.string,
          MathMark: tags.punctuation,
        },
      },
      {
        name: "InlineMath",
        style: {
          MathContent: tags.string,
          MathMark: tags.punctuation,
        },
      },
      {
        name: "FootnoteReference",
        style: {
          FootnoteLabel: tags.link,
          FootnoteMark: tags.punctuation,
        },
      },
      {
        name: "DirectiveBlock",
        block: true,
        style: {
          DirectiveMark: tags.contentSeparator,
        },
      },
      "MathMark",
      "MathContent",
      "FootnoteMark",
      "FootnoteLabel",
      "DirectiveMark",
      "DirectiveContent",
    ],
    parseBlock: [
      {
        name: "MathBlock",
        before: "FencedCode",
        parse: parseMathBlock,
      },
      {
        name: "DirectiveBlock",
        before: "FencedCode",
        parse: parseDirectiveBlock,
      },
    ],
    parseInline: [
      {
        name: "InlineMath",
        before: "Escape",
        parse: parseInlineMath,
      },
      {
        name: "FootnoteReference",
        before: "Link",
        parse: parseFootnoteReference,
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

function parseMathBlock(cx: BlockContext, line: Line): boolean {
  if (!isMathFence(line)) {
    return false;
  }

  const from = cx.lineStart + line.pos;
  const children = [cx.elt("MathMark", from, from + 2)];
  let contentFrom = -1;
  let contentTo = from + 2;
  let end = from + 2;

  while (cx.nextLine()) {
    const lineFrom = cx.lineStart;
    const lineTo = lineFrom + line.text.length;
    if (isMathFence(line)) {
      if (contentFrom >= 0 && contentFrom < contentTo) {
        children.push(cx.elt("MathContent", contentFrom, contentTo));
      }
      const markFrom = lineFrom + line.pos;
      children.push(cx.elt("MathMark", markFrom, markFrom + 2));
      end = markFrom + 2;
      cx.nextLine();
      cx.addElement(cx.elt("MathBlock", from, end, children));
      return true;
    }
    if (contentFrom < 0) {
      contentFrom = lineFrom;
    }
    contentTo = lineTo;
    end = lineTo;
  }

  if (contentFrom >= 0 && contentFrom < contentTo) {
    children.push(cx.elt("MathContent", contentFrom, contentTo));
  }
  cx.addElement(cx.elt("MathBlock", from, end, children));
  return true;
}

function isMathFence(line: Line): boolean {
  return (
    line.indent - line.baseIndent < 4 &&
    line.text.slice(line.pos).trimEnd() === "$$"
  );
}

function parseDirectiveBlock(cx: BlockContext, line: Line): boolean {
  if (
    line.indent - line.baseIndent >= 4 ||
    !/^:::[A-Za-z][\w-]*(?:\s.*)?$/u.test(line.text.slice(line.pos))
  ) {
    return false;
  }

  const from = cx.lineStart + line.pos;
  const children = [
    cx.elt("DirectiveMark", from, cx.lineStart + line.text.length),
  ];
  let contentFrom = -1;
  let contentTo = from;
  let end = cx.lineStart + line.text.length;

  while (cx.nextLine()) {
    const lineFrom = cx.lineStart;
    const lineTo = lineFrom + line.text.length;
    if (
      line.indent - line.baseIndent < 4 &&
      line.text.slice(line.pos).trimEnd() === ":::"
    ) {
      if (contentFrom >= 0 && contentFrom < contentTo) {
        children.push(cx.elt("DirectiveContent", contentFrom, contentTo));
      }
      const markFrom = lineFrom + line.pos;
      children.push(cx.elt("DirectiveMark", markFrom, markFrom + 3));
      end = markFrom + 3;
      cx.nextLine();
      cx.addElement(cx.elt("DirectiveBlock", from, end, children));
      return true;
    }
    if (contentFrom < 0) {
      contentFrom = lineFrom;
    }
    contentTo = lineTo;
    end = lineTo;
  }

  if (contentFrom >= 0 && contentFrom < contentTo) {
    children.push(cx.elt("DirectiveContent", contentFrom, contentTo));
  }
  cx.addElement(cx.elt("DirectiveBlock", from, end, children));
  return true;
}

function parseInlineMath(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 36) {
    return -1;
  }
  const delimiterLength = cx.char(pos + 1) === 36 ? 2 : 1;
  const contentFrom = pos + delimiterLength;
  if (contentFrom >= cx.end) {
    return -1;
  }
  if (
    delimiterLength === 1 &&
    isMarkdownWhitespace(cx.char(contentFrom))
  ) {
    return -1;
  }

  const scanTo = Math.min(cx.end, contentFrom + MAX_FORMULA_LENGTH + 1);
  for (let cursor = contentFrom; cursor < scanTo; cursor += 1) {
    const character = cx.char(cursor);
    if (character === 10 || character === 13) {
      return -1;
    }
    if (character === 92) {
      cursor += 1;
      continue;
    }
    const closes =
      character === 36 &&
      (delimiterLength === 1 || cx.char(cursor + 1) === 36);
    if (!closes || cursor <= contentFrom) {
      continue;
    }
    if (
      delimiterLength === 1 &&
      isMarkdownWhitespace(cx.char(cursor - 1))
    ) {
      continue;
    }
    const closeTo = cursor + delimiterLength;
    return cx.addElement(
      cx.elt("InlineMath", pos, closeTo, [
        cx.elt("MathMark", pos, contentFrom),
        cx.elt("MathContent", contentFrom, cursor),
        cx.elt("MathMark", cursor, closeTo),
      ]),
    );
  }
  return -1;
}

function parseFootnoteReference(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 91 || cx.char(pos + 1) !== 94) {
    return -1;
  }
  const labelFrom = pos + 2;
  const scanTo = Math.min(
    cx.end,
    labelFrom + MAX_FOOTNOTE_LABEL_LENGTH + 1,
  );
  for (let cursor = labelFrom; cursor < scanTo; cursor += 1) {
    const character = cx.char(cursor);
    if (character === 10 || character === 13) {
      return -1;
    }
    if (character !== 93) {
      continue;
    }
    if (cursor <= labelFrom) {
      return -1;
    }
    return cx.addElement(
      cx.elt("FootnoteReference", pos, cursor + 1, [
        cx.elt("FootnoteMark", pos, labelFrom),
        cx.elt("FootnoteLabel", labelFrom, cursor),
        cx.elt("FootnoteMark", cursor, cursor + 1),
      ]),
    );
  }
  return -1;
}

function isMarkdownWhitespace(character: number): boolean {
  return (
    character === 9 ||
    character === 10 ||
    character === 13 ||
    character === 32
  );
}
