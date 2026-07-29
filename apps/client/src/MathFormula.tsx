import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathFormulaProps {
  readonly display: boolean;
  readonly source: string;
}

const MAX_FORMULA_LENGTH = 16_384;

export function MathFormula({ display, source }: MathFormulaProps) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return;
    }
    if (source.length > MAX_FORMULA_LENGTH) {
      element.textContent = source;
      element.dataset.mathState = "too-large";
      return;
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
    } catch {
      element.textContent = source;
      element.dataset.mathState = "invalid";
    }
  }, [display, source]);

  return (
    <span
      aria-label={`${display ? "公式" : "行内公式"}：${source}`}
      className={display ? "preview-math-block" : "preview-math-inline"}
      ref={host}
      title="双击或切换到编辑视图可查看 LaTeX 源码"
    />
  );
}
