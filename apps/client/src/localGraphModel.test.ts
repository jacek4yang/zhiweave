import { describe, expect, it } from "vitest";

import { graphNodeLabel, layoutLocalGraph } from "./localGraphModel";
import type { NativeLocalGraph } from "./workspaceClient";

describe("local graph layout", () => {
  it("keeps a deterministic center and bounded unique neighbor positions", () => {
    const graph: NativeLocalGraph = {
      rootNoteId: "root",
      nodes: [
        { id: "root", title: "中心", path: "root.md", kind: "topic" },
        ...Array.from({ length: 79 }, (_, index) => ({
          id: `node-${index}`,
          title: `知识节点 ${index}`,
          path: `topics/node-${index}.md`,
          kind: "node" as const,
        })),
      ],
      edges: Array.from({ length: 79 }, (_, index) => ({
        sourceNoteId: index % 2 === 0 ? "root" : `node-${index}`,
        targetNoteId: index % 2 === 0 ? `node-${index}` : "root",
        referenceKind: index % 3 === 0 ? ("embed" as const) : ("link" as const),
        occurrenceCount: index + 1,
      })),
      truncated: false,
    };

    const layout = layoutLocalGraph(graph);
    expect(layout.nodes[0]).toMatchObject({ x: 320, y: 210 });
    expect(new Set(layout.nodes.map(({ x, y }) => `${x}:${y}`)).size).toBe(
      layout.nodes.length,
    );
    expect(
      layout.nodes.every(
        ({ x, y }) => x >= 20 && x <= 620 && y >= 15 && y <= 405,
      ),
    ).toBe(true);
    expect(layout.edges).toHaveLength(graph.edges.length);
    expect(layout.edges.every(({ path }) => !path.includes("NaN"))).toBe(true);
  });

  it("keeps short Unicode labels and truncates by code point", () => {
    expect(graphNodeLabel("UUID")).toBe("UUID");
    expect(graphNodeLabel("系统化学习知识节点", 6)).toBe("系统化学习…");
  });
});
