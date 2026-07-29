import { describe, expect, it } from "vitest";

import { loadSystemStatus } from "./system";

describe("system status", () => {
  it("identifies the standalone browser preview without Obsidian", async () => {
    const status = await loadSystemStatus();
    expect(status.protocol).toBe("ZHIWEAVE/1");
    expect(status.obsidianDependency).toBe(false);
  });
});
