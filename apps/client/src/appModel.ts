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
  readonly markdown: string;
  readonly updatedAt: string;
}

export interface NoteSnapshot {
  readonly id: string;
  readonly noteId: string;
  readonly noteTitle: string;
  readonly markdown: string;
  readonly createdAt: string;
}

export interface WorkspaceState {
  readonly notes: readonly LearningNote[];
  readonly selectedNoteId: string;
  readonly completedChecks: Readonly<Record<string, boolean>>;
  readonly snapshots: readonly NoteSnapshot[];
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
    label: "继续学习",
    description: "回到上次停下的位置。",
  },
  topics: {
    label: "学习主题",
    description: "围绕问题组织可持续生长的知识树。",
  },
  sources: {
    label: "资料与论文",
    description: "记录证据、出处、观点与尚未解决的疑问。",
  },
  experiments: {
    label: "实验与记录",
    description: "用可复现步骤验证代码与想法。",
  },
  review: {
    label: "复习",
    description: "用主动回忆检查真正掌握的内容。",
  },
  versions: {
    label: "版本控制",
    description: "手动保存关键节点，需要时恢复。",
  },
};

const INITIAL_NOTES: readonly LearningNote[] = [
  {
    id: "welcome",
    title: "独立跨平台架构",
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
    title: "技术英语：ownership",
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
    title: "论文阅读：先判断证据",
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
    title: "编程实验：同步健康检查",
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
    title: "主动回忆：为什么离线优先",
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
    notes: INITIAL_NOTES.map((note) => ({ ...note })),
    selectedNoteId: "welcome",
    completedChecks: { ...INITIAL_CHECKS },
    snapshots: [],
  };
}

export function parseWorkspace(raw: string | null): WorkspaceState {
  if (raw === null) {
    return createInitialWorkspace();
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isWorkspace(value)) {
      return createInitialWorkspace();
    }
    return value;
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
  const snapshot: NoteSnapshot = {
    id: `${note.id}-${now.getTime().toString(36)}`,
    noteId: note.id,
    noteTitle: note.title,
    markdown: note.markdown,
    createdAt: now.toISOString(),
  };
  return {
    ...workspace,
    snapshots: [snapshot, ...workspace.snapshots].slice(0, 30),
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
  return {
    ...workspace,
    selectedNoteId: snapshot.noteId,
    notes: workspace.notes.map((note) =>
      note.id === snapshot.noteId
        ? {
            ...note,
            markdown: snapshot.markdown,
            updatedAt: now.toISOString(),
          }
        : note,
    ),
  };
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<WorkspaceState>;
  return (
    typeof candidate.selectedNoteId === "string" &&
    Array.isArray(candidate.notes) &&
    candidate.notes.length > 0 &&
    candidate.notes.every(isLearningNote) &&
    candidate.notes.some((note) => note.id === candidate.selectedNoteId) &&
    typeof candidate.completedChecks === "object" &&
    candidate.completedChecks !== null &&
    Array.isArray(candidate.snapshots) &&
    candidate.snapshots.every(isSnapshot)
  );
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
    typeof candidate.markdown === "string" &&
    typeof candidate.createdAt === "string"
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
    (candidate.view === "today" ||
      candidate.view === "continue" ||
      candidate.view === "topics" ||
      candidate.view === "sources" ||
      candidate.view === "experiments" ||
      candidate.view === "review")
  );
}
