import { Image, Link2, X } from "lucide-react";
import { useMemo } from "react";

import type { NativeBacklinkReference } from "./workspaceClient";

type BacklinksState = "idle" | "loading" | "ready" | "error";

interface BacklinksPanelProps {
  readonly noteId: string;
  readonly references: readonly NativeBacklinkReference[];
  readonly state: BacklinksState;
  readonly onClose: () => void;
  readonly onOpen: (reference: NativeBacklinkReference) => void;
}

interface BacklinkGroup {
  readonly noteId: string;
  readonly path: string;
  readonly title: string;
  readonly references: readonly NativeBacklinkReference[];
}

export function BacklinksPanel({
  noteId,
  references,
  state,
  onClose,
  onOpen,
}: BacklinksPanelProps) {
  const groups = useMemo(() => groupReferences(references), [references]);

  return (
    <aside
      aria-busy={state === "loading"}
      aria-label="当前知识节点的反向链接"
      className="backlinks-panel"
      data-context="backlinks"
      data-note-id={noteId}
    >
      <header>
        <span>
          <Link2 />
          <strong>反向链接</strong>
          {state === "ready" && references.length > 0 ? (
            <small>{references.length}</small>
          ) : null}
        </span>
        <button
          aria-label="关闭反向链接"
          onClick={onClose}
          title="关闭反向链接"
          type="button"
        >
          <X />
        </button>
      </header>

      <div className="backlinks-panel-body">
        {state === "loading" ? (
          <p className="backlinks-panel-message">正在读取本地关系索引…</p>
        ) : state === "error" ? (
          <p className="backlinks-panel-message is-error">
            关系索引暂时不可用。Markdown 正文未受影响，可从状态栏重建索引。
          </p>
        ) : references.length === 0 ? (
          <p className="backlinks-panel-message">
            暂无其他笔记引用这个知识节点。可在 Markdown 中输入
            <code>[[节点名称]]</code> 建立关系。
          </p>
        ) : (
          <nav aria-label="引用当前知识节点的笔记">
            {groups.map((group) => (
              <section className="backlink-source" key={group.noteId}>
                <header title={group.path}>
                  <strong>{group.title}</strong>
                  <small>{group.references.length}</small>
                </header>
                {group.references.map((reference) => (
                  <button
                    data-context="note-item"
                    data-note-id={reference.sourceNoteId}
                    key={`${reference.sourceNoteId}-${reference.sourceByteStart}`}
                    onClick={() => onOpen(reference)}
                    title={`打开 ${reference.sourcePath}，定位到第 ${reference.line} 行`}
                    type="button"
                  >
                    <span className="backlink-location">
                      {reference.referenceKind === "embed" ? (
                        <Image aria-hidden="true" />
                      ) : (
                        <Link2 aria-hidden="true" />
                      )}
                      <span>
                        {reference.referenceKind === "embed" ? "嵌入" : "链接"}
                        <i>行 {reference.line}，列 {reference.column}</i>
                      </span>
                    </span>
                    <span className="backlink-context">{reference.context}</span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}

function groupReferences(
  references: readonly NativeBacklinkReference[],
): readonly BacklinkGroup[] {
  const groups = new Map<string, BacklinkGroup>();
  for (const reference of references) {
    const current = groups.get(reference.sourceNoteId);
    if (current === undefined) {
      groups.set(reference.sourceNoteId, {
        noteId: reference.sourceNoteId,
        path: reference.sourcePath,
        title: reference.sourceTitle,
        references: [reference],
      });
      continue;
    }
    groups.set(reference.sourceNoteId, {
      ...current,
      references: [...current.references, reference],
    });
  }
  return [...groups.values()];
}
