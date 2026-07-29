export type ViewKey =
  | "today"
  | "continue"
  | "topics"
  | "sources"
  | "experiments"
  | "review"
  | "versions";

export interface LearningNote {
  readonly id: string;
  readonly title: string;
  readonly view: Exclude<ViewKey, "versions">;
  readonly kind?: "journal" | "learning_node" | "note";
  readonly journalDate?: string;
  readonly path?: string;
  readonly revision?: string;
  readonly lineEnding?: "none" | "lf" | "crlf" | "cr" | "mixed";
  readonly hasUtf8Bom?: boolean;
  readonly markdown: string;
  readonly updatedAt: string;
}

export interface TextDelta {
  readonly prefixLength: number;
  readonly deleteCount: number;
  readonly insertedText: string;
}

export interface NoteSnapshot {
  readonly id: string;
  readonly noteId: string;
  readonly noteTitle: string;
  readonly parentId: string | null;
  readonly delta: TextDelta;
  readonly contentLength: number;
  readonly createdAt: string;
  readonly contentHash?: string;
  readonly message?: string;
}

export interface WorkspaceState {
  readonly notes: readonly LearningNote[];
  readonly selectedNoteId: string;
  readonly completedChecks: Readonly<Record<string, boolean>>;
  readonly snapshots: readonly NoteSnapshot[];
  readonly versionHeads: Readonly<Record<string, string>>;
}

export const WORKSPACE_STORAGE_KEY = "zhiweave.workspace.v1";

export const VIEW_COPY: Readonly<
  Record<ViewKey, { readonly label: string; readonly description: string }>
> = {
  today: {
    label: "今天",
    description: "把今天最重要的一件事做完。",
  },
  continue: {
    label: "学习",
    description: "回到上次停下的位置。",
  },
  topics: {
    label: "知识库",
    description: "围绕问题组织可持续生长的知识树。",
  },
  sources: {
    label: "收集箱",
    description: "记录证据、出处、观点与尚未解决的疑问。",
  },
  experiments: {
    label: "实验",
    description: "用可复现步骤验证代码与想法。",
  },
  review: {
    label: "复习",
    description: "用主动回忆检查真正掌握的内容。",
  },
  versions: {
    label: "版本",
    description: "手动保存关键节点，需要时恢复。",
  },
};

const INITIAL_NOTES: readonly LearningNote[] = [
  {
    id: "welcome",
    title: "欢迎来到知织",
    view: "continue",
    updatedAt: "2026-07-29T14:00:00.000Z",
    markdown: `# 欢迎来到知织

## 当前理解

知织把问题、证据、代码、论文、英文和复习织成一张可以持续修正的知识网络。

## 待探索

- [x] 验证 Windows Markdown 编辑器
- [ ] 验证 Android 中文输入法和软键盘
- [ ] 接入客户端密码保护的 Stronghold
- [ ] 接入本地 SQLite 与原子文件保存
`,
  },
  {
    id: "today-plan",
    title: "今天的学习计划",
    view: "today",
    updatedAt: "2026-07-29T14:01:00.000Z",
    markdown: `# 今天的学习计划

## 唯一目标

找出一个可以在 45 分钟内回答的问题，并留下证据。

## 完成条件

- [ ] 写出问题
- [ ] 阅读一份可靠资料
- [ ] 用自己的话解释
- [ ] 创建一个手动版本
`,
  },
  {
    id: "english-learning",
    title: "ownership",
    view: "topics",
    updatedAt: "2026-07-29T14:02:00.000Z",
    markdown: `# ownership

## 一句话理解

Ownership describes who is responsible for a value and when that value is released.

## 主动回忆

- 不看资料解释 owner、borrow 和 lifetime 的关系。
- 各写一个正确例子和一个错误例子。
`,
  },
  {
    id: "paper-reading",
    title: "论文阅读",
    view: "sources",
    updatedAt: "2026-07-29T14:03:00.000Z",
    markdown: `# 论文阅读

## 研究问题

作者究竟试图证明什么？

## 证据检查

- 数据集是否能代表目标人群？
- 基线是否公平？
- 结果是否可以复现？
- 结论是否超出证据范围？
`,
  },
  {
    id: "programming-experiment",
    title: "同步健康检查",
    view: "experiments",
    updatedAt: "2026-07-29T14:04:00.000Z",
    markdown: `# 同步健康检查

## 假设

客户端可以在五秒内确认服务端协议版本。

## 重现步骤

1. 启动服务端。
2. 请求 \`/health\`。
3. 验证协议为 \`ZHIWEAVE/1\`。

## 结果

等待执行。
`,
  },
  {
    id: "review-card",
    title: "为什么离线优先？",
    view: "review",
    updatedAt: "2026-07-29T14:05:00.000Z",
    markdown: `# 为什么离线优先？

先在不看笔记的情况下回答：

1. 网络不可用时应该发生什么？
2. 哪一份数据是事实来源？
3. 多端冲突为什么不能静默覆盖？

完成回答后，再与架构文档核对。
`,
  },
];

