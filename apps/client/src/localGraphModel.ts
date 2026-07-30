import type {
  NativeLocalGraph,
  NativeLocalGraphEdge,
  NativeLocalGraphNode,
} from "./workspaceClient";

export const LOCAL_GRAPH_VIEWBOX_WIDTH = 640;
export const LOCAL_GRAPH_VIEWBOX_HEIGHT = 420;

export interface PositionedLocalGraphNode {
  readonly node: NativeLocalGraphNode;
  readonly x: number;
  readonly y: number;
}

export interface PositionedLocalGraphEdge {
  readonly edge: NativeLocalGraphEdge;
  readonly path: string;
}

export interface LocalGraphLayout {
  readonly edges: readonly PositionedLocalGraphEdge[];
  readonly nodes: readonly PositionedLocalGraphNode[];
}

const CENTER_X = LOCAL_GRAPH_VIEWBOX_WIDTH / 2;
const CENTER_Y = LOCAL_GRAPH_VIEWBOX_HEIGHT / 2;
const RINGS = [
  { capacity: 8, radiusX: 108, radiusY: 74 },
  { capacity: 14, radiusX: 178, radiusY: 126 },
  { capacity: 20, radiusX: 252, radiusY: 178 },
  { capacity: 40, radiusX: 282, radiusY: 190 },
] as const;

export function layoutLocalGraph(graph: NativeLocalGraph): LocalGraphLayout {
  const root =
    graph.nodes.find((node) => node.id === graph.rootNoteId) ?? graph.nodes[0];
  if (root === undefined) {
    return { edges: [], nodes: [] };
  }
  const positioned: PositionedLocalGraphNode[] = [
    { node: root, x: CENTER_X, y: CENTER_Y },
  ];
  let ringIndex = 0;
  let indexInRing = 0;
  for (const node of graph.nodes) {
    if (node.id === root.id) {
      continue;
    }
    const ring = RINGS[Math.min(ringIndex, RINGS.length - 1)]!;
    const angle =
      -Math.PI / 2 + (2 * Math.PI * indexInRing) / ring.capacity;
    positioned.push({
      node,
      x: roundCoordinate(CENTER_X + Math.cos(angle) * ring.radiusX),
      y: roundCoordinate(CENTER_Y + Math.sin(angle) * ring.radiusY),
    });
    indexInRing += 1;
    if (indexInRing >= ring.capacity && ringIndex < RINGS.length - 1) {
      ringIndex += 1;
      indexInRing = 0;
    }
  }
  const positions = new Map(
    positioned.map((position) => [position.node.id, position] as const),
  );
  const edges = graph.edges.flatMap((edge) => {
    const source = positions.get(edge.sourceNoteId);
    const target = positions.get(edge.targetNoteId);
    if (source === undefined || target === undefined) {
      return [];
    }
    return [{ edge, path: edgePath(source, target, edge) }];
  });
  return { edges, nodes: positioned };
}

export function graphNodeLabel(title: string, maximum = 12): string {
  const characters = [...title.trim()];
  if (characters.length <= maximum) {
    return characters.join("");
  }
  return `${characters.slice(0, Math.max(1, maximum - 1)).join("")}…`;
}

function edgePath(
  source: PositionedLocalGraphNode,
  target: PositionedLocalGraphNode,
  edge: NativeLocalGraphEdge,
): string {
  if (source.node.id === target.node.id) {
    return [
      `M ${source.x + 36} ${source.y - 7}`,
      `C ${source.x + 84} ${source.y - 66},`,
      `${source.x - 84} ${source.y - 66},`,
      `${source.x - 36} ${source.y - 7}`,
    ].join(" ");
  }
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const startX = source.x + unitX * 46;
  const startY = source.y + unitY * 21;
  const endX = target.x - unitX * 49;
  const endY = target.y - unitY * 23;
  const bend = edge.referenceKind === "embed" ? 13 : -8;
  const controlX = (startX + endX) / 2 - unitY * bend;
  const controlY = (startY + endY) / 2 + unitX * bend;
  return [
    `M ${roundCoordinate(startX)} ${roundCoordinate(startY)}`,
    `Q ${roundCoordinate(controlX)} ${roundCoordinate(controlY)}`,
    `${roundCoordinate(endX)} ${roundCoordinate(endY)}`,
  ].join(" ");
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}
