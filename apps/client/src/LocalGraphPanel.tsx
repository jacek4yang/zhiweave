import { Network, X } from "lucide-react";
import { useMemo, type KeyboardEvent } from "react";

import { graphNodeLabel, layoutLocalGraph } from "./localGraphModel";
import type {
  NativeLocalGraph,
  NativeLocalGraphEdge,
  NativeLocalGraphNode,
} from "./workspaceClient";

export type LocalGraphState = "idle" | "loading" | "ready" | "error";

interface LocalGraphPanelProps {
  readonly graph: NativeLocalGraph | null;
  readonly noteId: string;
  readonly onClose: () => void;
  readonly onOpen: (node: NativeLocalGraphNode) => void;
  readonly state: LocalGraphState;
}

export function LocalGraphPanel({
  graph,
  noteId,
  onClose,
  onOpen,
  state,
}: LocalGraphPanelProps) {
  const layout = useMemo(
    () => (graph === null ? { edges: [], nodes: [] } : layoutLocalGraph(graph)),
    [graph],
  );
  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.id, node] as const) ?? []),
    [graph],
  );

  return (
    <aside
      aria-busy={state === "loading"}
      aria-label="当前知识节点的局部图谱"
      className="local-graph-panel"
      data-context="graph"
      data-note-id={noteId}
    >
      <header>
        <span>
          <Network />
          <strong>局部图谱</strong>
          {state === "ready" && graph !== null ? (
            <small>{graph.nodes.length}</small>
          ) : null}
        </span>
        <button
          aria-label="关闭局部图谱"
          onClick={onClose}
          title="关闭局部图谱"
          type="button"
        >
          <X />
        </button>
      </header>

      <div className="local-graph-panel-body">
        {state === "loading" ? (
          <p className="local-graph-message">正在读取本地关系索引…</p>
        ) : state === "error" ? (
          <p className="local-graph-message is-error">
            局部图谱暂时不可用。Markdown 正文未受影响，可从状态栏重建索引。
          </p>
        ) : graph === null || layout.nodes.length === 0 ? (
          <p className="local-graph-message">尚未选择可绘制的知识节点。</p>
        ) : (
          <>
            <svg
              aria-label={`${nodesById.get(graph.rootNoteId)?.title ?? "当前节点"}的一跳关系图`}
              className="local-graph-canvas"
              role="group"
              viewBox="0 0 640 420"
            >
              <defs>
                <marker
                  id="local-graph-arrow"
                  markerHeight="7"
                  markerUnits="strokeWidth"
                  markerWidth="8"
                  orient="auto"
                  refX="7"
                  refY="3.5"
                  viewBox="0 0 8 7"
                >
                  <path d="M 0 0 L 8 3.5 L 0 7 z" />
                </marker>
              </defs>
              <g aria-hidden="true" className="local-graph-edges">
                {layout.edges.map(({ edge, path }, index) => (
                  <path
                    className={`local-graph-edge is-${edge.referenceKind}`}
                    d={path}
                    key={edgeKey(edge, index)}
                    markerEnd="url(#local-graph-arrow)"
                    style={{
                      strokeWidth: Math.min(
                        4,
                        1.1 + Math.log2(edge.occurrenceCount + 1) * 0.45,
                      ),
                    }}
                  >
                    <title>{edgeTitle(edge, nodesById)}</title>
                  </path>
                ))}
              </g>
              <g className="local-graph-nodes">
                {layout.nodes.map(({ node, x, y }) => {
                  const root = node.id === graph.rootNoteId;
                  return (
                    <g
                      aria-label={`${root ? "中心节点" : "关联节点"}：${node.title}`}
                      className={`local-graph-node is-${node.kind.replaceAll("_", "-")}${
                        root ? " is-root" : ""
                      }`}
                      data-context="note-item"
                      data-note-id={node.id}
                      key={node.id}
                      onClick={() => onOpen(node)}
                      onKeyDown={(event) => openNodeFromKeyboard(event, node, onOpen)}
                      role="button"
                      tabIndex={0}
                      transform={`translate(${x} ${y})`}
                    >
                      <rect
                        height="38"
                        rx="8"
                        width={root ? "112" : "100"}
                        x={root ? "-56" : "-50"}
                        y="-19"
                      />
                      <circle cx={root ? "-42" : "-37"} cy="0" r="4" />
                      <text textAnchor="middle" x={root ? "7" : "5"} y="4">
                        {graphNodeLabel(node.title, root ? 13 : 11)}
                      </text>
                      <title>{`${node.title}\n${node.path}`}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
            <footer className="local-graph-legend">
              <span>
                <i className="is-link" />
                链接
              </span>
              <span>
                <i className="is-embed" />
                嵌入
              </span>
              <small>一跳 · {graph.edges.length} 组关系</small>
            </footer>
            {graph.nodes.length === 1 ? (
              <p className="local-graph-message">
                当前节点还没有已解析的 Wiki 关系。输入
                <code>[[节点名称]]</code>即可连接知识。
              </p>
            ) : null}
            {graph.truncated ? (
              <p className="local-graph-limit">
                关系较多，已按引用频次显示最相关的节点。
              </p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function openNodeFromKeyboard(
  event: KeyboardEvent<SVGGElement>,
  node: NativeLocalGraphNode,
  onOpen: (node: NativeLocalGraphNode) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  onOpen(node);
}

function edgeKey(edge: NativeLocalGraphEdge, index: number): string {
  return `${edge.sourceNoteId}:${edge.targetNoteId}:${edge.referenceKind}:${index}`;
}

function edgeTitle(
  edge: NativeLocalGraphEdge,
  nodes: ReadonlyMap<string, NativeLocalGraphNode>,
): string {
  const source = nodes.get(edge.sourceNoteId)?.title ?? "未知来源";
  const target = nodes.get(edge.targetNoteId)?.title ?? "未知目标";
  const kind = edge.referenceKind === "embed" ? "嵌入" : "链接";
  return `${source} → ${target} · ${kind} × ${edge.occurrenceCount}`;
}