const INITIAL_CHECKS: Readonly<Record<string, boolean>> = {
  "windows-input": true,
  "android-input": false,
  "stronghold-unlock": false,
  "sqlite-search": false,
};

export function createInitialWorkspace(): WorkspaceState {
  return {
    notes: INITIAL_NOTES.map((note) => ({
      ...note,
      title: titleFromMarkdown(note.markdown, note.title),
    })),
    selectedNoteId: "welcome",
    completedChecks: { ...INITIAL_CHECKS },
    snapshots: [],
    versionHeads: {},
  };
}

export function parseWorkspace(raw: string | null): WorkspaceState {
  if (raw === null) {
    return createInitialWorkspace();
  }

  try {
    const value: unknown = JSON.parse(raw);
    const normalized = normalizeWorkspace(value);
    if (normalized === undefined) {
      return createInitialWorkspace();
    }
    return {
      ...normalized,
      notes: normalized.notes.map((note) => ({
        ...note,
        title: titleFromMarkdown(note.markdown, note.title),
      })),
    };
  } catch {
    return createInitialWorkspace();
  }
}

export function notesForView(
  notes: readonly LearningNote[],
  view: ViewKey,
): readonly LearningNote[] {
  if (view === "versions") {
    return notes;
  }
  return notes.filter((note) => note.view === view);
}

export function searchNotes(
  notes: readonly LearningNote[],
  query: string,
): readonly LearningNote[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) {
    return [];
  }
  return notes
    .filter((note) =>
      `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(normalized),
    )
    .slice(0, 8);
}

export function createLearningPrompt(note: LearningNote): string {
  return `你是我的严谨学习伙伴。请围绕“${note.title}”帮助我学习。

要求：
1. 先检查我的理解中有哪些事实、推测和缺口；
2. 每次只推进一个关键问题，并要求我先主动回答；
3. 对编程给出可运行的最小实验，对论文追问证据，对英语纠正表达并提供语境；
4. 不要直接替我完成全部思考；
5. 最后给出可复制回 Markdown 的“当前结论、证据、反例、下一步”。

我的当前笔记如下：

${note.markdown}`;
}

export function titleFromMarkdown(
  markdown: string,
  fallback: string,
): string {
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = /^#(?!#)\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading === null) {
      continue;
    }
    const title = (heading[1] ?? "")
      .replaceAll(/[*_`~]/g, "")
      .trim()
      .slice(0, 200);
    if (title.length > 0) {
      return title;
    }
  }
  return fallback;
}

export function createBlankNote(
  title: string,
  view: Exclude<ViewKey, "versions">,
  now = new Date(),
): LearningNote {
  const normalizedTitle = title.trim();
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `note-${now.getTime().toString(36)}`;
  return {
    id,
    title: normalizedTitle,
    view,
    kind: "note",
    updatedAt: now.toISOString(),
    markdown: `# ${normalizedTitle}

## 我想解决的问题


## 当前理解


## 证据与例子


## 下一步

- [ ] 写下一个可以立即执行的动作
`,
  };
}

