import { describe, expect, it } from "vitest";

import { markdownReferenceInsertion } from "./MarkdownEditor";

describe("Markdown attachment insertion", () => {
  it("keeps the reference on its own block without replacing selected text", () => {
    const reference = "![diagram](../attachments/diagram.png)";
    const position = "# UUID".length;
    expect(
      markdownReferenceInsertion(
        "# UUID\n\nEvidence",
        position,
        reference,
      ),
    ).toEqual({
      text: `\n\n${reference}`,
      cursor: position + 2 + reference.length,
    });
  });

  it("fills an existing blank line without adding noisy whitespace", () => {
    const markdown = "# UUID\n\nEvidence";
    const position = "# UUID\n".length;
    const insertion = markdownReferenceInsertion(
      markdown,
      position,
      "![[attachments/proof.pdf]]",
    );
    expect(insertion.text).toBe("![[attachments/proof.pdf]]");
    expect(
      `${markdown.slice(0, position)}${insertion.text}${markdown.slice(position)}`,
    ).toBe("# UUID\n![[attachments/proof.pdf]]\nEvidence");
  });
});
