import type {
  BlockContent,
  Definition,
  DefinitionContent,
  FootnoteDefinition,
  PhrasingContent,
  RootContent,
} from "mdast";
import type { Position } from "unist";
import {
  Check,
  Copy,
  FileImage,
  Link2,
  ShieldAlert,
} from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { EMBEDDED_LAB_LANGUAGE } from "./embeddedLabModel";
import {
  definitionsFromMarkdown,
  parseCodeFenceInfo,
  parseMarkdownDocument,
  type CalloutNode,
  type MarkdownDocument,
} from "./markdownAst";

const EmbeddedLab = lazy(async () => {
  const module = await import("./EmbeddedLab");
  return { default: module.EmbeddedLab };
});

const MathFormula = lazy(async () => {
  const module = await import("./MathFormula");
  return { default: module.MathFormula };
});

interface MarkdownPreviewProps {
  readonly markdown: string;
  readonly onOpenWikiTarget?: (rawTarget: string) => void;
  readonly sourceNoteId?: string;
}

interface RenderContext {
  readonly definitions: ReadonlyMap<string, Definition>;
  readonly document: MarkdownDocument;
  readonly onOpenWikiTarget?: (rawTarget: string) => void;
  readonly sourceNoteId?: string;
}

export function MarkdownPreview({
  markdown,
  onOpenWikiTarget,
  sourceNoteId,
}: MarkdownPreviewProps) {
  const document = useMemo(() => {
    try {
      return parseMarkdownDocument(markdown);
    } catch {
      return null;
    }
  }, [markdown]);
  const context = useMemo<RenderContext>(
    () => ({
      definitions:
        document === null ? new Map() : definitionsFromMarkdown(document),
      document:
        document ?? {
          root: { children: [], type: "root" },
          source: markdown,
        },
      ...(onOpenWikiTarget === undefined ? {} : { onOpenWikiTarget }),
      ...(sourceNoteId === undefined ? {} : { sourceNoteId }),
    }),
    [document, markdown, onOpenWikiTarget, sourceNoteId],
  );
  const footnotes = (document?.root.children ?? []).filter(
    (node): node is FootnoteDefinition => node.type === "footnoteDefinition",
  );

  if (document === null) {
    return (
      <article
        className="markdown-preview"
        aria-label="Markdown 阅读视图"
        data-context="preview"
      >
        <div className="markdown-preview-document">
          <aside className="preview-parse-fallback" role="alert">
            <strong>Markdown 结构解析失败</strong>
            <p>原文保持不变，已用安全源码视图代替渲染。</p>
            <pre>
              <code>{markdown}</code>
            </pre>
          </aside>
        </div>
      </article>
    );
  }

  return (
    <article
      className="markdown-preview"
      aria-label="Markdown 阅读视图"
      data-context="preview"
    >
      <div className="markdown-preview-document">
        {document.root.children.map((node, index) =>
          renderBlock(node, context, nodeKey(node, index)),
        )}
        {footnotes.length > 0 ? (
          <Footnotes context={context} definitions={footnotes} />
        ) : null}
      </div>
    </article>
  );
}