export function addSnapshot(
  workspace: WorkspaceState,
  note: LearningNote,
  now = new Date(),
): WorkspaceState {
  const parentId =
    workspace.versionHeads[note.id] ??
    workspace.snapshots.find((snapshot) => snapshot.noteId === note.id)?.id ??
    null;
  const parentMarkdown =
    parentId === null
      ? ""
      : resolveSnapshotMarkdown(workspace, parentId) ?? "";
  const snapshot: NoteSnapshot = {
    id: `${note.id}-${now.getTime().toString(36)}`,
    noteId: note.id,
    noteTitle: note.title,
    parentId,
    delta: createTextDelta(parentMarkdown, note.markdown),
    contentLength: note.markdown.length,
    createdAt: now.toISOString(),
  };
  return {
    ...workspace,
    snapshots: [snapshot, ...workspace.snapshots],
    versionHeads: {
      ...workspace.versionHeads,
      [note.id]: snapshot.id,
    },
  };
}

export function restoreSnapshot(
  workspace: WorkspaceState,
  snapshotId: string,
  now = new Date(),
): WorkspaceState {
  const snapshot = workspace.snapshots.find((item) => item.id === snapshotId);
  if (snapshot === undefined) {
    return workspace;
  }
  const markdown = resolveSnapshotMarkdown(workspace, snapshotId);
  if (markdown === undefined) {
    return workspace;
  }
  return {
    ...workspace,
    selectedNoteId: snapshot.noteId,
    versionHeads: {
      ...workspace.versionHeads,
      [snapshot.noteId]: snapshot.id,
    },
    notes: workspace.notes.map((note) =>
      note.id === snapshot.noteId
        ? {
            ...note,
            markdown,
            updatedAt: now.toISOString(),
          }
        : note,
    ),
  };
}

