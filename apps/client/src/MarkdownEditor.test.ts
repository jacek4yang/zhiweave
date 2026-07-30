import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  editorStatusFromState,
  markdownReferenceInsertion,
} from "./MarkdownEditor";

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

  it("reports every cursor and the total selected text", () => {
    const state = EditorState.create({
      doc: "alpha\n中文\nomega",
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create(
        [
          EditorSelection.range(0, 5),
          EditorSelection.cursor(7),
          EditorSelection.range(9, 14),
        ],
        1,
      ),
    });

    expect(editorStatusFromState(state)).toMatchObject({
      line: 2,
      column: 2,
      selectionCount: 3,
      selectionLength: 10,
    });
  });
});
