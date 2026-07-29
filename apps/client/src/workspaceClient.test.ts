import { describe, expect, it } from "vitest";

import { asWorkspaceFailure } from "./workspaceClient";

describe("native workspace error boundary", () => {
  it("accepts structured failures without parsing error strings", () => {
    expect(
      asWorkspaceFailure({
        code: "conflict",
        path: "topics/ownership.md",
        expected: "before",
        actual: "after",
      }),
    ).toMatchObject({
      code: "conflict",
      path: "topics/ownership.md",
    });
  });

  it("rejects unstructured values", () => {
    expect(asWorkspaceFailure("conflict: overwrite")).toBeUndefined();
    expect(asWorkspaceFailure({ message: "conflict" })).toBeUndefined();
    expect(asWorkspaceFailure(null)).toBeUndefined();
  });
});