export function createTextDelta(base: string, target: string): TextDelta {
  let prefixLength = 0;
  const maximumPrefix = Math.min(base.length, target.length);
  while (
    prefixLength < maximumPrefix &&
    base[prefixLength] === target[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maximumSuffix = Math.min(
    base.length - prefixLength,
    target.length - prefixLength,
  );
  while (
    suffixLength < maximumSuffix &&
    base[base.length - suffixLength - 1] ===
      target[target.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return {
    prefixLength,
    deleteCount: base.length - prefixLength - suffixLength,
    insertedText: target.slice(
      prefixLength,
      target.length - suffixLength,
    ),
  };
}

export function applyTextDelta(
  base: string,
  delta: TextDelta,
): string | undefined {
  if (
    delta.prefixLength < 0 ||
    delta.deleteCount < 0 ||
    delta.prefixLength + delta.deleteCount > base.length
  ) {
    return undefined;
  }
  return (
    base.slice(0, delta.prefixLength) +
    delta.insertedText +
    base.slice(delta.prefixLength + delta.deleteCount)
  );
}

export function resolveSnapshotMarkdown(
  workspace: Pick<WorkspaceState, "snapshots">,
  snapshotId: string,
): string | undefined {
  const snapshots = new Map(
    workspace.snapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  const chain: NoteSnapshot[] = [];
  const visited = new Set<string>();
  let current = snapshots.get(snapshotId);

  while (current !== undefined) {
    if (visited.has(current.id)) {
      return undefined;
    }
    visited.add(current.id);
    chain.push(current);
    if (current.parentId === null) {
      break;
    }
    current = snapshots.get(current.parentId);
  }

  if (
    chain.length === 0 ||
    chain[chain.length - 1]?.parentId !== null
  ) {
    return undefined;
  }

  let markdown = "";
  for (const snapshot of chain.reverse()) {
    const next = applyTextDelta(markdown, snapshot.delta);
    if (next === undefined || next.length !== snapshot.contentLength) {
      return undefined;
    }
    markdown = next;
  }
  return markdown;
}

export function deleteSnapshot(
  workspace: WorkspaceState,
  snapshotId: string,
): WorkspaceState {
  const target = workspace.snapshots.find(
    (snapshot) => snapshot.id === snapshotId,
  );
  if (target === undefined) {
    return workspace;
  }

  const childMarkdown = new Map<string, string>();
  for (const child of workspace.snapshots) {
    if (child.parentId === target.id) {
      const markdown = resolveSnapshotMarkdown(workspace, child.id);
      if (markdown === undefined) {
        return workspace;
      }
      childMarkdown.set(child.id, markdown);
    }
  }
  const newParentMarkdown =
    target.parentId === null
      ? ""
      : resolveSnapshotMarkdown(workspace, target.parentId);
  if (newParentMarkdown === undefined) {
    return workspace;
  }

  const snapshots = workspace.snapshots
    .filter((snapshot) => snapshot.id !== target.id)
    .map((snapshot) => {
      const markdown = childMarkdown.get(snapshot.id);
      if (markdown === undefined) {
        return snapshot;
      }
      return {
        ...snapshot,
        parentId: target.parentId,
        delta: createTextDelta(newParentMarkdown, markdown),
      };
    });
  const versionHeads = { ...workspace.versionHeads };
  if (versionHeads[target.noteId] === target.id) {
    if (target.parentId === null) {
      delete versionHeads[target.noteId];
    } else {
      versionHeads[target.noteId] = target.parentId;
    }
  }
  return {
    ...workspace,
    snapshots,
    versionHeads,
  };
}

export function snapshotStorageBytes(snapshot: NoteSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot.delta)).length;
}

export function openOrCreateDailyJournal(
  workspace: WorkspaceState,
  now = new Date(),
): { readonly workspace: WorkspaceState; readonly note: LearningNote } {
  const journalDate = formatLocalDate(now);
  const existing = workspace.notes.find(
    (note) =>
      note.kind === "journal" && note.journalDate === journalDate,
  );
  if (existing !== undefined) {
    return {
      note: existing,
      workspace: {
        ...workspace,
        selectedNoteId: existing.id,
      },
    };
  }

  const note: LearningNote = {
    id: `journal-${journalDate}`,
    title: `${journalDate} 日记`,
    view: "today",
    kind: "journal",
    journalDate,
    updatedAt: now.toISOString(),
    markdown: `# ${journalDate} 日记

## 今日记录


## 学到什么


## 明天继续

- [ ]
`,
  };
  return {
    note,
    workspace: {
      ...workspace,
      notes: [note, ...workspace.notes],
      selectedNoteId: note.id,
    },
  };
}

function normalizeWorkspace(value: unknown): WorkspaceState | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<WorkspaceState> & {
    readonly snapshots?: readonly unknown[];
  };
  const validBase =
    typeof candidate.selectedNoteId === "string" &&
    Array.isArray(candidate.notes) &&
    candidate.notes.length > 0 &&
    candidate.notes.every(isLearningNote) &&
    candidate.notes.some((note) => note.id === candidate.selectedNoteId) &&
    typeof candidate.completedChecks === "object" &&
    candidate.completedChecks !== null &&
    Array.isArray(candidate.snapshots);
  if (!validBase || candidate.snapshots === undefined) {
    return undefined;
  }

  const snapshots = normalizeSnapshots(candidate.snapshots);
  if (snapshots === undefined) {
    return undefined;
  }
  const versionHeads = isVersionHeads(candidate.versionHeads)
    ? candidate.versionHeads
    : deriveVersionHeads(snapshots);
  return {
    notes: candidate.notes,
    selectedNoteId: candidate.selectedNoteId,
    completedChecks: candidate.completedChecks,
    snapshots,
    versionHeads,
  };
}

function isSnapshot(value: unknown): value is NoteSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<NoteSnapshot>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.noteId === "string" &&
    typeof candidate.noteTitle === "string" &&
    (candidate.parentId === null || typeof candidate.parentId === "string") &&
    isTextDelta(candidate.delta) &&
    typeof candidate.contentLength === "number" &&
    Number.isSafeInteger(candidate.contentLength) &&
    candidate.contentLength >= 0 &&
    typeof candidate.createdAt === "string"
  );
}

