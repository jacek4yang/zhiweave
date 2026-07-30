export type CommandScope =
  | "activity"
  | "attachment"
  | "backlinks"
  | "editor"
  | "embedded-lab"
  | "explorer"
  | "input"
  | "note-item"
  | "outline"
  | "preview"
  | "status"
  | "tab"
  | "titlebar"
  | "version-node"
  | "wiki-link"
  | "workspace";

export type CommandId =
  | "attachment.confirmImport"
  | "attachment.copyTarget"
  | "attachment.import"
  | "backup.create"
  | "backup.restore"
  | "backup.verify"
  | "dialog.closeExternalChanges"
  | "dialog.closeAttachmentImport"
  | "dialog.closeNewNote"
  | "edit.copy"
  | "edit.cut"
  | "edit.paste"
  | "edit.redo"
  | "edit.selectAll"
  | "edit.undo"
  | "note.copyLearningPrompt"
  | "note.copyMarkdown"
  | "note.copyPlainText"
  | "note.copyTitle"
  | "note.open"
  | "note.openSplit"
  | "note.rename"
  | "note.showVersions"
  | "retention.apply"
  | "retention.preview"
  | "tab.close"
  | "tab.closeOthers"
  | "tab.next"
  | "tab.previous"
  | "tab.reopenClosed"
  | "version.copyMarkdown"
  | "version.delete"
  | "version.openNote"
  | "version.restore"
  | "version.save"
  | "version.toggleCheckpoint"
  | "view.continue"
  | "view.edit"
  | "view.experiments"
  | "view.preview"
  | "view.review"
  | "view.sources"
  | "view.split"
  | "view.toggleBacklinks"
  | "view.toggleLivePreview"
  | "view.toggleOutline"
  | "view.today"
  | "view.topics"
  | "view.versions"
  | "window.close"
  | "window.maximize"
  | "window.minimize"
  | "workbench.commandPalette"
  | "workbench.clearQuickOpen"
  | "workbench.quickOpen"
  | "workbench.toggleSidebar"
  | "workspace.copyRoot"
  | "workspace.applyExternalChanges"
  | "workspace.confirmCreateNote"
  | "workspace.createNote"
  | "workspace.createUuidLab"
  | "workspace.openExternalChanges"
  | "workspace.openToday"
  | "workspace.recoverAndApplyExternalChanges"
  | "workspace.rebuildIndex"
  | "workspace.resetPreview"
  | "workspace.resolveSave"
  | "workspace.save"
  | "wiki.copyTarget"
  | "wiki.open";

export type CommandCapability =
  | "attachmentImport"
  | "attachmentImportDialog"
  | "attachmentImportReady"
  | "attachmentTarget"
  | "backup"
  | "backupIdle"
  | "browser"
  | "closedTabs"
  | "externalApplySafe"
  | "externalChanges"
  | "externalDialog"
  | "externalRecovery"
  | "inputTarget"
  | "multiTabs"
  | "native"
  | "newNoteDialog"
  | "newNoteReady"
  | "note"
  | "noteRename"
  | "redo"
  | "retentionPreview"
  | "root"
  | "saveRecovery"
  | "selection"
  | "snapshot"
  | "tab"
  | "query"
  | "undo"
  | "wikiTarget";

export interface CommandContext {
  readonly scope?: CommandScope;
  readonly capabilities: ReadonlySet<CommandCapability>;
}

export interface CommandShortcut {
  readonly key: string;
  readonly primary?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly label: string;
}

export interface CommandDefinition {
  readonly id: CommandId;
  readonly title: string;
  readonly category: string;
  readonly group: string;
  readonly keywords: readonly string[];
  readonly contexts: readonly CommandScope[];
  readonly palette: boolean;
  readonly shortcut?: CommandShortcut;
  readonly visibleRequires?: readonly CommandCapability[];
  readonly enabledRequires?: readonly CommandCapability[];
  readonly dangerous?: boolean;
  readonly order: number;
}

export interface ResolvedCommand extends CommandDefinition {
  readonly enabled: boolean;
}

export interface KeyboardChord {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented?: boolean;
  readonly isComposing?: boolean;
}

