import { describe, expect, it } from "vitest";

import { wikiHeadingOffset } from "./wikiNavigation";

describe("Wiki heading navigation", () => {
  it("finds Unicode headings through the shared Markdown AST", () => {
    const markdown = "# UUID\n\n## 字段   布局\n\n正文\n";

    expect(wikiHeadingOffset(markdown, "  字段 布局 ")).toBe(
      markdown.indexOf("## 字段"),
    );
  });

  it("fails closed for absent fragments or malformed documents", () => {
    expect(wikiHeadingOffset("# UUID\n", "不存在")).toBeNull();
    expect(wikiHeadingOffset("# UUID\n", null)).toBeNull();
  });
});
