import katex from "katex";
import "katex/dist/katex.min.css";

import { MAX_FORMULA_LENGTH } from "./markdownSyntaxContract";

export type MathRenderState = "invalid" | "rendered" | "too-large";

export function renderMathInto(
  element: HTMLElement,
  source: string,
  display: boolean,
): MathRenderState {
  if (source.length > MAX_FORMULA_LENGTH) {
    element.textContent = source;
    element.dataset.mathState = "too-large";
    return "too-large";
  }
  try {
    katex.render(source, element, {
      displayMode: display,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false,
    });
    element.dataset.mathState = "rendered";
    return "rendered";
  } catch {
    element.textContent = source;
    element.dataset.mathState = "invalid";
    return "invalid";
  }
}