const WORKSPACE_SCOPES: readonly CommandScope[] = [
  "workspace",
  "activity",
  "explorer",
];
const NOTE_SCOPES: readonly CommandScope[] = ["note-item", "tab"];
const DOCUMENT_SCOPES: readonly CommandScope[] = [
  "backlinks",
  "editor",
  "preview",
  "embedded-lab",
  "outline",
];
const CONTEXT_ORDER: Readonly<Record<CommandScope, readonly CommandId[]>> = {
  activity: [
    "workspace.createNote",
    "workspace.openToday",
    "workspace.createUuidLab",
    "backup.create",
    "workbench.toggleSidebar",
  ],
  attachment: ["attachment.copyTarget"],
  backlinks: [
    "view.toggleBacklinks",
    "view.toggleOutline",
    "view.toggleLivePreview",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "version.save",
    "view.edit",
    "view.split",
    "view.preview",
    "note.showVersions",
  ],
  editor: [
    "edit.copy",
    "edit.undo",
    "edit.redo",
    "attachment.import",
    "version.save",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "view.edit",
    "view.split",
    "view.preview",
    "view.toggleLivePreview",
    "view.toggleBacklinks",
    "view.toggleOutline",
    "note.showVersions",
  ],
  "embedded-lab": [
    "edit.copy",
    "version.save",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "view.edit",
    "view.split",
    "view.preview",
    "view.toggleLivePreview",
    "view.toggleBacklinks",
    "view.toggleOutline",
    "note.showVersions",
  ],
  explorer: [
    "workspace.createNote",
    "workspace.openToday",
    "workspace.createUuidLab",
    "backup.create",
    "workbench.quickOpen",
    "workbench.toggleSidebar",
  ],
  input: ["edit.copy", "edit.cut", "edit.paste", "edit.selectAll"],
  "note-item": [
    "note.open",
    "note.openSplit",
    "note.copyTitle",
    "note.rename",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "version.save",
    "note.showVersions",
  ],
  outline: [
    "view.toggleOutline",
    "view.toggleBacklinks",
    "view.toggleLivePreview",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "version.save",
    "view.edit",
    "view.split",
    "view.preview",
    "note.showVersions",
  ],
  preview: [
    "edit.copy",
    "version.save",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "view.edit",
    "view.split",
    "view.preview",
    "view.toggleLivePreview",
    "view.toggleBacklinks",
    "view.toggleOutline",
    "note.showVersions",
  ],
  status: [
    "workspace.resolveSave",
    "workspace.copyRoot",
    "workspace.openExternalChanges",
    "workspace.rebuildIndex",
    "workspace.resetPreview",
  ],
  tab: [
    "note.open",
    "note.openSplit",
    "note.copyTitle",
    "note.rename",
    "note.copyMarkdown",
    "note.copyPlainText",
    "note.copyLearningPrompt",
    "version.save",
    "note.showVersions",
    "tab.close",
    "tab.closeOthers",
    "tab.reopenClosed",
  ],
  titlebar: ["window.minimize", "window.maximize", "window.close"],
  "version-node": [
    "version.restore",
    "version.copyMarkdown",
    "version.toggleCheckpoint",
    "version.openNote",
    "version.delete",
  ],
  "wiki-link": ["wiki.open", "wiki.copyTarget"],
  workspace: [
    "workspace.createNote",
    "workspace.openToday",
    "workspace.createUuidLab",
    "backup.create",
    "workbench.toggleSidebar",
  ],
};

