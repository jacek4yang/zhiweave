import { describe, expect, it } from "vitest";

import {
  EMBEDDED_LAB_SCHEMA,
  analyzeUuid,
  createUuidLabMarkdown,
  parseEmbeddedLab,
} from "./embeddedLabModel";

describe("embedded lab model", () => {
  it("accepts a strict versioned UUID lab definition", () => {
    const result = parseEmbeddedLab(JSON.stringify({
      schema: EMBEDDED_LAB_SCHEMA,
      kind: "uuid",
      title: "UUID 结构实验室",
      initialValue: "01890f9e-7b5a-7cc3-98c4-dc0c0c07398f",
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.kind).toBe("uuid");
      expect(result.definition.initialValue).toBe(
        "01890f9e-7b5a-7cc3-98c4-dc0c0c07398f",
      );
    }
  });

  it("rejects unknown capabilities and undeclared fields", () => {
    expect(parseEmbeddedLab(JSON.stringify({
      schema: EMBEDDED_LAB_SCHEMA,
      kind: "script",
      title: "不允许执行",
    }))).toMatchObject({ ok: false, code: "unsupported-kind" });

    expect(parseEmbeddedLab(JSON.stringify({
      schema: EMBEDDED_LAB_SCHEMA,
      kind: "uuid",
      title: "UUID",
      script: "alert(1)",
    }))).toMatchObject({ ok: false, code: "invalid-shape" });
  });

  it("decodes RFC 9562 version and variant bits", () => {
    const v4 = analyzeUuid("f81d4fae-7dec-4a0d-a765-00a0c91e6bf6");
    const v7 = analyzeUuid("01890f9e-7b5a-7cc3-98c4-dc0c0c07398f");

    expect(v4).toMatchObject({
      version: 4,
      versionName: "随机数",
      variant: "rfc9562",
      entropyBits: 122,
    });
    expect(v4?.bits).toHaveLength(128);
    expect(v7).toMatchObject({
      version: 7,
      versionName: "Unix 时间有序",
      variant: "rfc9562",
    });
    expect(v7?.timestamp).not.toBeNull();
  });

  it("creates portable Markdown with a declarative lab fence", () => {
    const markdown = createUuidLabMarkdown();

    expect(markdown).toContain("```zhiweave-lab");
    expect(markdown).toContain(`"schema": "${EMBEDDED_LAB_SCHEMA}"`);
    expect(markdown).not.toContain("<script");
  });
});
