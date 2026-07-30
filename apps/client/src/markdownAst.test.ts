import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  firstLevelOneHeading,
  outlineFromMarkdown,
  parseCodeFenceInfo,
  parseMarkdownDocument,
  plainTextFromMarkdown,
} from "./markdownAst";
import { MarkdownPreview } from "./MarkdownPreview";

describe("shared Markdown AST", () => {
  it("parses frontmatter, GFM structure, nested lists, footnotes and code metadata", () => {
    const document = parseMarkdownDocument(`---
tags: [学习, uuid]
---
# UUID **结构**

- [x] 已验证
  - 嵌套 \`代码\`

| 字段 | 位数 |
| :--- | ---: |
| 版本 | 4 |

~~~ts title="uuid.ts" {2}
const version = 4
~~~

正文引用[^source]。

[^source]: RFC 9562
`);

    expect(document.root.children.map((node) => node.type)).toEqual([
      "yaml",
      "heading",
      "list",
      "table",
      "code",
      "paragraph",
      "footnoteDefinition",
    ]);
    expect(firstLevelOneHeading(document)).toBe("UUID 结构");
    expect(outlineFromMarkdown(document)).toEqual([
      expect.objectContaining({ depth: 1, text: "UUID 结构" }),
    ]);
    expect(plainTextFromMarkdown(document)).toContain("- [x] 已验证");
    expect(plainTextFromMarkdown(document)).toContain("字段\t位数");
    expect(plainTextFromMarkdown(document)).toContain("[source] RFC 9562");
    expect(plainTextFromMarkdown(document)).not.toContain("tags:");
  });

  it("promotes Wiki links, embeds, callouts and math without losing source", () => {
    const source = `# 关系

连接 [[UUID#版本|版本字段]]，并嵌入 ![[RFC 9562]]。

> [!TIP]+ 观察
> 版本位满足 $v = 7$。

$$
t = unix\\_ms
$$
`;
    const document = parseMarkdownDocument(source);
    const paragraph = document.root.children[1];
    const callout = document.root.children[2];

    expect(paragraph?.type).toBe("paragraph");
    expect(
      paragraph?.type === "paragraph"
        ? paragraph.children.map((node) => node.type)
        : [],
    ).toEqual(["text", "wikiLink", "text", "wikiEmbed", "text"]);
    expect(callout).toEqual(
      expect.objectContaining({
        fold: "expanded",
        kind: "tip",
        title: "观察",
        type: "callout",
      }),
    );
    expect(document.root.children[3]?.type).toBe("math");
    expect(document.source).toBe(source);
    expect(plainTextFromMarkdown(document)).toContain("版本字段");
    expect(plainTextFromMarkdown(document)).toContain("RFC 9562");
  });

  it("keeps raw HTML inert and never turns unsafe links or images into active resources", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        markdown: `# 安全

[危险](javascript:alert(1))

![远程像素](https://tracker.invalid/pixel.png)

<img src=x onerror="alert(1)">
`,
      }),
    );

    expect(html).not.toContain("href=\"javascript:");
    expect(html).not.toContain("src=\"https://tracker.invalid");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("HTML 已作为不可信源码显示");
  });

  it("makes Wiki targets interactive only when a navigation capability is supplied", () => {
    const interactive = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        markdown: "[[UUID#版本|版本字段]] 与 ![[diagram.svg]]",
        onOpenWikiTarget: () => undefined,
        sourceNoteId: "source-note",
      }),
    );
    const inert = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        markdown: "[[UUID]]",
      }),
    );

    expect(interactive).toContain(
      '<button aria-label="打开知识节点：版本字段"',
    );
    expect(interactive).toContain('data-context="wiki-link"');
    expect(interactive).toContain('data-note-id="source-note"');
    expect(interactive).toContain('data-wiki-target="UUID#版本"');
    expect(interactive).toContain('data-attachment-target="diagram.svg"');
    expect(interactive).toContain(
      "<small>桌面端可验证并显示本地附件</small>",
    );
    expect(inert).toContain('<span class="preview-wiki-link"');
    expect(inert).not.toContain("<button");
  });

  it("preserves unknown fence metadata while recognizing safe display fields", () => {
    expect(
      parseCodeFenceInfo("Rust<script>", `title="src/main.rs" {3,5-8}`),
    ).toEqual({
      highlight: "{3,5-8}",
      language: "rustscript",
      rawMeta: `title="src/main.rs" {3,5-8}`,
      title: "src/main.rs",
    });
    expect(parseCodeFenceInfo("", "unknown=true").rawMeta).toBe(
      "unknown=true",
    );
  });

  it("does not mistake frontmatter or fenced headings for the note title", () => {
    const document = parseMarkdownDocument(`---
title: metadata
---

\`\`\`markdown
# code, not title
\`\`\`

真实标题
========
`);
    expect(firstLevelOneHeading(document)).toBe("真实标题");
  });
});