interface LegacySnapshot {
  readonly id: string;
  readonly noteId: string;
  readonly noteTitle: string;
  readonly markdown: string;
  readonly createdAt: string;
}

function isLegacySnapshot(value: unknown): value is LegacySnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<LegacySnapshot>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.noteId === "string" &&
    typeof candidate.noteTitle === "string" &&
    typeof candidate.markdown === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function normalizeSnapshots(
  values: readonly unknown[],
): readonly NoteSnapshot[] | undefined {
  if (values.every(isSnapshot)) {
    return values;
  }
  if (!values.every(isLegacySnapshot)) {
    return undefined;
  }

  const parentByNote = new Map<string, NoteSnapshot>();
  const convertedById = new Map<string, NoteSnapshot>();
  for (const legacy of [...values].reverse()) {
    const parent = parentByNote.get(legacy.noteId);
    const parentMarkdown =
      parent === undefined
        ? ""
        : resolveSnapshotMarkdown(
            { snapshots: [...convertedById.values()] },
            parent.id,
          ) ?? "";
    const converted: NoteSnapshot = {
      id: legacy.id,
      noteId: legacy.noteId,
      noteTitle: legacy.noteTitle,
      parentId: parent?.id ?? null,
      delta: createTextDelta(parentMarkdown, legacy.markdown),
      contentLength: legacy.markdown.length,
      createdAt: legacy.createdAt,
    };
    parentByNote.set(legacy.noteId, converted);
    convertedById.set(converted.id, converted);
  }
  return values.map((legacy) => convertedById.get(legacy.id)!);
}

function deriveVersionHeads(
  snapshots: readonly NoteSnapshot[],
): Readonly<Record<string, string>> {
  const heads: Record<string, string> = {};
  for (const snapshot of snapshots) {
    heads[snapshot.noteId] ??= snapshot.id;
  }
  return heads;
}

function isTextDelta(value: unknown): value is TextDelta {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<TextDelta>;
  return (
    typeof candidate.prefixLength === "number" &&
    Number.isSafeInteger(candidate.prefixLength) &&
    candidate.prefixLength >= 0 &&
    typeof candidate.deleteCount === "number" &&
    Number.isSafeInteger(candidate.deleteCount) &&
    candidate.deleteCount >= 0 &&
    typeof candidate.insertedText === "string"
  );
}

function isVersionHeads(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((head) => typeof head === "string")
  );
}

function isLearningNote(value: unknown): value is LearningNote {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<LearningNote>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.markdown === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.path === undefined || typeof candidate.path === "string") &&
    (candidate.revision === undefined ||
      typeof candidate.revision === "string") &&
    (candidate.lineEnding === undefined ||
      candidate.lineEnding === "none" ||
      candidate.lineEnding === "lf" ||
      candidate.lineEnding === "crlf" ||
      candidate.lineEnding === "cr" ||
      candidate.lineEnding === "mixed") &&
    (candidate.hasUtf8Bom === undefined ||
      typeof candidate.hasUtf8Bom === "boolean") &&
    (candidate.kind === undefined ||
      candidate.kind === "journal" ||
      candidate.kind === "learning_node" ||
      candidate.kind === "note") &&
    (candidate.journalDate === undefined ||
      typeof candidate.journalDate === "string") &&
    (candidate.view === "today" ||
      candidate.view === "continue" ||
      candidate.view === "topics" ||
      candidate.view === "sources" ||
      candidate.view === "experiments" ||
      candidate.view === "review")
  );
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