function renderBlock(
  node: RootContent | BlockContent | DefinitionContent,
  context: RenderContext,
  key: string,
): ReactNode {
  switch (node.type) {
    case "heading": {
      const HeadingTag = `h${node.depth}` as
        | "h1"
        | "h2"
        | "h3"
        | "h4"
        | "h5"
        | "h6";
      return (
        <HeadingTag
          data-source-offset={node.position?.start.offset}
          id={`heading-${node.position?.start.offset ?? key}`}
          key={key}
        >
          {renderPhrasing(node.children, context, key)}
        </HeadingTag>
      );
    }
    case "paragraph":
      return (
        <p data-source-offset={node.position?.start.offset} key={key}>
          {renderPhrasing(node.children, context, key)}
        </p>
      );
    case "blockquote":
      return (
        <blockquote key={key}>
          {node.children.map((child, index) =>
            renderBlock(child, context, nodeKey(child, index, key)),
          )}
        </blockquote>
      );
    case "callout":
      return <Callout context={context} key={key} node={node} />;
    case "list": {
      const ListTag = node.ordered ? "ol" : "ul";
      return (
        <ListTag
          className={node.ordered ? "preview-list ordered" : "preview-list"}
          key={key}
          start={node.ordered ? (node.start ?? undefined) : undefined}
        >
          {node.children.map((item, index) => (
            <li
              className={item.checked == null ? undefined : "preview-task"}
              key={nodeKey(item, index, key)}
            >
              {item.checked == null ? null : (
                <input
                  aria-label={item.checked ? "已完成" : "未完成"}
                  checked={item.checked}
                  disabled
                  type="checkbox"
                />
              )}
              <div className="preview-list-content">
                {item.children.map((child, childIndex) =>
                  renderBlock(
                    child,
                    context,
                    nodeKey(child, childIndex, `${key}-${index}`),
                  ),
                )}
              </div>
            </li>
          ))}
        </ListTag>
      );
    }
    case "table":
      return (
        <div className="preview-table-scroll" key={key} tabIndex={0}>
          <table>
            <thead>
              {node.children.slice(0, 1).map((row, rowIndex) => (
                <tr key={nodeKey(row, rowIndex, key)}>
                  {row.children.map((cell, cellIndex) => (
                    <th
                      key={nodeKey(cell, cellIndex, `${key}-${rowIndex}`)}
                      style={cellAlignment(node.align?.[cellIndex])}
                    >
                      {renderPhrasing(cell.children, context, key)}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {node.children.slice(1).map((row, rowIndex) => (
                <tr key={nodeKey(row, rowIndex, `${key}-body`)}>
                  {row.children.map((cell, cellIndex) => (
                    <td
                      key={nodeKey(cell, cellIndex, `${key}-${rowIndex}`)}
                      style={cellAlignment(node.align?.[cellIndex])}
                    >
                      {renderPhrasing(cell.children, context, key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return node.lang === EMBEDDED_LAB_LANGUAGE ? (
        <Suspense
          fallback={
            <div className="lab-loading" key={key} role="status">
              正在准备本地交互实验…
            </div>
          }
          key={key}
        >
          <EmbeddedLab source={node.value} />
        </Suspense>
      ) : (
        <CodeBlock
          code={node.value}
          key={key}
          language={node.lang}
          meta={node.meta}
        />
      );
    case "inlineMath":
      return <MathNode display={false} key={key} source={node.value} />;
    case "math":
      return <MathNode display key={key} source={node.value} />;
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return (
        <aside className="preview-raw-html" key={key}>
          <div className="preview-security-label">
            <ShieldAlert aria-hidden="true" />
            HTML 已作为不可信源码显示，未执行
          </div>
          <pre>
            <code>{node.value}</code>
          </pre>
        </aside>
      );
    case "yaml":
      return (
        <details className="preview-frontmatter" key={key}>
          <summary>
            文档属性 · YAML
          </summary>
          <pre>
            <code>{node.value}</code>
          </pre>
        </details>
      );
    case "definition":
    case "footnoteDefinition":
      return null;
    default:
      return (
        <pre className="preview-unknown" key={key}>
          <code>{sourceForNode(node, context.document)}</code>
        </pre>
      );
  }
}

function renderPhrasing(
  nodes: readonly PhrasingContent[],
  context: RenderContext,
  parentKey: string,
): ReactNode {
  return nodes.map((node, index) => {
    const key = nodeKey(node, index, parentKey);
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "strong":
        return (
          <strong key={key}>
            {renderPhrasing(node.children, context, key)}
          </strong>
        );
      case "emphasis":
        return (
          <em key={key}>{renderPhrasing(node.children, context, key)}</em>
        );
      case "delete":
        return (
          <del key={key}>{renderPhrasing(node.children, context, key)}</del>
        );
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "inlineMath":
        return <MathNode display={false} key={key} source={node.value} />;
      case "break":
        return <br key={key} />;
      case "link":
        return (
          <SafeLink href={node.url} key={key} title={node.title}>
            {renderPhrasing(node.children, context, key)}
          </SafeLink>
        );
      case "linkReference": {
        const definition = context.definitions.get(
          normalizeIdentifier(node.identifier),
        );
        return definition === undefined ? (
          <span className="preview-broken-link" key={key}>
            {renderPhrasing(node.children, context, key)}
            <span className="sr-only">（链接定义缺失）</span>
          </span>
        ) : (
          <SafeLink
            href={definition.url}
            key={key}
            title={definition.title}
          >
            {renderPhrasing(node.children, context, key)}
          </SafeLink>
        );
      }
      case "image":
        return (
          <ImagePlaceholder
            alt={node.alt}
            key={key}
            title={node.title}
            url={node.url}
          />
        );
      case "imageReference": {
        const definition = context.definitions.get(
          normalizeIdentifier(node.identifier),
        );
        return (
          <ImagePlaceholder
            alt={node.alt}
            key={key}
            title={definition?.title ?? null}
            url={definition?.url ?? node.label ?? node.identifier}
          />
        );
      }
      case "footnoteReference":
        return (
          <sup className="preview-footnote-reference" key={key}>
            <a href={`#footnote-${safeFragment(node.identifier)}`}>
              [{node.label ?? node.identifier}]
            </a>
          </sup>
        );
      case "wikiLink":
        return context.onOpenWikiTarget === undefined ? (
          <span
            className="preview-wiki-link"
            data-context="wiki-link"
            data-note-id={context.sourceNoteId}
            data-wiki-target={node.target}
            key={key}
            title={`知识节点：${node.target}`}
          >
            <Link2 aria-hidden="true" />
            {node.display}
          </span>
        ) : (
          <button
            aria-label={`打开知识节点：${node.display}`}
            className="preview-wiki-link"
            data-context="wiki-link"
            data-note-id={context.sourceNoteId}
            data-wiki-target={node.target}
            key={key}
            onClick={() => context.onOpenWikiTarget?.(node.target)}
            title={`打开知识节点：${node.target}`}
            type="button"
          >
            <Link2 aria-hidden="true" />
            {node.display}
          </button>
        );
      case "wikiEmbed":
        return context.onOpenWikiTarget === undefined ? (
          <span
            className="preview-wiki-embed"
            data-context="wiki-link"
            data-note-id={context.sourceNoteId}
            data-wiki-target={node.target}
            key={key}
            title={`嵌入目标：${node.target}`}
          >
            <FileImage aria-hidden="true" />
            {node.display}
          </span>
        ) : (
          <button
            aria-label={`打开嵌入目标：${node.display}`}
            className="preview-wiki-embed"
            data-context="wiki-link"
            data-note-id={context.sourceNoteId}
            data-wiki-target={node.target}
            key={key}
            onClick={() => context.onOpenWikiTarget?.(node.target)}
            title={`打开嵌入目标：${node.target}`}
            type="button"
          >
            <FileImage aria-hidden="true" />
            {node.display}
          </button>
        );
      default:
        return (
          <Fragment key={key}>
            {sourceForNode(node, context.document)}
          </Fragment>
        );
    }
  });
}

function Callout({
  context,
  node,
}: {
  readonly context: RenderContext;
  readonly node: CalloutNode;
}) {
  const content = node.children.map((child, index) =>
    renderBlock(child, context, nodeKey(child, index, `callout-${node.kind}`)),
  );
  if (node.fold === null) {
    return (
      <aside className={`preview-callout is-${node.kind}`}>
        <div className="preview-callout-title">{node.title}</div>
        <div className="preview-callout-content">{content}</div>
      </aside>
    );
  }
  return (
    <details
      className={`preview-callout is-${node.kind}`}
      open={node.fold === "expanded"}
    >
      <summary className="preview-callout-title">{node.title}</summary>
      <div className="preview-callout-content">{content}</div>
    </details>
  );
}

function CodeBlock({
  code,
  language,
  meta,
}: {
  readonly code: string;
  readonly language: string | null | undefined;
  readonly meta: string | null | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const info = parseCodeFenceInfo(language, meta);
  const label = info.title ?? (info.language || "纯文本");

  async function copyCode() {
    try {
      await copyText(code);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <figure className="preview-code-block">
      <figcaption>
        <span>
          <strong>{label}</strong>
          {info.highlight === null ? null : (
            <span title="高亮行元数据">{info.highlight}</span>
          )}
        </span>
        <button
          aria-label={copied ? "代码已复制" : `复制${label}代码`}
          onClick={() => void copyCode()}
          type="button"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "已复制" : "复制"}
        </button>
      </figcaption>
      <pre>
        <code
          className={
            info.language.length === 0
              ? undefined
              : `language-${info.language}`
          }
        >
          {code}
        </code>
      </pre>
      {info.rawMeta.length > 0 && info.title === null &&
      info.highlight === null ? (
        <div className="preview-code-meta" title="未识别元数据仍保留">
          {info.rawMeta}
        </div>
      ) : null}
    </figure>
  );
}

function MathNode({
  display,
  source,
}: {
  readonly display: boolean;
  readonly source: string;
}) {
  const [copied, setCopied] = useState(false);
  const formula = (
    <Suspense
      fallback={
        <code className={display ? "preview-math-source is-block" : "preview-math-source"}>
          {display ? `$$\n${source}\n$$` : `$${source}$`}
        </code>
      }
    >
      <MathFormula display={display} source={source} />
    </Suspense>
  );
  if (!display) {
    return formula;
  }

  async function copyFormula() {
    try {
      await copyText(source);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <figure className="preview-math-figure">
      <figcaption>
        <span>LaTeX 公式</span>
        <button
          aria-label={copied ? "公式源码已复制" : "复制 LaTeX 源码"}
          onClick={() => void copyFormula()}
          type="button"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "已复制" : "复制源码"}
        </button>
      </figcaption>
      {formula}
    </figure>
  );
}

function SafeLink({
  children,
  href,
  title,
}: {
  readonly children: ReactNode;
  readonly href: string;
  readonly title: string | null | undefined;
}) {
  const safe = safeExternalTarget(href);
  if (safe === null) {
    return (
      <span
        className="preview-blocked-link"
        title={`未打开不受支持的链接目标：${href}`}
      >
        {children}
      </span>
    );
  }
  return (
    <a
      href={safe}
      rel={safe.startsWith("mailto:") ? undefined : "noopener noreferrer"}
      target={safe.startsWith("mailto:") ? undefined : "_blank"}
      title={title ?? `外部链接：${safe}`}
    >
      {children}
    </a>
  );
}

function ImagePlaceholder({
  alt,
  title,
  url,
}: {
  readonly alt: string | null | undefined;
  readonly title: string | null | undefined;
  readonly url: string;
}) {
  return (
    <span
      className="preview-image-placeholder"
      title={title ?? `图片资源尚未加载：${url}`}
    >
      <FileImage aria-hidden="true" />
      <span>{alt?.trim() || "图片"}</span>
      <small>{isRemoteUrl(url) ? "远程资源已阻止" : url}</small>
    </span>
  );
}

function Footnotes({
  context,
  definitions,
}: {
  readonly context: RenderContext;
  readonly definitions: readonly FootnoteDefinition[];
}) {
  return (
    <section className="preview-footnotes" aria-label="脚注">
      <h2>脚注</h2>
      <ol>
        {definitions.map((definition, index) => (
          <li
            id={`footnote-${safeFragment(definition.identifier)}`}
            key={nodeKey(definition, index, "footnote")}
          >
            {definition.children.map((child, childIndex) =>
              renderBlock(
                child,
                context,
                nodeKey(child, childIndex, definition.identifier),
              ),
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function cellAlignment(
  align: "center" | "left" | "right" | null | undefined,
): { readonly textAlign: "center" | "left" | "right" } | undefined {
  return align === null || align === undefined
    ? undefined
    : { textAlign: align };
}

function sourceForNode(
  node: { readonly position?: Position | null | undefined },
  document: MarkdownDocument,
): string {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  return from === undefined || to === undefined
    ? ""
    : document.source.slice(from, to);
}

function nodeKey(
  node: {
    readonly type: string;
    readonly position?: Position | null | undefined;
  },
  index: number,
  prefix = "",
): string {
  return `${prefix}-${node.type}-${node.position?.start.offset ?? index}`;
}

function safeExternalTarget(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function isRemoteUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function normalizeIdentifier(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}

function safeFragment(value: string): string {
  return encodeURIComponent(value.trim().toLocaleLowerCase()).replaceAll("%", "-");
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) {
    throw new Error("Clipboard copy was rejected");
  }
}
