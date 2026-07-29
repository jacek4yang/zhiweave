import {
  Fragment,
  lazy,
  Suspense,
  type ReactNode,
} from "react";

import { EMBEDDED_LAB_LANGUAGE } from "./embeddedLabModel";

const EmbeddedLab = lazy(async () => {
  const module = await import("./EmbeddedLab");
  return { default: module.EmbeddedLab };
});

interface MarkdownPreviewProps {
  readonly markdown: string;
}

interface Block {
  readonly kind:
    | "blank"
    | "blockquote"
    | "code"
    | "heading"
    | "ordered"
    | "paragraph"
    | "rule"
    | "task"
    | "unordered";
  readonly content: string;
  readonly level?: number;
  readonly checked?: boolean;
  readonly infoString?: string;
}

export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  const blocks = parseMarkdown(markdown);
  return (
    <article
      className="markdown-preview"
      aria-label="Markdown 阅读视图"
      data-context="preview"
    >
      {blocks.map((block, index) => renderBlock(block, index))}
    </article>
  );
}

function parseMarkdown(markdown: string): readonly Block[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({
        kind: "code",
        content: code.join("\n"),
        infoString: language,
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        content: heading[2] ?? "",
        level: heading[1]?.length ?? 1,
      });
      continue;
    }

    const task = /^-\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (task !== null) {
      blocks.push({
        kind: "task",
        content: task[2] ?? "",
        checked: (task[1] ?? "").toLocaleLowerCase() === "x",
      });
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(line);
    if (unordered !== null) {
      blocks.push({ kind: "unordered", content: unordered[1] ?? "" });
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered !== null) {
      blocks.push({ kind: "ordered", content: ordered[1] ?? "" });
      continue;
    }

    if (line.startsWith("> ")) {
      blocks.push({ kind: "blockquote", content: line.slice(2) });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ kind: "rule", content: "" });
      continue;
    }

    if (line.trim().length === 0) {
      blocks.push({ kind: "blank", content: "" });
      continue;
    }

    blocks.push({ kind: "paragraph", content: line });
  }
  return blocks;
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `${block.kind}-${index}`;
  switch (block.kind) {
    case "heading": {
      const level = Math.min(block.level ?? 1, 6);
      if (level === 1) {
        return <h1 key={key}>{renderInline(block.content)}</h1>;
      }
      if (level === 2) {
        return <h2 key={key}>{renderInline(block.content)}</h2>;
      }
      return <h3 key={key}>{renderInline(block.content)}</h3>;
    }
    case "task":
      return (
        <label className="preview-task" key={key}>
          <input checked={block.checked} disabled type="checkbox" />
          <span>{renderInline(block.content)}</span>
        </label>
      );
    case "unordered":
      return <div className="preview-list" key={key}>• {renderInline(block.content)}</div>;
    case "ordered":
      return <div className="preview-list ordered" key={key}>{renderInline(block.content)}</div>;
    case "blockquote":
      return <blockquote key={key}>{renderInline(block.content)}</blockquote>;
    case "code":
      return block.infoString === EMBEDDED_LAB_LANGUAGE ? (
        <Suspense
          fallback={
            <div className="lab-loading" key={key} role="status">
              正在准备本地交互实验…
            </div>
          }
          key={key}
        >
          <EmbeddedLab source={block.content} />
        </Suspense>
      ) : (
        <pre key={key}>
          <code className={
            block.infoString === undefined || block.infoString.length === 0
              ? undefined
              : `language-${safeLanguageName(block.infoString)}`
          }>
            {block.content}
          </code>
        </pre>
      );
    case "rule":
      return <hr key={key} />;
    case "blank":
      return <div className="preview-space" key={key} />;
    default:
      return <p key={key}>{renderInline(block.content)}</p>;
  }
}

function safeLanguageName(infoString: string): string {
  return infoString.split(/\s+/, 1)[0]?.replaceAll(/[^a-z0-9_-]/gi, "") ?? "";
}

function renderInline(content: string): ReactNode {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  const parts = content.split(pattern);
  return parts.map((part, index) => {
    const key = `${part}-${index}`;
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (link !== null) {
      return (
        <a href={link[2]} key={key} rel="noreferrer" target="_blank">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}
