import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Binary,
  Check,
  Copy,
  Dices,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import {
  analyzeUuid,
  createUuidLabGenerationPrompt,
  generateUuidV4,
  parseEmbeddedLab,
  type UuidLabDefinition,
} from "./embeddedLabModel";

interface EmbeddedLabProps {
  readonly source: string;
}

const UUID_GROUP_LABELS = [
  "32 位",
  "16 位",
  "版本 + 12 位",
  "变体 + 14 位",
  "48 位",
] as const;

export function EmbeddedLab({ source }: EmbeddedLabProps) {
  const result = useMemo(() => parseEmbeddedLab(source), [source]);
  if (!result.ok) {
    return (
      <section className="lab-fallback" aria-label="无法运行的交互块">
        <header>
          <TriangleAlert />
          <div>
            <strong>交互块未运行</strong>
            <p>{result.message} 原始 Markdown 已完整保留。</p>
          </div>
        </header>
        <pre>
          <code>{`\`\`\`zhiweave-lab\n${source}\n\`\`\``}</code>
        </pre>
      </section>
    );
  }

  switch (result.definition.kind) {
    case "uuid":
      return <UuidLab definition={result.definition} />;
  }
}

function UuidLab({ definition }: {
  readonly definition: UuidLabDefinition;
}) {
  const [value, setValue] = useState(
    definition.initialValue ?? generateUuidV4(),
  );
  const [notice, setNotice] = useState("");
  const analysis = useMemo(() => analyzeUuid(value), [value]);

  useEffect(() => {
    if (definition.initialValue !== undefined) {
      setValue(definition.initialValue);
    }
  }, [definition.initialValue]);

  useEffect(() => {
    if (notice.length === 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function copyUuid() {
    if (analysis === null) {
      return;
    }
    const copied = await copyText(analysis.canonical);
    setNotice(copied ? "UUID 已复制" : "无法访问系统剪贴板");
  }

  async function copyGenerationPrompt() {
    const copied = await copyText(createUuidLabGenerationPrompt({
      ...definition,
      ...(analysis === null ? {} : { initialValue: analysis.canonical }),
    }));
    setNotice(copied ? "兼容的 AI 生成提示词已复制" : "无法访问系统剪贴板");
  }

  return (
    <section
      className="embedded-lab uuid-lab"
      aria-label={definition.title}
      data-context="embedded-lab"
    >
      <header className="lab-header">
        <div className="lab-heading">
          <span className="lab-icon"><Binary /></span>
          <div>
            <span className="lab-kicker">ZHIWEAVE LAB · UUID</span>
            <h3>{definition.title}</h3>
          </div>
        </div>
        <span className="lab-trust" title="本地受控组件，不执行笔记脚本">
          <ShieldCheck />
          本地安全运行
        </span>
      </header>

      <div className="uuid-controls">
        <label>
          <span>输入或粘贴 UUID</span>
          <input
            aria-invalid={analysis === null}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            value={value}
          />
        </label>
        <button
          onClick={() => setValue(generateUuidV4())}
          title="在本机生成 UUID v4"
          type="button"
        >
          <Dices />
          生成 v4
        </button>
        <button
          disabled={analysis === null}
          onClick={() => void copyUuid()}
          type="button"
        >
          <Copy />
          复制
        </button>
      </div>

      {analysis === null ? (
        <div className="lab-validation" role="alert">
          <TriangleAlert />
          请输入 8-4-4-4-12 形式的标准 UUID。
        </div>
      ) : (
        <>
          <div className="uuid-groups" aria-label="UUID 五段结构">
            {analysis.groups.map((group, index) => (
              <div className={`group-${index + 1}`} key={`${group}-${index}`}>
                <span>{UUID_GROUP_LABELS[index]}</span>
                <strong>{group}</strong>
              </div>
            ))}
          </div>

          <div className="uuid-facts">
            <article>
              <span>版本</span>
              <strong>v{analysis.version}</strong>
              <small>{analysis.versionName}</small>
            </article>
            <article>
              <span>变体</span>
              <strong>{analysis.variant === "rfc9562" ? "10xx" : "其他"}</strong>
              <small>{analysis.variantName}</small>
            </article>
            <article>
              <span>总长度</span>
              <strong>128 bit</strong>
              <small>16 bytes · 32 hex</small>
            </article>
            <article>
              <span>
                {analysis.entropyBits === null ? "时间字段" : "随机负载"}
              </span>
              <strong>
                {analysis.entropyBits === null
                  ? analysis.timestamp === null ? "—" : "48 bit"
                  : `${analysis.entropyBits} bit`}
              </strong>
              <small>
                {analysis.timestamp ?? "固定版本与变体位已扣除"}
              </small>
            </article>
          </div>

          <details className="uuid-bits">
            <summary>展开 128 位视图</summary>
            <div className="bit-legend">
              <span><i className="version-bit" />版本位（48–51）</span>
              <span><i className="variant-bit" />变体位（64–65）</span>
            </div>
            <div className="bit-grid" aria-label="UUID 二进制位">
              {Array.from(analysis.compact).map((hex, index) => {
                const bitStart = index * 4;
                const role =
                  index === 12
                    ? "is-version"
                    : index === 16
                      ? "is-variant"
                      : "";
                return (
                  <span className={role} key={`${hex}-${index}`}>
                    <small>{bitStart}</small>
                    <strong>{hex}</strong>
                    <i>
                      {Number.parseInt(hex, 16)
                        .toString(2)
                        .padStart(4, "0")}
                    </i>
                  </span>
                );
              })}
            </div>
          </details>
        </>
      )}

      <footer className="lab-footer">
        <span aria-live="polite">
          {notice.length > 0 ? <><Check />{notice}</> : "交互状态不会写回正文"}
        </span>
        <button onClick={() => void copyGenerationPrompt()} type="button">
          <Sparkles />
          复制 AI 生成提示词
        </button>
      </footer>
    </section>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
