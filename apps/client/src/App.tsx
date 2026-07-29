import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  BookOpenText,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FilePlus2,
  FlaskConical,
  GitBranch,
  GraduationCap,
  Library,
  LockKeyhole,
  Network,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import {
  VIEW_COPY,
  WORKSPACE_STORAGE_KEY,
  addSnapshot,
  createBlankNote,
  createInitialWorkspace,
  createLearningPrompt,
  notesForView,
  parseWorkspace,
  restoreSnapshot,
  searchNotes,
  type LearningNote,
  type NoteSnapshot,
  type ViewKey,
  type WorkspaceState,
} from "./appModel";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { loadSystemStatus, type SystemStatus } from "./system";

const NAVIGATION = [
  { key: "today", icon: CalendarDays },
  { key: "continue", icon: GraduationCap },
  { key: "topics", icon: Network },
  { key: "sources", icon: Library },
  { key: "experiments", icon: FlaskConical },
  { key: "review", icon: CheckCircle2 },
  { key: "versions", icon: GitBranch },
] as const;

const COMPLETION_CHECKS = [
  { id: "windows-input", label: "Windows 输入与保存" },
  { id: "android-input", label: "Android 中文输入" },
  { id: "stronghold-unlock", label: "Stronghold 重启解锁" },
  { id: "sqlite-search", label: "SQLite 检索" },
] as const;

