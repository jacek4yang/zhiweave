import {
  outlineFromMarkdown,
  parseMarkdownDocument,
} from "./markdownAst";

export function wikiHeadingOffset(
  markdown: string,
  heading: string | null,
): number | null {
  if (heading === null || normalizeHeading(heading).length === 0) {
    return null;
  }
  try {
    const expected = normalizeHeading(heading);
    const item = outlineFromMarkdown(parseMarkdownDocument(markdown)).find(
      (candidate) => normalizeHeading(candidate.text) === expected,
    );
    return item?.offset ?? null;
  } catch {
    return null;
  }
}

function normalizeHeading(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN");
}
