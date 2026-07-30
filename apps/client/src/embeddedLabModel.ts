export const EMBEDDED_LAB_LANGUAGE = "zhiweave-lab";
export const EMBEDDED_LAB_SCHEMA = "zhiweave/lab@1";
export const MAX_EMBEDDED_LAB_SOURCE_LENGTH = 16_384;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_VERSION_NAMES: Readonly<Record<number, string>> = {
  1: "基于时间与节点",
  2: "DCE 安全",
  3: "MD5 名称派生",
  4: "随机数",
  5: "SHA-1 名称派生",
  6: "重排时间",
  7: "Unix 时间有序",
  8: "自定义",
};

export interface UuidLabDefinition {
  readonly schema: typeof EMBEDDED_LAB_SCHEMA;
  readonly kind: "uuid";
  readonly title: string;
  readonly initialValue?: string;
}

export type EmbeddedLabDefinition = UuidLabDefinition;

export interface EmbeddedLabParseSuccess {
  readonly ok: true;
  readonly definition: EmbeddedLabDefinition;
}

export interface EmbeddedLabParseFailure {
  readonly ok: false;
  readonly code:
    | "invalid-json"
    | "invalid-shape"
    | "invalid-value"
    | "source-too-large"
    | "unsupported-kind"
    | "unsupported-schema";
  readonly message: string;
}

export type EmbeddedLabParseResult =
  | EmbeddedLabParseSuccess
  | EmbeddedLabParseFailure;

export interface UuidAnalysis {
  readonly canonical: string;
  readonly compact: string;
  readonly groups: readonly string[];
  readonly bits: string;
  readonly bytes: readonly number[];
  readonly version: number;
  readonly versionName: string;
  readonly variant: "ncs" | "rfc9562" | "microsoft" | "future";
  readonly variantName: string;
  readonly entropyBits: number | null;
  readonly timestamp: string | null;
}

export function parseEmbeddedLab(source: string): EmbeddedLabParseResult {
  if (source.length > MAX_EMBEDDED_LAB_SOURCE_LENGTH) {
    return {
      ok: false,
      code: "source-too-large",
      message: `交互块超过 ${MAX_EMBEDDED_LAB_SOURCE_LENGTH / 1024} KB 安全上限。`,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return {
      ok: false,
      code: "invalid-json",
      message: "交互块必须包含一个有效的 JSON 对象。",
    };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      code: "invalid-shape",
      message: "交互块顶层必须是对象。",
    };
  }

  if (value.schema !== EMBEDDED_LAB_SCHEMA) {
    return {
      ok: false,
      code: "unsupported-schema",
      message: `不支持的 schema；当前只支持 ${EMBEDDED_LAB_SCHEMA}。`,
    };
  }

  if (value.kind !== "uuid") {
    return {
      ok: false,
      code: "unsupported-kind",
      message: `当前版本没有注册“${String(value.kind)}”交互组件。`,
    };
  }

  const allowedKeys = new Set(["schema", "kind", "title", "initialValue"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return {
      ok: false,
      code: "invalid-shape",
      message: "UUID 交互块包含未声明的字段。",
    };
  }

  if (
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.title.trim().length > 80
  ) {
    return {
      ok: false,
      code: "invalid-value",
      message: "title 必须是 1–80 个字符。",
    };
  }

  if (
    value.initialValue !== undefined &&
    (typeof value.initialValue !== "string" ||
      !UUID_PATTERN.test(value.initialValue.trim()))
  ) {
    return {
      ok: false,
      code: "invalid-value",
      message: "initialValue 必须是带连字符的标准 UUID。",
    };
  }

  return {
    ok: true,
    definition: {
      schema: EMBEDDED_LAB_SCHEMA,
      kind: "uuid",
      title: value.title.trim(),
      ...(typeof value.initialValue === "string"
        ? { initialValue: value.initialValue.trim().toLocaleLowerCase() }
        : {}),
    },
  };
}

export function analyzeUuid(value: string): UuidAnalysis | null {
  const canonical = value.trim().toLocaleLowerCase();
  if (!UUID_PATTERN.test(canonical)) {
    return null;
  }

  const compact = canonical.replaceAll("-", "");
  const bytes = Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16),
  );
  const version = Number.parseInt(compact[12] ?? "0", 16);
  const variantByte = bytes[8] ?? 0;
  const variant = classifyUuidVariant(variantByte);
  const timestamp =
    version === 7
      ? timestampFromUuidV7(compact)
      : null;

  return {
    canonical,
    compact,
    groups: canonical.split("-"),
    bits: bytes.map((byte) => byte.toString(2).padStart(8, "0")).join(""),
    bytes,
    version,
    versionName: UUID_VERSION_NAMES[version] ?? "未注册版本",
    variant,
    variantName: variantLabel(variant),
    entropyBits: version === 4 && variant === "rfc9562" ? 122 : null,
    timestamp,
  };
}

export function generateUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function createUuidLabMarkdown(
  title = "UUID 结构实验室",
  initialValue = "01890f9e-7b5a-7cc3-98c4-dc0c0c07398f",
): string {
  const definition: UuidLabDefinition = {
    schema: EMBEDDED_LAB_SCHEMA,
    kind: "uuid",
    title,
    initialValue,
  };

  return `# ${title}

## 学习目标

通过修改、生成和拆解 UUID，观察 128 位数据中哪些位表达版本与变体，哪些位承载时间或随机信息。

\`\`\`${EMBEDDED_LAB_LANGUAGE}
${JSON.stringify(definition, null, 2)}
\`\`\`

## 我的解释

- 版本位说明：
- 变体位说明：
- 为什么 UUID 不等于绝对无冲突：

## 证据与下一步

- [ ] 比较 UUID v4 与 v7 的排序性质
- [ ] 用自己的话解释固定 6 位为什么不会降低到不可接受的随机性
`;
}

export function createUuidLabGenerationPrompt(
  definition: UuidLabDefinition,
): string {
  return `请为我的 Markdown 笔记生成一个“UUID 结构实验室”交互块。

你只能返回一个 Markdown fenced code block，不要返回 HTML、JavaScript、解释文字或网络请求。配置必须严格使用以下受支持格式：

\`\`\`${EMBEDDED_LAB_LANGUAGE}
{
  "schema": "${EMBEDDED_LAB_SCHEMA}",
  "kind": "uuid",
  "title": "${definition.title}",
  "initialValue": "${definition.initialValue ?? "01890f9e-7b5a-7cc3-98c4-dc0c0c07398f"}"
}
\`\`\`

要求：
1. initialValue 必须是标准的带连字符 UUID；
2. title 不超过 80 个字符；
3. 不得增加 schema、kind、title、initialValue 之外的字段；
4. 保留声明式数据，让知织的受控渲染器负责交互。`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyUuidVariant(
  byte: number,
): UuidAnalysis["variant"] {
  if ((byte & 0x80) === 0) {
    return "ncs";
  }
  if ((byte & 0xc0) === 0x80) {
    return "rfc9562";
  }
  if ((byte & 0xe0) === 0xc0) {
    return "microsoft";
  }
  return "future";
}

function variantLabel(variant: UuidAnalysis["variant"]): string {
  switch (variant) {
    case "ncs":
      return "兼容旧 NCS";
    case "rfc9562":
      return "RFC 9562（10xx）";
    case "microsoft":
      return "兼容旧 Microsoft";
    case "future":
      return "保留供未来使用";
  }
}

function timestampFromUuidV7(compact: string): string | null {
  const milliseconds = Number.parseInt(compact.slice(0, 12), 16);
  if (!Number.isSafeInteger(milliseconds)) {
    return null;
  }
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