export const COMMANDS: readonly CommandDefinition[] = [
  command("workbench.commandPalette", "显示命令面板", "工作台", "workbench", 10, {
    keywords: ["command", "命令", "操作"],
    palette: false,
    shortcut: shortcut("p", "Ctrl+Shift+P", { shift: true }),
  }),
  command("workbench.quickOpen", "快速打开知识节点", "工作台", "workbench", 20, {
    contexts: ["explorer"],
    keywords: ["quick open", "搜索", "查找", "文件"],
    shortcut: shortcut("p", "Ctrl+P"),
  }),
  command("workbench.toggleSidebar", "显示或隐藏笔记栏", "工作台", "workbench", 30, {
    contexts: WORKSPACE_SCOPES,
    keywords: ["sidebar", "侧栏", "explorer"],
    shortcut: shortcut("b", "Ctrl+B"),
  }),
  command("workspace.createNote", "新建知识节点", "知识节点", "workspace", 40, {
    contexts: WORKSPACE_SCOPES,
    keywords: ["new note", "笔记", "学习节点"],
    shortcut: shortcut("n", "Ctrl+N"),
  }),
  command(
    "workspace.confirmCreateNote",
    "创建填写的知识节点",
    "知识节点",
    "dialog",
    41,
    {
      palette: false,
      visibleRequires: ["newNoteDialog"],
      enabledRequires: ["newNoteReady"],
    },
  ),
  command("dialog.closeNewNote", "取消新建知识节点", "对话框", "dialog", 42, {
    palette: false,
    visibleRequires: ["newNoteDialog"],
  }),
  command("workspace.openToday", "打开今日日记", "知识节点", "workspace", 50, {
    contexts: WORKSPACE_SCOPES,
    keywords: ["daily", "journal", "今天"],
  }),
  command(
    "workbench.clearQuickOpen",
    "清除快速打开查询",
    "工作台",
    "workbench",
    51,
    {
      palette: false,
      enabledRequires: ["query"],
    },
  ),
  command(
    "workspace.createUuidLab",
    "新建 UUID 交互实验",
    "交互实验",
    "workspace",
    60,
    {
      contexts: WORKSPACE_SCOPES,
      keywords: ["uuid", "lab", "实验"],
    },
  ),
  command("workspace.save", "立即保存当前 Markdown", "文件", "document", 70, {
    keywords: ["save", "保存", "markdown"],
    shortcut: shortcut("s", "Ctrl+S"),
  }),
  command("version.save", "保存当前节点的版本", "版本", "document", 80, {
    contexts: [...DOCUMENT_SCOPES, ...NOTE_SCOPES],
    keywords: ["snapshot", "commit", "增量", "版本"],
    shortcut: shortcut("s", "Ctrl+Alt+S", { alt: true }),
    visibleRequires: ["note"],
  }),
  command("note.showVersions", "查看当前节点的版本图", "版本", "document", 90, {
    contexts: [...DOCUMENT_SCOPES, ...NOTE_SCOPES],
    keywords: ["git", "history", "branch", "历史", "分支"],
    visibleRequires: ["note"],
  }),
  command(
    "note.copyMarkdown",
    "复制当前节点的 Markdown 原文",
    "文件",
    "document",
    95,
    {
      contexts: [...DOCUMENT_SCOPES, ...NOTE_SCOPES],
      keywords: ["copy", "source", "markdown", "原文", "复制"],
      visibleRequires: ["note"],
    },
  ),
  command(
    "note.copyPlainText",
    "复制当前节点的阅读文本",
    "文件",
    "document",
    96,
    {
      contexts: [...DOCUMENT_SCOPES, ...NOTE_SCOPES],
      keywords: ["copy", "plain text", "纯文本", "阅读", "复制"],
      visibleRequires: ["note"],
    },
  ),
  command(
    "note.copyLearningPrompt",
    "复制当前节点的学习提示词",
    "学习",
    "document",
    100,
    {
      contexts: [...DOCUMENT_SCOPES, ...NOTE_SCOPES],
      keywords: ["ai", "prompt", "学习", "复制"],
      visibleRequires: ["note"],
    },
  ),
  command("note.open", "打开知识节点", "知识节点", "note", 110, {
    contexts: NOTE_SCOPES,
    palette: false,
    visibleRequires: ["note"],
  }),
  command("wiki.open", "打开 Wiki 链接目标", "知识节点", "wiki", 112, {
    contexts: ["wiki-link"],
    palette: false,
    visibleRequires: ["native", "note", "wikiTarget"],
  }),
  command("wiki.copyTarget", "复制 Wiki 目标", "知识节点", "wiki", 114, {
    contexts: ["wiki-link"],
    palette: false,
    visibleRequires: ["wikiTarget"],
  }),
  command("attachment.copyTarget", "复制附件目标", "附件", "attachment", 115, {
    contexts: ["attachment"],
    palette: false,
    visibleRequires: ["attachmentTarget"],
  }),
  command("attachment.import", "导入附件到光标", "附件", "attachment", 116, {
    contexts: ["editor"],
    keywords: ["attachment", "import", "file", "image", "附件", "导入", "图片"],
    visibleRequires: ["native", "note", "attachmentImport"],
  }),
  command(
    "attachment.confirmImport",
    "确认导入并插入引用",
    "附件",
    "dialog",
    117,
    {
      palette: false,
      visibleRequires: ["attachmentImportDialog"],
      enabledRequires: ["attachmentImportReady"],
    },
  ),
  command(
    "dialog.closeAttachmentImport",
    "取消附件导入",
    "对话框",
    "dialog",
    118,
    {
      palette: false,
      visibleRequires: ["attachmentImportDialog"],
    },
  ),
  command("note.openSplit", "打开并实时预览", "知识节点", "note", 120, {
    contexts: NOTE_SCOPES,
    keywords: ["split", "live preview", "分栏", "实时"],
    visibleRequires: ["note"],
  }),
  command("note.copyTitle", "复制节点名称", "知识节点", "note", 130, {
    contexts: NOTE_SCOPES,
    palette: false,
    visibleRequires: ["note"],
  }),
  command("note.rename", "移动或重命名 Markdown", "文件", "note", 140, {
    contexts: NOTE_SCOPES,
    keywords: ["rename", "move", "f2", "路径"],
    shortcut: {
      key: "f2",
      label: "F2",
    },
    visibleRequires: ["native", "note"],
    enabledRequires: ["noteRename"],
  }),
  command("view.edit", "切换到纯编辑", "视图", "view", 150, {
    contexts: DOCUMENT_SCOPES,
    keywords: ["editor", "编辑器", "source"],
    visibleRequires: ["note"],
  }),
  command("view.split", "切换到实时分栏", "视图", "view", 160, {
    contexts: DOCUMENT_SCOPES,
    keywords: ["split", "live preview", "分栏"],
    shortcut: shortcut("\\", "Ctrl+\\"),
    visibleRequires: ["note"],
  }),
  command("view.preview", "切换到阅读预览", "视图", "view", 170, {
    contexts: DOCUMENT_SCOPES,
    keywords: ["preview", "reader", "阅读"],
    shortcut: shortcut("v", "Ctrl+Shift+V", { shift: true }),
    visibleRequires: ["note"],
  }),
  command(
    "view.toggleLivePreview",
    "切换编辑器实时预览",
    "视图",
    "view",
    175,
    {
      contexts: DOCUMENT_SCOPES,
      keywords: ["live preview", "typora", "实时预览", "源码"],
      visibleRequires: ["note"],
    },
  ),
  command("view.toggleOutline", "显示或隐藏文档大纲", "视图", "view", 176, {
    contexts: DOCUMENT_SCOPES,
    keywords: ["outline", "heading", "标题", "大纲", "导航"],
    visibleRequires: ["note"],
  }),
  command(
    "view.toggleBacklinks",
    "显示或隐藏反向链接",
    "视图",
    "view",
    177,
    {
      contexts: DOCUMENT_SCOPES,
      keywords: ["backlink", "wiki", "关系", "反向链接", "引用"],
      visibleRequires: ["native", "note"],
    },
  ),
  command("tab.close", "关闭当前标签", "标签", "tabs", 180, {
    contexts: ["tab"],
    keywords: ["close", "关闭标签"],
    shortcut: shortcut("w", "Ctrl+W"),
    enabledRequires: ["tab"],
  }),
  command("tab.closeOthers", "关闭其他标签", "标签", "tabs", 190, {
    contexts: ["tab"],
    palette: false,
    visibleRequires: ["note"],
    enabledRequires: ["multiTabs"],
  }),
  command("tab.reopenClosed", "重新打开已关闭标签", "标签", "tabs", 200, {
    contexts: ["tab"],
    keywords: ["reopen", "restore tab", "恢复标签"],
    shortcut: shortcut("t", "Ctrl+Shift+T", { shift: true }),
    enabledRequires: ["closedTabs"],
  }),
  command("tab.next", "切换到下一个标签", "标签", "tabs", 210, {
    keywords: ["next tab", "下一个"],
    shortcut: shortcut("tab", "Ctrl+Tab"),
    enabledRequires: ["multiTabs"],
  }),
  command("tab.previous", "切换到上一个标签", "标签", "tabs", 220, {
    keywords: ["previous tab", "上一个"],
    shortcut: shortcut("tab", "Ctrl+Shift+Tab", { shift: true }),
    enabledRequires: ["multiTabs"],
  }),
  command("edit.copy", "复制", "编辑", "selection", 230, {
    contexts: [...DOCUMENT_SCOPES, "input"],
    palette: false,
    visibleRequires: ["selection"],
  }),
  command("edit.cut", "剪切", "编辑", "selection", 240, {
    contexts: ["input"],
    palette: false,
    visibleRequires: ["inputTarget", "selection"],
  }),
  command("edit.paste", "粘贴", "编辑", "selection", 250, {
    contexts: ["input"],
    palette: false,
    visibleRequires: ["inputTarget"],
  }),
  command("edit.selectAll", "全选", "编辑", "selection", 260, {
    contexts: ["input"],
    palette: false,
    visibleRequires: ["inputTarget"],
  }),
  command("edit.undo", "撤销编辑", "编辑", "editing", 270, {
    contexts: ["editor"],
    palette: false,
    enabledRequires: ["undo"],
  }),
  command("edit.redo", "重做编辑", "编辑", "editing", 280, {
    contexts: ["editor"],
    palette: false,
    enabledRequires: ["redo"],
  }),
  command(
    "workspace.resolveSave",
    "处理当前保存问题",
    "工作区",
    "status",
    290,
    {
      contexts: ["status"],
      palette: false,
      visibleRequires: ["native"],
      enabledRequires: ["saveRecovery"],
    },
  ),
  command("workspace.copyRoot", "复制 Markdown 工作区位置", "工作区", "status", 300, {
    contexts: ["status"],
    keywords: ["path", "workspace", "目录", "位置"],
    visibleRequires: ["native"],
    enabledRequires: ["root"],
  }),
  command(
    "workspace.openExternalChanges",
    "查看外部文件更改",
    "工作区",
    "status",
    310,
    {
      contexts: ["status"],
      keywords: ["external", "watcher", "冲突"],
      visibleRequires: ["native"],
      enabledRequires: ["externalChanges"],
    },
  ),
  command(
    "workspace.applyExternalChanges",
    "应用无冲突的外部更改",
    "工作区",
    "dialog",
    311,
    {
      palette: false,
      visibleRequires: ["externalDialog"],
      enabledRequires: ["externalApplySafe"],
    },
  ),
  command(
    "workspace.recoverAndApplyExternalChanges",
    "备份编辑内容并接受磁盘版本",
    "工作区",
    "dialog",
    312,
    {
      palette: false,
      visibleRequires: ["externalDialog"],
      enabledRequires: ["externalRecovery"],
      dangerous: true,
    },
  ),
  command(
    "dialog.closeExternalChanges",
    "关闭外部更改中心",
    "对话框",
    "dialog",
    313,
    {
      palette: false,
      visibleRequires: ["externalDialog"],
      enabledRequires: ["externalRecovery"],
    },
  ),
  command(
    "workspace.rebuildIndex",
    "从 Markdown 重建全文索引",
    "工作区",
    "status",
    320,
    {
      contexts: ["status"],
      keywords: ["fts", "sqlite", "search", "索引"],
      visibleRequires: ["native"],
    },
  ),
  command("workspace.resetPreview", "重置浏览器预览数据", "工作区", "status", 330, {
    contexts: ["status"],
    palette: false,
    visibleRequires: ["browser"],
    dangerous: true,
  }),
  command("backup.create", "创建完整工作区备份", "备份", "workspace", 340, {
    contexts: WORKSPACE_SCOPES,
    keywords: ["backup", "备份", "恢复"],
    visibleRequires: ["native"],
    enabledRequires: ["backupIdle"],
  }),
  command("backup.verify", "完整校验所选备份", "备份", "backup", 350, {
    palette: false,
    visibleRequires: ["native", "backup"],
    enabledRequires: ["backupIdle"],
  }),
  command("backup.restore", "恢复所选备份并重启", "备份", "backup", 360, {
    palette: false,
    visibleRequires: ["native", "backup"],
    enabledRequires: ["backupIdle"],
    dangerous: true,
  }),
  command("retention.preview", "预览旧版本清理", "版本", "retention", 370, {
    keywords: ["retention", "gc", "清理", "空间"],
    visibleRequires: ["native"],
  }),
  command("retention.apply", "执行已预览的版本清理", "版本", "retention", 380, {
    palette: false,
    visibleRequires: ["native"],
    enabledRequires: ["retentionPreview"],
    dangerous: true,
  }),
  command("version.restore", "恢复到所选版本", "版本", "version", 390, {
    contexts: ["version-node"],
    palette: false,
    visibleRequires: ["snapshot"],
  }),
  command("version.copyMarkdown", "复制所选版本的 Markdown", "版本", "version", 400, {
    contexts: ["version-node"],
    palette: false,
    visibleRequires: ["snapshot"],
  }),
  command(
    "version.toggleCheckpoint",
    "切换所选版本的检查点保护",
    "版本",
    "version",
    410,
    {
      contexts: ["version-node"],
      palette: false,
      visibleRequires: ["native", "snapshot"],
    },
  ),
  command("version.openNote", "打开所属知识节点", "版本", "version", 420, {
    contexts: ["version-node"],
    palette: false,
    visibleRequires: ["note", "snapshot"],
  }),
  command("version.delete", "删除所选版本节点", "版本", "version", 430, {
    contexts: ["version-node"],
    palette: false,
    visibleRequires: ["snapshot"],
    dangerous: true,
  }),
  command("window.minimize", "最小化窗口", "窗口", "window", 440, {
    contexts: ["titlebar"],
    palette: false,
  }),
  command("window.maximize", "最大化或还原窗口", "窗口", "window", 450, {
    contexts: ["titlebar"],
    palette: false,
  }),
  command("window.close", "关闭知织", "窗口", "window", 460, {
    contexts: ["titlebar"],
    palette: false,
    dangerous: true,
  }),
  navigationCommand("view.today", "今天", 500),
  navigationCommand("view.continue", "学习", 510),
  navigationCommand("view.topics", "知识库", 520),
  navigationCommand("view.review", "复习", 530),
  navigationCommand("view.sources", "资料", 540),
  navigationCommand("view.experiments", "实验", 550),
  navigationCommand("view.versions", "版本", 560),
];