const NOTE_VIEWS = NAVIGATION
  .filter((item) => item.key !== "versions")
  .map((item) => item.key);

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    parseWorkspace(readStoredWorkspace()),
  );
  const [activeView, setActiveView] = useState<ViewKey>(
    () =>
      workspace.notes.find((note) => note.id === workspace.selectedNoteId)
        ?.view ?? "continue",
  );
  const [isReading, setIsReading] = useState(false);
  const [isNewNoteOpen, setIsNewNoteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newView, setNewView] =
    useState<Exclude<ViewKey, "versions">>("topics");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [status, setStatus] = useState<SystemStatus>();

  const selectedNote = workspace.notes.find(
    (note) => note.id === workspace.selectedNoteId,
  );
  const visibleNotes = notesForView(workspace.notes, activeView);
  const results = useMemo(
    () => searchNotes(workspace.notes, query),
    [query, workspace.notes],
  );
  const completedCount = COMPLETION_CHECKS.filter(
    (item) => workspace.completedChecks[item.id] === true,
  ).length;

  useEffect(() => {
    void loadSystemStatus().then(setStatus);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      setToast("本机存储不可用，本次修改可能无法保留。");
    }
  }, [workspace]);

  useEffect(() => {
    if (toast.length === 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(""), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isNewNoteOpen) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNewNoteOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isNewNoteOpen]);

  function navigate(view: ViewKey) {
    setActiveView(view);
    setQuery("");
    setIsReading(false);
    if (view === "versions") {
      return;
    }
    const first = notesForView(workspace.notes, view)[0];
    if (first !== undefined) {
      setWorkspace((current) => ({
        ...current,
        selectedNoteId: first.id,
      }));
    }
  }

  function selectNote(note: LearningNote) {
    setWorkspace((current) => ({
      ...current,
      selectedNoteId: note.id,
    }));
    setActiveView(note.view);
    setQuery("");
    setIsReading(false);
  }

  function updateMarkdown(markdown: string) {
    if (selectedNote === undefined) {
      return;
    }
    const updatedAt = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === selectedNote.id ? { ...note, markdown, updatedAt } : note,
      ),
    }));
  }

  function openNewNote() {
    setNewTitle("");
    setNewView(activeView === "versions" ? "topics" : activeView);
    setIsNewNoteOpen(true);
  }

  function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTitle.trim().length === 0) {
      return;
    }
    const note = createBlankNote(newTitle, newView);
    setWorkspace((current) => ({
      ...current,
      notes: [note, ...current.notes],
      selectedNoteId: note.id,
    }));
    setActiveView(note.view);
    setIsReading(false);
    setIsNewNoteOpen(false);
    setToast(`已创建“${note.title}”，草稿已保存在本机。`);
  }

  async function copyForAi() {
    if (selectedNote === undefined) {
      return;
    }
    try {
      await copyText(createLearningPrompt(selectedNote));
      setToast("学习提示词和当前笔记已复制，可以粘贴到网页 AI。");
    } catch {
      setToast("复制失败，请检查系统剪贴板权限。");
    }
  }

  function saveVersion() {
    if (selectedNote === undefined) {
      return;
    }
    setWorkspace((current) => addSnapshot(current, selectedNote));
    setToast(`已保存“${selectedNote.title}”的手动版本。`);
  }

  function restoreVersion(snapshot: NoteSnapshot) {
    setWorkspace((current) => {
      const currentNote = current.notes.find(
        (note) => note.id === snapshot.noteId,
      );
      const protectedWorkspace =
        currentNote === undefined
          ? current
          : addSnapshot(current, currentNote);
      return restoreSnapshot(protectedWorkspace, snapshot.id);
    });
    const note = workspace.notes.find((item) => item.id === snapshot.noteId);
    if (note !== undefined) {
      setActiveView(note.view);
    }
    setIsReading(false);
    setToast("已恢复所选版本；恢复前内容已自动备份。");
  }

  function toggleCheck(id: string) {
    setWorkspace((current) => ({
      ...current,
      completedChecks: {
        ...current.completedChecks,
        [id]: current.completedChecks[id] !== true,
      },
    }));
  }

  function resetDemoData() {
    const confirmed = window.confirm(
      "这会清除当前设备上的全部知织演示笔记、任务状态和本地版本。确定继续吗？",
    );
    if (!confirmed) {
      return;
    }
    const initial = createInitialWorkspace();
    setWorkspace(initial);
    setActiveView("continue");
    setIsReading(false);
    setQuery("");
    setToast("本机演示数据已重置。");
  }

  const pageTitle =
    activeView === "versions"
      ? "本地版本历史"
      : selectedNote?.title ?? VIEW_COPY[activeView].label;

  return (
    <main className="app-shell">
      <aside className="navigation">
        <div className="brand">
          <span className="brand-mark"><BrainCircuit /></span>
          <span>
            <strong>知织</strong>
            <small>ZhiWeave</small>
          </span>
          <button onClick={openNewNote} type="button" aria-label="新建笔记">
            <Plus />
          </button>
        </div>

        <div className="search-wrap">
          <label className="search">
            <Search />
            <input
              aria-label="搜索"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题或正文…"
              value={query}
            />
            {query.length > 0 && (
              <button
                aria-label="清除搜索"
                onClick={() => setQuery("")}
                type="button"
              >
                <X />
              </button>
            )}
          </label>
          {query.trim().length > 0 && (
            <div className="search-results" aria-label="搜索结果">
              {results.length === 0 ? (
                <p>没有找到匹配内容</p>
              ) : (
                results.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => selectNote(note)}
                    type="button"
                  >
                    <strong>{note.title}</strong>
                    <small>{VIEW_COPY[note.view].label}</small>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <nav aria-label="学习导航">
          {NAVIGATION.map(({ key, icon: Icon }) => (
            <button
              aria-current={activeView === key ? "page" : undefined}
              className={activeView === key ? "is-active" : ""}
              key={key}
              onClick={() => navigate(key)}
              type="button"
            >
              <Icon />
              <span>{VIEW_COPY[key].label}</span>
              {key !== "versions" && (
                <small>{notesForView(workspace.notes, key).length}</small>
              )}
            </button>
          ))}
        </nav>

        <button
          className="topic-progress"
          onClick={() => navigate("continue")}
          type="button"
        >
          <span>当前主题</span>
          <strong>构建 ZhiWeave</strong>
          <div>
            <i style={{ width: `${(completedCount / COMPLETION_CHECKS.length) * 100}%` }} />
          </div>
          <small>{completedCount} / {COMPLETION_CHECKS.length} 项已完成</small>
        </button>

        <div className="build-identity">
          <LockKeyhole />
          <span>
            <strong>{status?.protocol ?? "正在读取核心…"}</strong>
            <small>本机草稿 · {status?.stage ?? "architecture spike"}</small>
          </span>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">{VIEW_COPY[activeView].label}</span>
            <h1>{pageTitle}</h1>
            <p>{VIEW_COPY[activeView].description}</p>
          </div>
          <div className="header-actions">
            {activeView === "versions" ? (
              <button
                className="primary"
                disabled={selectedNote === undefined}
                onClick={saveVersion}
                type="button"
              >
                <Save /> 保存当前版本
              </button>
            ) : (
              <>
                <button onClick={() => setIsReading((value) => !value)} type="button">
                  {isReading ? <PencilLine /> : <BookOpenText />}
                  {isReading ? "编辑" : "阅读"}
                </button>
                <button onClick={saveVersion} type="button">
                  <Save /> 保存版本
                </button>
                <button className="primary" onClick={() => void copyForAi()} type="button">
                  <Sparkles /> 复制给 AI
                </button>
              </>
            )}
          </div>
        </header>

        {activeView === "versions" ? (
          <VersionHistory
            currentNote={selectedNote}
            onReset={resetDemoData}
            onRestore={restoreVersion}
            snapshots={workspace.snapshots}
          />
        ) : selectedNote === undefined ? (
          <EmptyWorkspace onCreate={openNewNote} />
        ) : isReading ? (
          <MarkdownPreview markdown={selectedNote.markdown} />
        ) : (
          <MarkdownEditor
            key={selectedNote.id}
            value={selectedNote.markdown}
            onChange={updateMarkdown}
          />
        )}
      </section>

      <aside className="context-panel">
        <span className="eyebrow">当前区域</span>
        <h2>{VIEW_COPY[activeView].label}</h2>
        <p>{VIEW_COPY[activeView].description}</p>

        {activeView !== "versions" && (
          <section className="note-switcher">
            <h3>这里的内容</h3>
            {visibleNotes.map((note) => (
              <button
                className={note.id === selectedNote?.id ? "is-current" : ""}
                key={note.id}
                onClick={() => selectNote(note)}
                type="button"
              >
                <span>{note.title}</span>
                {note.id === selectedNote?.id && <Check />}
              </button>
            ))}
            <button className="add-note-inline" onClick={openNewNote} type="button">
              <FilePlus2 /> 新建此类笔记
            </button>
          </section>
        )}

        <section>
          <h3>产品验证进度</h3>
          {COMPLETION_CHECKS.map((item) => (
            <label key={item.id}>
              <input
                checked={workspace.completedChecks[item.id] === true}
                onChange={() => toggleCheck(item.id)}
                type="checkbox"
              />
              {item.label}
            </label>
          ))}
        </section>

        <section className="architecture-card">
          <BrainCircuit />
          <div>
            <h3>真正独立</h3>
            <p>
              {status?.obsidianDependency === false
                ? "Rust 核心确认：不依赖 Obsidian。"
                : "正在验证独立核心…"}
            </p>
          </div>
        </section>
      </aside>

      {isNewNoteOpen && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="new-note-title"
            aria-modal="true"
            className="new-note-modal"
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">开始一条学习路径</span>
                <h2 id="new-note-title">新建学习内容</h2>
              </div>
              <button
                aria-label="关闭新建窗口"
                onClick={() => setIsNewNoteOpen(false)}
                type="button"
              >
                <X />
              </button>
            </header>
            <form onSubmit={createNote}>
              <label>
                标题
                <input
                  autoFocus
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="例如：Rust 所有权为什么这样设计？"
                  value={newTitle}
                />
              </label>
              <label>
                放在哪里
                <select
                  onChange={(event) =>
                    setNewView(
                      event.target.value as Exclude<ViewKey, "versions">,
                    )}
                  value={newView}
                >
                  {NOTE_VIEWS.map((view) => (
                    <option key={view} value={view}>{VIEW_COPY[view].label}</option>
                  ))}
                </select>
              </label>
              <p>知织会自动生成“问题、理解、证据、下一步”结构，并保存到本机。</p>
              <footer>
                <button onClick={() => setIsNewNoteOpen(false)} type="button">
                  取消
                </button>
                <button
                  className="primary"
                  disabled={newTitle.trim().length === 0}
                  type="submit"
                >
                  <Plus /> 创建并开始
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {toast.length > 0 && (
        <div className="toast" role="status">
          <CheckCircle2 />
          <span>{toast}</span>
        </div>
      )}
    </main>
  );
}

interface VersionHistoryProps {
  readonly currentNote: LearningNote | undefined;
  readonly snapshots: readonly NoteSnapshot[];
  readonly onReset: () => void;
  readonly onRestore: (snapshot: NoteSnapshot) => void;
}

function VersionHistory({
  currentNote,
  snapshots,
  onReset,
  onRestore,
}: VersionHistoryProps) {
  const relevant = currentNote === undefined
    ? snapshots
    : snapshots.filter((snapshot) => snapshot.noteId === currentNote.id);
  return (
    <section className="version-history" aria-label="本地版本历史">
      <div className="version-intro">
        <GitBranch />
        <div>
          <h2>{currentNote?.title ?? "当前笔记"}</h2>
          <p>版本只在你点击“保存版本”时创建。恢复前会自动备份当前内容。</p>
        </div>
        <button className="reset-workspace" onClick={onReset} type="button">
          重置演示数据
        </button>
      </div>
      {relevant.length === 0 ? (
        <div className="empty-state compact">
          <Clock3 />
          <h3>还没有手动版本</h3>
          <p>点击右上角“保存当前版本”，为现在的内容建立一个可恢复节点。</p>
        </div>
      ) : (
        <ol>
          {relevant.map((snapshot) => (
            <li key={snapshot.id}>
              <span className="version-dot" />
              <div>
                <strong>{snapshot.noteTitle}</strong>
                <small>{formatDate(snapshot.createdAt)}</small>
                <p>{snapshot.markdown.slice(0, 100).replaceAll("\n", " ")}</p>
                <button onClick={() => onRestore(snapshot)} type="button">
                  <RotateCcw /> 恢复此版本
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EmptyWorkspace({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <section className="empty-state">
      <FilePlus2 />
      <h2>这里还没有内容</h2>
      <p>创建一条笔记，知织会为你准备清晰的学习结构。</p>
      <button className="primary" onClick={onCreate} type="button">
        <Plus /> 新建学习内容
      </button>
    </section>
  );
}

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) {
    throw new Error("Clipboard copy was rejected");
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
