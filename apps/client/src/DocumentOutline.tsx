import { ListTree, X } from "lucide-react";
import { useMemo, type CSSProperties } from "react";

import {
  outlineFromMarkdown,
  parseMarkdownDocument,
  type MarkdownOutlineItem,
} from "./markdownAst";

interface DocumentOutlineProps {
  readonly markdown: string;
  readonly noteId: string;
  readonly onClose: () => void;
  readonly onNavigate: (item: MarkdownOutlineItem) => void;
}

export function DocumentOutline({
  markdown,
  noteId,
  onClose,
  onNavigate,
}: DocumentOutlineProps) {
  const outline = useMemo(() => {
    try {
      return outlineFromMarkdown(parseMarkdownDocument(markdown));
    } catch {
      return [];
    }
  }, [markdown]);

  return (
    <aside
      aria-label="当前知识节点大纲"
      className="document-outline"
      data-context="outline"
      data-note-id={noteId}
    >
      <header>
        <span>
          <ListTree />
          <strong>大纲</strong>
        </span>
        <button
          aria-label="关闭大纲"
          onClick={onClose}
          title="关闭大纲"
          type="button"
        >
          <X />
        </button>
      </header>
      {outline.length === 0 ? (
        <p className="document-outline-empty">
          添加 Markdown 标题后，可以从这里快速定位。
        </p>
      ) : (
        <nav aria-label="标题列表">
          {outline.map((item, index) => (
            <button
              key={`${item.offset ?? "unknown"}-${index}`}
              onClick={() => onNavigate(item)}
              style={{ "--outline-depth": item.depth } as CSSProperties}
              title={item.text}
              type="button"
            >
              <i aria-hidden="true" />
              <span>{item.text}</span>
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}
