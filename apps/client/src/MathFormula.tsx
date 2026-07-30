import { useEffect, useRef } from "react";

import { renderMathInto } from "./mathRenderer";

interface MathFormulaProps {
  readonly display: boolean;
  readonly source: string;
}

export function MathFormula({ display, source }: MathFormulaProps) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return;
    }
    renderMathInto(element, source, display);
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