export function commandById(id: CommandId): CommandDefinition {
  const definition = COMMANDS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Unknown command: ${id}`);
  }
  return definition;
}

export function resolveCommandById(
  id: CommandId,
  context: CommandContext,
): ResolvedCommand | undefined {
  const definition = commandById(id);
  return requirementsMet(
    definition.visibleRequires,
    context.capabilities,
  )
    ? resolveCommand(definition, context)
    : undefined;
}

export function commandsForContext(
  context: CommandContext,
): readonly ResolvedCommand[] {
  if (context.scope === undefined) {
    return [];
  }
  return COMMANDS.filter(
    (definition) =>
      definition.contexts.includes(context.scope as CommandScope) &&
      requirementsMet(definition.visibleRequires, context.capabilities),
  )
    .map((definition) => resolveCommand(definition, context))
    .sort(
      (left, right) =>
        contextCommandOrder(context.scope as CommandScope, left.id) -
        contextCommandOrder(context.scope as CommandScope, right.id),
    );
}

export function commandsForPalette(
  context: CommandContext,
  query: string,
): readonly ResolvedCommand[] {
  const normalized = normalize(query);
  return COMMANDS.filter(
    (definition) =>
      definition.palette &&
      requirementsMet(definition.visibleRequires, context.capabilities),
  )
    .map((definition) => ({
      command: resolveCommand(definition, context),
      score: commandScore(definition, normalized),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.command.order - right.command.order ||
        left.command.title.localeCompare(right.command.title, "zh-CN"),
    )
    .map((item) => item.command);
}

export function commandForShortcut(
  chord: KeyboardChord,
): CommandDefinition | undefined {
  if (chord.defaultPrevented || chord.isComposing) {
    return undefined;
  }
  return COMMANDS.find(
    (definition) =>
      definition.shortcut !== undefined &&
      shortcutMatches(definition.shortcut, chord),
  );
}

function resolveCommand(
  definition: CommandDefinition,
  context: CommandContext,
): ResolvedCommand {
  return {
    ...definition,
    enabled: requirementsMet(
      definition.enabledRequires,
      context.capabilities,
    ),
  };
}

function requirementsMet(
  requirements: readonly CommandCapability[] | undefined,
  capabilities: ReadonlySet<CommandCapability>,
): boolean {
  return requirements?.every((requirement) => capabilities.has(requirement)) ??
    true;
}

function contextCommandOrder(scope: CommandScope, id: CommandId): number {
  const index = CONTEXT_ORDER[scope].indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function shortcutMatches(
  expected: CommandShortcut,
  actual: KeyboardChord,
): boolean {
  const primary = actual.ctrlKey || actual.metaKey;
  return (
    normalizeKey(actual.key) === normalizeKey(expected.key) &&
    primary === (expected.primary ?? false) &&
    actual.altKey === (expected.alt ?? false) &&
    actual.shiftKey === (expected.shift ?? false)
  );
}

function normalizeKey(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function commandScore(
  definition: CommandDefinition,
  normalizedQuery: string,
): number {
  if (normalizedQuery.length === 0) {
    return 0;
  }
  const tokens = normalizedQuery.split(/\s+/u);
  const title = normalize(definition.title);
  const id = normalize(definition.id);
  const category = normalize(definition.category);
  const keywords = normalize(definition.keywords.join(" "));
  let score = 0;
  for (const token of tokens) {
    if (title.startsWith(token)) {
      score += 0;
    } else if (title.includes(token)) {
      score += 2;
    } else if (id.startsWith(token)) {
      score += 3;
    } else if (id.includes(token) || category.includes(token)) {
      score += 4;
    } else if (keywords.includes(token)) {
      score += 5;
    } else if (
      [title, id, category, ...definition.keywords.map(normalize)].some(
        (candidate) => isSubsequence(token, candidate),
      )
    ) {
      score += 8;
    } else {
      return Number.POSITIVE_INFINITY;
    }
  }
  return score;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}

function command(
  id: CommandId,
  title: string,
  category: string,
  group: string,
  order: number,
  options: Partial<Omit<CommandDefinition, "id" | "title" | "category" | "group" | "order">> =
    {},
): CommandDefinition {
  return {
    id,
    title,
    category,
    group,
    order,
    contexts: options.contexts ?? [],
    palette: options.palette ?? true,
    keywords: options.keywords ?? [],
    ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
    ...(options.visibleRequires === undefined
      ? {}
      : { visibleRequires: options.visibleRequires }),
    ...(options.enabledRequires === undefined
      ? {}
      : { enabledRequires: options.enabledRequires }),
    ...(options.dangerous === undefined
      ? {}
      : { dangerous: options.dangerous }),
  };
}

function navigationCommand(
  id: CommandId,
  title: string,
  order: number,
): CommandDefinition {
  return command(id, `转到${title}`, "导航", "navigation", order, {
    keywords: ["view", "navigation", "导航", title],
  });
}

function shortcut(
  key: string,
  label: string,
  modifiers: Pick<CommandShortcut, "alt" | "shift"> = {},
): CommandShortcut {
  return {
    key,
    label,
    primary: true,
    ...(modifiers.alt === undefined ? {} : { alt: modifiers.alt }),
    ...(modifiers.shift === undefined ? {} : { shift: modifiers.shift }),
  };
}
