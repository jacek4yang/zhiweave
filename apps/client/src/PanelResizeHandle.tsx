import {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  panelWidthFromKeyboard,
  panelWidthFromPointerDelta,
  panelWidthRange,
  type ResizablePanel,
} from "./panelLayout";

interface PanelResizeHandleProps {
  readonly onCommit: (width: number) => void;
  readonly onPreview: (width: number) => void;
  readonly panel: ResizablePanel;
  readonly value: number;
}

export function PanelResizeHandle({
  onCommit,
  onPreview,
  panel,
  value,
}: PanelResizeHandleProps) {
  const dragRef = useRef<{
    readonly pointerId: number;
    readonly startWidth: number;
    readonly startX: number;
    latestWidth: number;
  } | null>(null);
  const range = panelWidthRange(panel);
  const label =
    panel === "explorer" ? "调整笔记栏宽度" : "调整检查器宽度";

  const commitDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit(drag.latestWidth);
  };

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={range.maximum}
      aria-valuemin={range.minimum}
      aria-valuenow={value}
      aria-valuetext={`${value} 像素`}
      className={`panel-resize-handle is-${panel}`}
      data-context="panel-resizer"
      data-panel={panel}
      onDoubleClick={() => onCommit(range.defaultValue)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const next = panelWidthFromKeyboard(
          panel,
          value,
          event.key,
          event.shiftKey,
        );
        if (next === null) {
          return;
        }
        event.preventDefault();
        onCommit(next);
      }}
      onLostPointerCapture={commitDrag}
      onPointerCancel={commitDrag}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startWidth: value,
          startX: event.clientX,
          latestWidth: value,
        };
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) {
          return;
        }
        const next = panelWidthFromPointerDelta(
          panel,
          drag.startWidth,
          event.clientX - drag.startX,
        );
        drag.latestWidth = next;
        onPreview(next);
      }}
      onPointerUp={commitDrag}
      role="separator"
      tabIndex={0}
      title={`${label}；方向键微调，Shift 加速，Home/End 到边界，Enter 或双击恢复默认`}
    >
      <i aria-hidden="true" />
    </div>
  );
}
