import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  BookOpenText,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Columns2,
  Copy,
  Database,
  FilePlus2,
  FlaskConical,
  GitFork,
  GitBranch,
  GraduationCap,
  Library,
  Maximize2,
  Menu,
  Minus,
  Network,
  NotebookPen,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import {
  VIEW_COPY,
  WORKSPACE_STORAGE_KEY,
  addSnapshot,
  createBlankNote,
  createInitialWorkspace,
  createLearningPrompt,
  deleteSnapshot,
  notesForView,
  openOrCreateDailyJournal,
  parseWorkspace,
  resolveSnapshotMarkdown,
  restoreSnapshot,
  searchNotes,
  snapshotStorageBytes,
  titleFromMarkdown,
  type LearningNote,
  type NoteSnapshot,
  type ViewKey,
  type WorkspaceState,
} from "./appModel";
import {
  MarkdownEditor,
  type EditorStatus,
  type MarkdownEditorHandle,
} from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { createUuidLabMarkdown } from "./embeddedLabModel";
import {
  folderForView,
  formatLocalDate,
  mergeExternalSnapshot,
  mergeSavedDocument,
  nativeDocumentToLearningNote,
  nativeHistoryToSnapshots,
  nativeSnapshotToWorkspace,
  portableSlug,
} from "./nativeWorkspaceModel";
import {
  isNativeRuntime,
  loadSystemStatus,
  type SystemStatus,
} from "./system";
import {
  asWorkspaceFailure,
  checkoutNativeVersion,
  createNativeNote,
  deleteNativeVersion,
  detectNativeWorkspaceChanges,
  loadNativeWorkspace,
  loadNativeVersionHistory,
  readNativeVersion,
  rebuildNativeIndex,
  renameNativeNote,
  saveNativeNote,
  saveNativeVersion,
  searchNativeNotes,
  type NativeIndexStatus,
  type NativeNoteDocument,
  type NativeVersionHistory,
  type NativeWorkspaceChangeKind,
  type NativeWorkspaceChangesResult,
} from "./workspaceClient";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type EditorMode = "edit" | "preview" | "split";
type SaveState =
  | "preview"
  | "loading"
  | "saved"
  | "dirty"
  | "saving"
  | "conflict"
  | "error"
  | "mixed";

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly scope:
    | "activity"
    | "editor"
    | "embedded-lab"
    | "explorer"
    | "input"
    | "note-item"
    | "preview"
    | "status"
    | "tab"
    | "titlebar"
    | "version-node"
    | "workspace";
  readonly hasSelection: boolean;
  readonly noteId?: string;
  readonly snapshotId?: string;
}

const EMPTY_EDITOR_STATUS: EditorStatus = {
  line: 1,
  column: 1,
  lines: 1,
  characters: 0,
  words: 0,
  selectionLength: 0,
  undoDepth: 0,
  redoDepth: 0,
};

const PRIMARY_NAVIGATION = [
  { key: "today", icon: CalendarDays },
  { key: "continue", icon: GraduationCap },
  { key: "topics", icon: Network },
  { key: "review", icon: CheckCircle2 },
  { key: "sources", icon: Library },
] as const;

const SECONDARY_NAVIGATION = [
  { key: "experiments", icon: FlaskConical },
  { key: "versions", icon: GitBranch },
] as const;

const NOTE_VIEWS = [...PRIMARY_NAVIGATION, ...SECONDARY_NAVIGATION]
  .filter((item) => item.key !== "versions")
  .map((item) => item.key);

export function App() {
  const nativeRuntime = isNativeRuntime();
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    nativeRuntime
      ? createInitialWorkspace()
      : parseWorkspace(readStoredWorkspace()),
  );
  const [activeView, setActiveView] = useState<ViewKey>(
    () =>
      workspace.notes.find((note) => note.id === workspace.selectedNoteId)
        ?.view ?? "continue",
  );
  const [activeNoteId, setActiveNoteId] = useState<string | null>(
    workspace.selectedNoteId,
  );
  const [openNoteIds, setOpenNoteIds] = useState<readonly string[]>([
    workspace.selectedNoteId,
  ]);
  const [closedNoteIds, setClosedNoteIds] = useState<readonly string[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [editorStatus, setEditorStatus] =
    useState<EditorStatus>(EMPTY_EDITOR_STATUS);
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => window.innerWidth > 960,
  );
  const [isNewNoteOpen, setIsNewNoteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newView, setNewView] =
    useState<Exclude<ViewKey, "versions">>("topics");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [status, setStatus] = useState<SystemStatus>();
  const [nativeRoot, setNativeRoot] = useState("");
  const [nativeIndex, setNativeIndex] = useState<NativeIndexStatus | null>(
    null,
  );
  const [nativeVersionHistory, setNativeVersionHistory] =
    useState<NativeVersionHistory | null>(null);
  const [nativeSearchIds, setNativeSearchIds] = useState<readonly string[]>(
    [],
  );
  const [nativeSearchState, setNativeSearchState] = useState<
    "idle" | "searching" | "ready" | "error"
  >("idle");
  const [saveState, setSaveState] = useState<SaveState>(
    nativeRuntime ? "loading" : "preview",
  );
  const [saveRetry, setSaveRetry] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [externalChanges, setExternalChanges] =
    useState<NativeWorkspaceChangesResult | null>(null);
  const [isExternalChangesOpen, setIsExternalChangesOpen] = useState(false);
  const [isResolvingExternalChanges, setIsResolvingExternalChanges] =
    useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const contextTargetRef = useRef<HTMLElement | null>(null);
  const lastPersistedMarkdownRef = useRef(new Map<string, string>());
  const latestMarkdownRef = useRef(new Map<string, string>());
  const activeNoteIdRef = useRef<string | null>(activeNoteId);
  const savingNoteIdsRef = useRef(new Set<string>());
  const saveAttemptRef = useRef(0);
  const workspaceRef = useRef(workspace);
  const workspaceReadyRef = useRef(false);
  const checkingExternalChangesRef = useRef(false);
  const pendingExternalCheckRef = useRef(false);

  const selectedNote = workspace.notes.find(
    (note) => note.id === activeNoteId,
  );
  const openNotes = openNoteIds
    .map((id) => workspace.notes.find((note) => note.id === id))
    .filter((note): note is LearningNote => note !== undefined);
  const visibleNotes = notesForView(workspace.notes, activeView);
  const results = useMemo(() => {
    if (!nativeRuntime) {
      return searchNotes(workspace.notes, query);
    }
    const notesById = new Map(workspace.notes.map((note) => [note.id, note]));
    return nativeSearchIds
      .map((id) => notesById.get(id))
      .filter((note): note is LearningNote => note !== undefined);
  }, [nativeRuntime, nativeSearchIds, query, workspace.notes]);

  function applyNativeHistory(history: NativeVersionHistory) {
    const mapped = nativeHistoryToSnapshots(history);
    setNativeVersionHistory(history);
    setWorkspace((current) => ({
      ...current,
      snapshots: mapped.snapshots,
      versionHeads: mapped.versionHeads,
    }));
  }

  useEffect(() => {
    void loadSystemStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (!nativeRuntime) {
      return undefined;
    }
    let active = true;
    setSaveState("loading");
    void loadNativeWorkspace()
      .then((snapshot) => {
        if (!active) {
          return;
        }
        const next = nativeSnapshotToWorkspace(snapshot);
        const selected = next.notes.find(
          (note) => note.id === next.selectedNoteId,
        );
        lastPersistedMarkdownRef.current = new Map(
          next.notes.map((note) => [note.id, note.markdown]),
        );
        latestMarkdownRef.current = new Map(
          next.notes.map((note) => [note.id, note.markdown]),
        );
        setWorkspace(next);
        setNativeRoot(snapshot.rootDisplay);
        setNativeIndex(snapshot.index);
        setActiveNoteId(selected?.id ?? null);
        setOpenNoteIds(selected === undefined ? [] : [selected.id]);
        setClosedNoteIds([]);
        setActiveView(selected?.view ?? "continue");
        setSaveState("saved");
        workspaceReadyRef.current = true;
        if (snapshot.index.state === "needsRebuild") {
          setToast("Markdown 已打开；全文索引损坏，需要从状态栏明确重建。");
        } else if (snapshot.index.state === "unavailable") {
          setToast("Markdown 已打开；全文索引当前不可用，没有改写数据库。");
        }
      })
      .catch(() => {
        if (active) {
          setSaveState("error");
          setToast(
            "无法打开本地 Markdown 工作区；没有用演示数据替代真实文件。",
          );
        }
      });
    return () => {
      active = false;
      workspaceReadyRef.current = false;
    };
  }, [nativeRuntime]);

  useEffect(() => {
    if (
      !nativeRuntime ||
      !workspaceReadyRef.current ||
      selectedNote === undefined
    ) {
      return undefined;
    }
    let active = true;
    setNativeVersionHistory(null);
    void loadNativeVersionHistory(selectedNote.id)
      .then((history) => {
        if (active) {
          applyNativeHistory(history);
        }
      })
      .catch(() => {
        if (active) {
          setToast(
            "这个知识节点的版本历史无法打开；Markdown 正文未受影响，也没有重建历史库。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [nativeRuntime, selectedNote?.id]);

  useEffect(() => {
    if (!nativeRuntime) {
      return undefined;
    }
    let active = true;

    const checkWorkspace = async (): Promise<void> => {
      if (!workspaceReadyRef.current) {
        return;
      }
      if (checkingExternalChangesRef.current) {
        pendingExternalCheckRef.current = true;
        return;
      }
      checkingExternalChangesRef.current = true;
      try {
        const current = workspaceRef.current;
        const baseline = current.notes.flatMap((note) =>
          note.path === undefined || note.revision === undefined
            ? []
            : [
                {
                  id: note.id,
                  path: note.path,
                  revision: note.revision,
                },
              ],
        );
        const result = await detectNativeWorkspaceChanges(baseline);
        if (!active) {
          return;
        }
        setNativeIndex(result.snapshot.index);
        if (result.changes.length === 0) {
          return;
        }
        setExternalChanges(result);
        const affectedIds = new Set(
          result.changes.map((change) => change.id),
        );
        const activeNote = current.notes.find(
          (note) => note.id === activeNoteIdRef.current,
        );
        const activeHasConflictingEdits =
          activeNote !== undefined &&
          affectedIds.has(activeNote.id) &&
          lastPersistedMarkdownRef.current.get(activeNote.id) !==
            activeNote.markdown;
        if (activeHasConflictingEdits) {
          setSaveState("conflict");
          setToast(
            "外部文件与当前编辑内容同时变化；知织已保留编辑缓冲，点击底部“外部更改”处理。",
          );
        } else {
          setToast(
            `检测到 ${result.changes.length} 项外部文件变化；点击底部状态栏查看。`,
          );
        }
      } catch {
        if (active) {
          setToast("外部文件发生变化，但重新核对工作区失败；没有覆盖编辑内容。");
        }
      } finally {
        checkingExternalChangesRef.current = false;
        if (active && pendingExternalCheckRef.current) {
          pendingExternalCheckRef.current = false;
          void checkWorkspace();
        }
      }
    };

    const stopListening = listen<number>(
      "workspace-files-changed",
      () => void checkWorkspace(),
    );
    return () => {
      active = false;
      void stopListening.then((unlisten) => unlisten());
    };
  }, [nativeRuntime]);

  useEffect(() => {
    if (!nativeRuntime || query.trim().length === 0) {
      setNativeSearchIds([]);
      setNativeSearchState("idle");
      return undefined;
    }
    if (nativeIndex?.state !== "ready") {
      setNativeSearchIds([]);
      setNativeSearchState("error");
      return undefined;
    }

    let active = true;
    setNativeSearchState("searching");
    const timer = window.setTimeout(() => {
      void searchNativeNotes(query, 50)
        .then((matches) => {
          if (!active) {
            return;
          }
          setNativeSearchIds(matches.map((match) => match.id));
          setNativeSearchState("ready");
        })
        .catch(() => {
          if (!active) {
            return;
          }
          setNativeSearchIds([]);
          setNativeSearchState("error");
        });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [nativeIndex?.state, nativeRuntime, query]);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    for (const note of workspace.notes) {
      latestMarkdownRef.current.set(note.id, note.markdown);
    }
  }, [workspace.notes]);

  useEffect(() => {
    if (nativeRuntime) {
      return;
    }
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      setToast("本机存储不可用，本次修改可能无法保留。");
    }
  }, [nativeRuntime, workspace]);

  useEffect(() => {
    if (
      !nativeRuntime ||
      selectedNote?.path === undefined ||
      selectedNote.revision === undefined ||
      selectedNote.lineEnding === undefined
    ) {
      return undefined;
    }
    if (
      lastPersistedMarkdownRef.current.get(selectedNote.id) ===
      selectedNote.markdown
    ) {
      setSaveState("saved");
      return undefined;
    }
    if (selectedNote.lineEnding === "mixed") {
      setSaveState("mixed");
      return undefined;
    }

    setSaveState("dirty");
    const timer = window.setTimeout(() => {
      const captured = selectedNote;
      if (savingNoteIdsRef.current.has(captured.id)) {
        setSaveState("dirty");
        return;
      }
      savingNoteIdsRef.current.add(captured.id);
      const attempt = ++saveAttemptRef.current;
      setSaveState("saving");
      void saveNativeNote({
        path: captured.path!,
        markdown: captured.markdown,
        revision: captured.revision!,
        lineEnding: captured.lineEnding!,
        hasUtf8Bom: captured.hasUtf8Bom ?? false,
      })
        .then(({ document, indexUpdated }) => {
          lastPersistedMarkdownRef.current.set(
            captured.id,
            captured.markdown,
          );
          setWorkspace((current) => ({
            ...current,
            notes: current.notes.map((note) =>
              note.id === captured.id
                ? mergeSavedDocument(note, captured.markdown, document)
                : note,
            ),
          }));
          if (
            saveAttemptRef.current === attempt &&
            activeNoteIdRef.current === captured.id
          ) {
            const latest = latestMarkdownRef.current.get(captured.id);
            setSaveState(
              latest === captured.markdown ? "saved" : "dirty",
            );
          }
          if (!indexUpdated) {
            setNativeIndex((current) => ({
              state: "unavailable",
              schemaVersion: current?.schemaVersion ?? 0,
              noteCount: current?.noteCount ?? 0,
              issue: "incrementalUpdateFailed",
            }));
            setToast(
              "Markdown 已安全保存，但全文索引未更新；可从状态栏重建。",
            );
          }
        })
        .catch((error: unknown) => {
          if (
            saveAttemptRef.current !== attempt ||
            activeNoteIdRef.current !== captured.id
          ) {
            return;
          }
          const failure = asWorkspaceFailure(error);
          if (failure?.code === "conflict") {
            setSaveState("conflict");
            setToast(
              "源文件已在外部修改，知织没有覆盖它；可从底部状态栏安全恢复。",
            );
          } else if (failure?.code === "mixedLineEndings") {
            setSaveState("mixed");
          } else {
            setSaveState("error");
            setToast("Markdown 保存失败，编辑内容仍保留在当前窗口。");
          }
        })
        .finally(() => {
          savingNoteIdsRef.current.delete(captured.id);
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [
    nativeRuntime,
    saveRetry,
    selectedNote?.hasUtf8Bom,
    selectedNote?.id,
    selectedNote?.lineEnding,
    selectedNote?.markdown,
    selectedNote?.path,
    selectedNote?.revision,
  ]);

  useEffect(() => {
    if (toast.length === 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(""), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isNewNoteOpen && !isExternalChangesOpen) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNewNoteOpen(false);
        setIsExternalChangesOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isExternalChangesOpen, isNewNoteOpen]);

  useEffect(() => {
    const compactWindow = window.matchMedia("(max-width: 960px)");
    const closeSidebarInCompactWindow = () => {
      if (compactWindow.matches) {
        setIsSidebarOpen(false);
      }
    };
    compactWindow.addEventListener("change", closeSidebarInCompactWindow);
    return () =>
      compactWindow.removeEventListener("change", closeSidebarInCompactWindow);
  }, []);

  function navigate(view: ViewKey) {
    setActiveView(view);
    setQuery("");
    if (view === "versions") {
      return;
    }
    const first = notesForView(workspace.notes, view)[0];
    if (first !== undefined) {
      activateNote(first);
    }
  }

  function activateNote(note: LearningNote) {
    setActiveNoteId(note.id);
    setOpenNoteIds((current) =>
      current.includes(note.id) ? current : [...current, note.id],
    );
    setClosedNoteIds((current) => current.filter((id) => id !== note.id));
    setWorkspace((current) => ({
      ...current,
      selectedNoteId: note.id,
    }));
    setActiveView(note.view);
  }

  function selectNote(note: LearningNote) {
    activateNote(note);
    setQuery("");
  }

  function updateMarkdown(markdown: string) {
    if (selectedNote === undefined) {
      return;
    }
    latestMarkdownRef.current.set(selectedNote.id, markdown);
    if (nativeRuntime) {
      setSaveState("dirty");
    }
    const updatedAt = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === selectedNote.id
          ? {
              ...note,
              title: titleFromMarkdown(markdown, note.title),
              markdown,
              updatedAt,
            }
          : note,
      ),
    }));
  }

  function openNewNote() {
    setNewTitle("");
    setNewView(activeView === "versions" ? "topics" : activeView);
    setIsNewNoteOpen(true);
  }

  async function openTodayJournal() {
    if (nativeRuntime) {
      const journalDate = formatLocalDate(new Date());
      const path = `daily/${journalDate}.md`;
      const existing = workspace.notes.find((note) => note.path === path);
      if (existing !== undefined) {
        activateNote(existing);
        setQuery("");
        setToast(`已打开 ${existing.title}。`);
        return;
      }
      const draft = openOrCreateDailyJournal(workspace).note;
      try {
        const document = await createNativeNote(path, draft.markdown);
        addCreatedNativeDocument(document);
        setToast(`已创建 ${document.title} 的 Markdown 源文件。`);
      } catch (error: unknown) {
        const failure = asWorkspaceFailure(error);
        setToast(
          failure?.code === "alreadyExists"
            ? "今日日记已由另一个窗口创建，请重新载入工作区。"
            : "无法创建今日日记；现有内容没有被覆盖。",
        );
      }
      return;
    }
    const result = openOrCreateDailyJournal(workspace);
    setWorkspace(result.workspace);
    activateNote(result.note);
    setQuery("");
    setToast(`已打开 ${result.note.title}。`);
  }

  async function createUuidLab() {
    const title = "UUID 结构实验室";
    if (nativeRuntime) {
      try {
        const document = await createNativeNote(
          `experiments/uuid-lab-${Date.now().toString(36)}.md`,
          createUuidLabMarkdown(title),
        );
        addCreatedNativeDocument(document);
        setEditorMode("split");
        setToast(
          "UUID 交互实验已写入 Markdown；左侧可编辑，右侧会实时运行。",
        );
      } catch {
        setToast("UUID 实验创建失败，没有覆盖任何已有文件。");
      }
      return;
    }
    const note: LearningNote = {
      ...createBlankNote(title, "experiments"),
      kind: "learning_node",
      markdown: createUuidLabMarkdown(title),
    };
    setWorkspace((current) => ({
      ...current,
      notes: [note, ...current.notes],
      selectedNoteId: note.id,
    }));
    setActiveNoteId(note.id);
    setOpenNoteIds((current) =>
      current.includes(note.id) ? current : [...current, note.id],
    );
    setClosedNoteIds((current) => current.filter((id) => id !== note.id));
    setActiveView("experiments");
    setEditorMode("split");
    setQuery("");
    setToast("UUID 交互实验已创建；左侧可编辑，右侧会实时运行。");
  }

  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTitle.trim().length === 0) {
      return;
    }
    const note = createBlankNote(newTitle, newView);
    if (nativeRuntime) {
      const path =
        `${folderForView(newView)}/${portableSlug(newTitle)}-` +
        `${Date.now().toString(36)}.md`;
      try {
        const document = await createNativeNote(path, note.markdown);
        addCreatedNativeDocument(document);
        setIsNewNoteOpen(false);
        setToast(`已创建“${document.title}”的 Markdown 源文件。`);
      } catch (error: unknown) {
        const failure = asWorkspaceFailure(error);
        setToast(
          failure?.code === "alreadyExists"
            ? "同名源文件已经存在，未执行覆盖。"
            : "无法创建 Markdown 源文件，请检查工作区状态。",
        );
      }
      return;
    }
    setWorkspace((current) => ({
      ...current,
      notes: [note, ...current.notes],
      selectedNoteId: note.id,
    }));
    setActiveNoteId(note.id);
    setOpenNoteIds((current) => [...current, note.id]);
    setClosedNoteIds((current) => current.filter((id) => id !== note.id));
    setActiveView(note.view);
    setIsNewNoteOpen(false);
    setToast(
      `已创建“${note.title}”的浏览器预览数据；没有生成桌面端文件。`,
    );
  }

  function addCreatedNativeDocument(document: NativeNoteDocument) {
    const note = nativeDocumentToLearningNote(document);
    lastPersistedMarkdownRef.current.set(note.id, note.markdown);
    latestMarkdownRef.current.set(note.id, note.markdown);
    setWorkspace((current) => ({
      ...current,
      notes: [
        note,
        ...current.notes.filter((candidate) => candidate.id !== note.id),
      ],
      selectedNoteId: note.id,
    }));
    setActiveNoteId(note.id);
    setOpenNoteIds((current) =>
      current.includes(note.id) ? current : [...current, note.id],
    );
    setClosedNoteIds((current) => current.filter((id) => id !== note.id));
    setActiveView(note.view);
    setQuery("");
    setSaveState("saved");
    setNativeIndex((current) =>
      current?.state === "ready"
        ? { ...current, noteCount: current.noteCount + 1 }
        : current,
    );
  }

  async function handleSaveStatusAction() {
    if (!nativeRuntime) {
      return;
    }
    if (saveState === "conflict" && externalChanges !== null) {
      setIsExternalChangesOpen(true);
      return;
    }
    if (saveState === "mixed" && selectedNote !== undefined) {
      const confirmed = window.confirm(
        "这个文件混用了多种换行符。要明确统一为 LF 后再保存吗？",
      );
      if (!confirmed) {
        return;
      }
      setWorkspace((current) => ({
        ...current,
        notes: current.notes.map((note) =>
          note.id === selectedNote.id
            ? { ...note, lineEnding: "lf" }
            : note,
        ),
      }));
      setSaveState("dirty");
      setToast("已选择 LF；知织将执行一次冲突安全保存。");
      return;
    }
    if (saveState === "error") {
      setSaveRetry((value) => value + 1);
      setSaveState("dirty");
      return;
    }
    if (
      saveState !== "conflict" ||
      selectedNote?.path === undefined
    ) {
      return;
    }

    const confirmed = window.confirm(
      "源文件已在外部修改。知织会先把当前编辑内容另存到 recovery/，再重新载入外部版本；继续吗？",
    );
    if (!confirmed) {
      return;
    }
    const captured = selectedNote;
    try {
      const recovery = await createNativeNote(
        `recovery/${portableSlug(captured.title)}-conflict-` +
          `${Date.now().toString(36)}.md`,
        captured.markdown,
      );
      const snapshot = await loadNativeWorkspace();
      const source = snapshot.documents.find(
        (document) => document.path === captured.path,
      );
      if (source === undefined) {
        throw new Error("source disappeared during conflict recovery");
      }
      const sourceNote = nativeDocumentToLearningNote(source);
      const recoveryNote = nativeDocumentToLearningNote(recovery);
      lastPersistedMarkdownRef.current.set(
        sourceNote.id,
        sourceNote.markdown,
      );
      lastPersistedMarkdownRef.current.set(
        recoveryNote.id,
        recoveryNote.markdown,
      );
      latestMarkdownRef.current.set(sourceNote.id, sourceNote.markdown);
      latestMarkdownRef.current.set(recoveryNote.id, recoveryNote.markdown);
      setNativeRoot(snapshot.rootDisplay);
      setNativeIndex(snapshot.index);
      setWorkspace((current) => ({
        ...current,
        notes: [
          ...current.notes.map((note) =>
            note.id === captured.id ? sourceNote : note,
          ),
          ...(current.notes.some((note) => note.id === recoveryNote.id)
            ? []
            : [recoveryNote]),
        ],
      }));
      setSaveState("saved");
      setToast(
        `已重新载入外部版本；编辑器内容已安全保存在 ${recovery.path}。`,
      );
    } catch {
      setSaveState("conflict");
      setToast("冲突恢复未完成；编辑器内容仍在当前窗口中，未覆盖源文件。");
    }
  }

  async function applyVerifiedExternalChanges() {
    if (externalChanges === null || isResolvingExternalChanges) {
      return;
    }
    setIsResolvingExternalChanges(true);
    try {
      const beforeVerification = workspaceRef.current;
      const baseline = beforeVerification.notes.flatMap((note) =>
        note.path === undefined || note.revision === undefined
          ? []
          : [
              {
                id: note.id,
                path: note.path,
                revision: note.revision,
              },
            ],
      );
      const verified = await detectNativeWorkspaceChanges(baseline);
      const merged = mergeExternalSnapshot(
        workspaceRef.current,
        verified.snapshot,
        lastPersistedMarkdownRef.current,
      );
      const remainingChanges = verified.changes.filter((change) =>
        merged.unresolvedNoteIds.has(change.id),
      );
      lastPersistedMarkdownRef.current = new Map(merged.persistedMarkdown);
      latestMarkdownRef.current = new Map(
        merged.workspace.notes.map((note) => [note.id, note.markdown]),
      );
      workspaceRef.current = merged.workspace;
      setWorkspace(merged.workspace);
      setNativeRoot(verified.snapshot.rootDisplay);
      setNativeIndex(verified.snapshot.index);
      const currentActiveId = activeNoteIdRef.current;
      const nextActiveId =
        currentActiveId !== null &&
        merged.workspace.notes.some((note) => note.id === currentActiveId)
          ? currentActiveId
          : (merged.workspace.notes[0]?.id ?? null);
      activeNoteIdRef.current = nextActiveId;
      setActiveNoteId(nextActiveId);
      const nextActive = merged.workspace.notes.find(
        (note) => note.id === nextActiveId,
      );
      setActiveView(nextActive?.view ?? "continue");
      setOpenNoteIds((current) => {
        const retained = current.filter((id) =>
          merged.workspace.notes.some((note) => note.id === id),
        );
        const selected = merged.workspace.selectedNoteId;
        return selected.length > 0 && !retained.includes(selected)
          ? [...retained, selected]
          : retained;
      });
      setClosedNoteIds((current) =>
        current.filter((id) =>
          merged.workspace.notes.some((note) => note.id === id),
        ),
      );

      if (remainingChanges.length === 0) {
        setExternalChanges(null);
        setIsExternalChangesOpen(false);
        const selected = merged.workspace.notes.find(
          (note) => note.id === merged.workspace.selectedNoteId,
        );
        setSaveState(
          selected !== undefined &&
            merged.persistedMarkdown.get(selected.id) !== selected.markdown
            ? "dirty"
            : "saved",
        );
        setToast("已按最新磁盘事实刷新；没有覆盖任何未保存编辑。");
        return;
      }

      setExternalChanges({
        snapshot: verified.snapshot,
        changes: remainingChanges,
      });
      setSaveState(
        nextActiveId !== null &&
          merged.unresolvedNoteIds.has(nextActiveId)
          ? "conflict"
          : "dirty",
      );
      setToast(
        `已应用无冲突变化；仍有 ${remainingChanges.length} 项编辑冲突等待处理。`,
      );
    } catch {
      setToast("重新核对磁盘失败；当前编辑和外部更改列表都没有被覆盖。");
    } finally {
      setIsResolvingExternalChanges(false);
    }
  }

  async function recoverEditsAndAcceptExternalChanges() {
    if (externalChanges === null || isResolvingExternalChanges) {
      return;
    }
    const capturedWorkspace = workspaceRef.current;
    const dirtyNotes = capturedWorkspace.notes.filter(
      (note) =>
        lastPersistedMarkdownRef.current.get(note.id) !== note.markdown,
    );
    if (dirtyNotes.length === 0) {
      await applyVerifiedExternalChanges();
      return;
    }
    const confirmed = window.confirm(
      `知织会先把 ${dirtyNotes.length} 篇尚未保存的编辑内容分别写入 recovery/，` +
        "确认成功后才接受当前磁盘版本。继续吗？",
    );
    if (!confirmed) {
      return;
    }

    setIsResolvingExternalChanges(true);
    const recoveredIds = new Map<string, string>();
    let recoveredCount = 0;
    try {
      const nonce = Date.now().toString(36);
      for (const [index, note] of dirtyNotes.entries()) {
        const recovery = await createNativeNote(
          `recovery/${portableSlug(note.title)}-external-${nonce}-` +
            `${index + 1}-${note.id.slice(0, 8)}.md`,
          note.markdown,
        );
        recoveredIds.set(note.id, recovery.id);
        recoveredCount += 1;
      }

      const snapshot = await loadNativeWorkspace();
      const changedDuringRecovery = dirtyNotes.some((captured) => {
        const latest = workspaceRef.current.notes.find(
          (note) => note.id === captured.id,
        );
        return latest?.markdown !== captured.markdown;
      });
      if (changedDuringRecovery) {
        throw new Error("editor changed during recovery");
      }

      const diskWorkspace = nativeSnapshotToWorkspace(snapshot);
      const diskIds = new Set(diskWorkspace.notes.map((note) => note.id));
      const previousActiveId = activeNoteIdRef.current;
      const selectedNoteId =
        previousActiveId !== null && diskIds.has(previousActiveId)
          ? previousActiveId
          : previousActiveId === null
            ? diskWorkspace.selectedNoteId
            : (recoveredIds.get(previousActiveId) ??
              diskWorkspace.selectedNoteId);
      const nextWorkspace: WorkspaceState = {
        ...capturedWorkspace,
        notes: diskWorkspace.notes,
        selectedNoteId,
      };
      lastPersistedMarkdownRef.current = new Map(
        nextWorkspace.notes.map((note) => [note.id, note.markdown]),
      );
      latestMarkdownRef.current = new Map(
        nextWorkspace.notes.map((note) => [note.id, note.markdown]),
      );
      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      setNativeRoot(snapshot.rootDisplay);
      setNativeIndex(snapshot.index);
      setActiveNoteId(selectedNoteId || null);
      setOpenNoteIds((current) => {
        const retained = current.filter((id) => diskIds.has(id));
        const recoveredOpenIds = current.flatMap((id) => {
          const recoveryId = recoveredIds.get(id);
          return recoveryId === undefined ? [] : [recoveryId];
        });
        return [...new Set([...retained, ...recoveredOpenIds, selectedNoteId])]
          .filter((id) => id.length > 0);
      });
      setClosedNoteIds((current) => current.filter((id) => diskIds.has(id)));
      const selected = nextWorkspace.notes.find(
        (note) => note.id === selectedNoteId,
      );
      setActiveView(selected?.view ?? "continue");
      setExternalChanges(null);
      setIsExternalChangesOpen(false);
      setSaveState("saved");
      setToast(
        `已接受磁盘版本；${recoveredCount} 篇编辑内容已分别保存在 recovery/。`,
      );
    } catch {
      setSaveState("conflict");
      setToast(
        recoveredCount > 0
          ? `处理未完成；已创建 ${recoveredCount} 份恢复副本，当前编辑缓冲仍未被覆盖。`
          : "处理未完成；当前编辑缓冲仍在窗口中，没有覆盖磁盘文件。",
      );
    } finally {
      setIsResolvingExternalChanges(false);
    }
  }

  async function rebuildSearchIndex() {
    if (!nativeRuntime) {
      return;
    }
    const confirmed = window.confirm(
      "要从 Markdown 文件和隐藏节点身份重新生成全文索引吗？正文不会被修改，旧数据库会保存在 .zhiweave/recovery/。",
    );
    if (!confirmed) {
      return;
    }
    setNativeIndex((current) => ({
      state: "unavailable",
      schemaVersion: current?.schemaVersion ?? 0,
      noteCount: current?.noteCount ?? 0,
      issue: "rebuilding",
    }));
    try {
      const rebuilt = await rebuildNativeIndex();
      const snapshot = await loadNativeWorkspace();
      setNativeIndex(snapshot.index);
      setNativeSearchIds([]);
      setNativeSearchState("idle");
      setToast(
        `全文索引已从 ${rebuilt.indexedNotes} 篇 Markdown 重建` +
          (rebuilt.preservedPreviousDatabase
            ? "；旧数据库已保留供恢复。"
            : "。"),
      );
    } catch {
      setNativeIndex({
        state: "needsRebuild",
        schemaVersion: 0,
        noteCount: 0,
        issue: "rebuildFailed",
      });
      setToast("索引重建失败；Markdown 正文没有被修改。");
    }
  }

  async function copyForAi(note = selectedNote) {
    if (note === undefined) {
      return;
    }
    try {
      await copyText(createLearningPrompt(note));
      setToast("学习提示词和当前笔记已复制。");
    } catch {
      setToast("复制失败，请检查系统剪贴板权限。");
    }
  }

  async function copyNoteTitle(note: LearningNote) {
    try {
      await copyText(note.title);
      setToast(`已复制“${note.title}”的标题。`);
    } catch {
      setToast("复制失败，请检查系统剪贴板权限。");
    }
  }

  async function renameNoteFile(note: LearningNote) {
    if (
      !nativeRuntime ||
      note.path === undefined ||
      note.revision === undefined
    ) {
      return;
    }
    if (
      lastPersistedMarkdownRef.current.get(note.id) !== note.markdown
    ) {
      setToast("请先等待当前修改保存完成，再重命名文件。");
      return;
    }
    const entered = window.prompt(
      "输入新的工作区相对路径（必须以 .md 结尾）：",
      note.path,
    );
    const newPath = entered?.trim();
    if (newPath === undefined || newPath.length === 0 || newPath === note.path) {
      return;
    }
    try {
      const document = await renameNativeNote(
        note.path,
        newPath,
        note.revision,
      );
      const renamed = nativeDocumentToLearningNote(document);
      lastPersistedMarkdownRef.current.set(renamed.id, renamed.markdown);
      latestMarkdownRef.current.set(renamed.id, renamed.markdown);
      setWorkspace((current) => ({
        ...current,
        notes: current.notes.map((candidate) =>
          candidate.id === note.id ? renamed : candidate,
        ),
      }));
      setToast(`已移动到 ${document.path}；知识节点身份保持不变。`);
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setToast(
        failure?.code === "alreadyExists"
          ? "目标位置已有 Markdown，知织没有覆盖它。"
          : failure?.code === "conflict"
            ? "源文件已变化，知织没有移动或覆盖任何文件。"
            : "重命名未完成；原 Markdown 仍保留。",
      );
    }
  }

  async function copySnapshotMarkdown(snapshot: NoteSnapshot) {
    try {
      const markdown = nativeRuntime
        ? (await readNativeVersion(snapshot.id)).markdown
        : resolveSnapshotMarkdown(workspace, snapshot.id);
      if (markdown === undefined) {
        setToast("这个版本无法安全重建，未执行复制。");
        return;
      }
      await copyText(markdown);
      setToast("所选版本的 Markdown 已复制。");
    } catch {
      setToast(
        nativeRuntime
          ? "版本完整性校验或剪贴板操作失败，没有复制不可信内容。"
          : "复制失败，请检查系统剪贴板权限。",
      );
    }
  }

  async function pasteIntoContextInput() {
    const target = contextTargetRef.current;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      const next =
        target.value.slice(0, start) +
        text +
        target.value.slice(end);
      const descriptor = Object.getOwnPropertyDescriptor(
        target instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype,
        "value",
      );
      descriptor?.set?.call(target, next);
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
        data: text,
      }));
      target.focus();
      target.setSelectionRange(start + text.length, start + text.length);
    } catch {
      setToast("无法读取剪贴板；请使用 Ctrl+V。");
    }
  }

  function saveVersion() {
    if (selectedNote === undefined) {
      return;
    }
    void saveVersionFor(selectedNote);
  }

  async function saveVersionFor(note: LearningNote) {
    if (!nativeRuntime) {
      setWorkspace((current) => addSnapshot(current, note));
      setToast(`已保存“${note.title}”的手动版本。`);
      return;
    }
    try {
      const currentHistory =
        nativeVersionHistory?.noteId === note.id
          ? nativeVersionHistory
          : await loadNativeVersionHistory(note.id);
      const result = await saveNativeVersion(
        note.id,
        note.title,
        note.markdown,
        currentHistory.head,
      );
      if (activeNoteIdRef.current === note.id) {
        applyNativeHistory(result.history);
      }
      setToast(
        result.created
          ? `已持久保存“${note.title}”的增量版本。`
          : "正文与当前分支头完全相同，没有创建重复版本。",
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      if (failure?.code === "versionConflict") {
        if (activeNoteIdRef.current === note.id) {
          void loadNativeVersionHistory(note.id).then(applyNativeHistory);
        }
        setToast("版本分支头已在另一窗口变化；已刷新版本图，没有覆盖它。");
      } else {
        setToast(
          failure?.code === "historyCorrupt"
            ? "版本库完整性检查失败；没有重建或覆盖历史。"
            : "版本未保存；Markdown 正文仍保持原样。",
        );
      }
    }
  }

  async function restoreVersion(snapshot: NoteSnapshot) {
    if (!nativeRuntime) {
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
      const previewNote = workspace.notes.find(
        (item) => item.id === snapshot.noteId,
      );
      if (previewNote !== undefined) {
        activateNote(previewNote);
      }
      setToast("已恢复所选版本；恢复前内容已自动备份。");
      return;
    }

    const note = workspace.notes.find((item) => item.id === snapshot.noteId);
    if (
      note?.path === undefined ||
      note.revision === undefined ||
      note.lineEnding === undefined
    ) {
      setToast("当前知识节点缺少可验证的文件状态，未执行恢复。");
      return;
    }
    if (note.lineEnding === "mixed") {
      setToast("请先明确规范化混合换行，再恢复历史版本。");
      return;
    }
    if (savingNoteIdsRef.current.has(note.id)) {
      setToast("当前 Markdown 正在保存，请稍后再恢复版本。");
      return;
    }

    savingNoteIdsRef.current.add(note.id);
    setSaveState("saving");
    try {
      const target = await readNativeVersion(snapshot.id);
      const expectedHead =
        nativeVersionHistory?.noteId === note.id
          ? nativeVersionHistory.head
          : (workspace.versionHeads[note.id] ?? null);
      const backup = await saveNativeVersion(
        note.id,
        note.title,
        note.markdown,
        expectedHead,
        "恢复历史版本前的自动保护",
      );
      const saved = await saveNativeNote({
        path: note.path,
        markdown: target.markdown,
        revision: note.revision,
        lineEnding: note.lineEnding,
        hasUtf8Bom: note.hasUtf8Bom ?? false,
      });
      const restoredNote = nativeDocumentToLearningNote(saved.document);
      lastPersistedMarkdownRef.current.set(note.id, target.markdown);
      latestMarkdownRef.current.set(note.id, target.markdown);
      setWorkspace((current) => ({
        ...current,
        notes: current.notes.map((candidate) =>
          candidate.id === note.id ? restoredNote : candidate,
        ),
        selectedNoteId: note.id,
      }));
      setActiveNoteId(note.id);
      setOpenNoteIds((current) =>
        current.includes(note.id) ? current : [...current, note.id],
      );
      setClosedNoteIds((current) =>
        current.filter((candidate) => candidate !== note.id),
      );
      setActiveView(restoredNote.view);
      setSaveState("saved");

      try {
        const history = await checkoutNativeVersion(
          note.id,
          snapshot.id,
          backup.history.head,
        );
        applyNativeHistory(history);
        setToast(
          "已校验并恢复所选版本；恢复前内容已保存为独立版本，从这里继续保存会形成分支。",
        );
      } catch {
        const history = await loadNativeVersionHistory(note.id);
        applyNativeHistory(history);
        setToast(
          "磁盘正文已安全恢复，但另一窗口改变了分支头；版本图已刷新，未覆盖对方历史。",
        );
      }
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setSaveState(
        failure?.code === "conflict" || failure?.code === "versionConflict"
          ? "conflict"
          : "error",
      );
      setToast(
        failure?.code === "historyCorrupt"
          ? "历史内容完整性校验失败，未写入 Markdown。"
          : failure?.code === "conflict"
            ? "磁盘文件已在外部变化；恢复前备份已保留，但没有覆盖磁盘。"
            : failure?.code === "versionConflict"
              ? "版本分支头已变化；恢复未继续，也没有覆盖现有历史。"
              : "版本恢复未完成；当前 Markdown 和可用历史均保留。",
      );
    } finally {
      savingNoteIdsRef.current.delete(note.id);
      setSaveRetry((value) => value + 1);
    }
  }

  async function deleteVersion(snapshot: NoteSnapshot) {
    const confirmed = window.confirm(
      `删除“${snapshot.noteTitle}”在 ${formatDate(snapshot.createdAt)} 的版本节点？后续分支会自动重接，笔记正文不会被删除。`,
    );
    if (!confirmed) {
      return;
    }
    if (nativeRuntime) {
      const expectedHead =
        nativeVersionHistory?.noteId === snapshot.noteId
          ? nativeVersionHistory.head
          : (workspace.versionHeads[snapshot.noteId] ?? null);
      try {
        const result = await deleteNativeVersion(
          snapshot.noteId,
          snapshot.id,
          expectedHead,
        );
        applyNativeHistory(result.history);
        setToast(
          result.releasedBytes > 0
            ? `版本节点已删除并释放 ${formatBytes(result.releasedBytes)}；后续分支仍可独立恢复。`
            : "版本节点已删除；共享内容块仍被其他版本引用，没有误删。",
        );
      } catch (error: unknown) {
        const failure = asWorkspaceFailure(error);
        if (failure?.code === "versionConflict") {
          void loadNativeVersionHistory(snapshot.noteId).then(
            applyNativeHistory,
          );
          setToast("分支头已在另一窗口变化；已刷新版本图，没有执行删除。");
        } else {
          setToast(
            failure?.code === "historyCorrupt"
              ? "版本库完整性检查失败，没有删除或重建任何历史。"
              : "版本节点未删除；现有历史保持不变。",
          );
        }
      }
      return;
    }
    const before = workspace.snapshots.reduce(
      (total, item) => total + snapshotStorageBytes(item),
      0,
    );
    const next = deleteSnapshot(workspace, snapshot.id);
    if (next === workspace) {
      setToast("版本图未改变：节点数据无法安全重接。");
      return;
    }
    const after = next.snapshots.reduce(
      (total, item) => total + snapshotStorageBytes(item),
      0,
    );
    setWorkspace(next);
    const released = Math.max(0, before - after);
    setToast(
      released > 0
        ? `版本节点已删除，释放约 ${formatBytes(released)}。`
        : "版本节点已删除；子分支已重接并保持可恢复。",
    );
  }

  function resetDemoData() {
    if (nativeRuntime) {
      setToast(
        "原生 Markdown 工作区不会执行演示重置；请通过明确的笔记操作管理文件。",
      );
      return;
    }
    const confirmed = window.confirm(
      "这会清除当前设备上的全部知织演示笔记、任务状态和本地版本。确定继续吗？",
    );
    if (!confirmed) {
      return;
    }
    const initial = createInitialWorkspace();
    setWorkspace(initial);
    setActiveNoteId(initial.selectedNoteId);
    setOpenNoteIds([initial.selectedNoteId]);
    setClosedNoteIds([]);
    setActiveView("continue");
    setEditorMode("edit");
    setQuery("");
    setToast("本机演示数据已重置。");
  }

  function closeTab(noteId: string) {
    const index = openNoteIds.indexOf(noteId);
    if (index < 0) {
      return;
    }
    const remaining = openNoteIds.filter((id) => id !== noteId);
    setOpenNoteIds(remaining);
    setClosedNoteIds((current) => [
      noteId,
      ...current.filter((id) => id !== noteId),
    ].slice(0, 20));
    if (activeNoteId !== noteId) {
      return;
    }
    const nextId = remaining[Math.min(index, remaining.length - 1)] ?? null;
    setActiveNoteId(nextId);
    const next = workspace.notes.find((note) => note.id === nextId);
    if (next !== undefined) {
      setWorkspace((current) => ({
        ...current,
        selectedNoteId: next.id,
      }));
      setActiveView(next.view);
    }
  }

  function closeActiveTab() {
    if (activeView === "versions") {
      if (selectedNote !== undefined) {
        setActiveView(selectedNote.view);
      } else {
        setActiveView("continue");
      }
      return;
    }
    if (activeNoteId !== null) {
      closeTab(activeNoteId);
    }
  }

  function closeOtherTabs(note: LearningNote) {
    const closed = openNoteIds.filter((id) => id !== note.id);
    activateNote(note);
    setOpenNoteIds([note.id]);
    setClosedNoteIds((current) => [
      ...closed,
      ...current.filter((id) => id !== note.id && !closed.includes(id)),
    ].slice(0, 20));
  }

  function openVersionsFor(note: LearningNote) {
    activateNote(note);
    setActiveView("versions");
  }

  function openSplitFor(note: LearningNote) {
    activateNote(note);
    setEditorMode("split");
  }

  function reopenClosedTab() {
    const id = closedNoteIds[0];
    const note = workspace.notes.find((item) => item.id === id);
    if (note === undefined) {
      return;
    }
    setClosedNoteIds((current) => current.slice(1));
    activateNote(note);
  }

  function cycleTab(direction: 1 | -1) {
    if (openNoteIds.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, openNoteIds.indexOf(activeNoteId ?? ""));
    const nextIndex =
      (currentIndex + direction + openNoteIds.length) % openNoteIds.length;
    const note = workspace.notes.find(
      (item) => item.id === openNoteIds[nextIndex],
    );
    if (note !== undefined) {
      activateNote(note);
    }
  }

  function openContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    const target = event.target instanceof HTMLElement
      ? event.target
      : event.currentTarget;
    const contextElement = target.closest<HTMLElement>("[data-context]");
    const nativeInput = target.closest("input, textarea");
    contextTargetRef.current =
      nativeInput instanceof HTMLElement ? nativeInput : target;
    const dataScope = contextElement?.dataset.context;
    const scope: ContextMenuState["scope"] =
      nativeInput !== null
        ? "input"
        : isContextScope(dataScope)
          ? dataScope
          : "workspace";
    const nativeSelection =
      nativeInput instanceof HTMLInputElement ||
      nativeInput instanceof HTMLTextAreaElement
        ? Math.abs(
            (nativeInput.selectionEnd ?? 0) -
            (nativeInput.selectionStart ?? 0),
          )
        : 0;
    const hasSelection =
      nativeSelection > 0 ||
      (scope === "editor" && editorStatus.selectionLength > 0) ||
      (window.getSelection()?.toString().length ?? 0) > 0;
    const width = 248;
    const height = 480;
    setContextMenu({
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - width - 4)),
      y: Math.max(34, Math.min(event.clientY, window.innerHeight - height - 4)),
      scope,
      hasSelection,
      ...(contextElement?.dataset.noteId === undefined
        ? {}
        : { noteId: contextElement.dataset.noteId }),
      ...(contextElement?.dataset.snapshotId === undefined
        ? {}
        : { snapshotId: contextElement.dataset.snapshotId }),
    });
  }

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const commandKey = event.ctrlKey || event.metaKey;
      if (!commandKey) {
        if (event.key === "Escape") {
          setContextMenu(null);
        } else if (event.key === "F2" && nativeRuntime) {
          const focused = document.activeElement?.closest<HTMLElement>(
            '[data-context="note-item"], [data-context="tab"]',
          );
          const note = workspace.notes.find(
            (candidate) => candidate.id === focused?.dataset.noteId,
          );
          if (note !== undefined) {
            event.preventDefault();
            void renameNoteFile(note);
          }
        }
        return;
      }
      const key = event.key.toLocaleLowerCase();
      if (key === "b" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setIsSidebarOpen((value) => !value);
      } else if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        setIsSidebarOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (key === "s" && event.altKey && !event.shiftKey) {
        event.preventDefault();
        saveVersion();
      } else if (key === "s" && !event.shiftKey) {
        event.preventDefault();
        if (nativeRuntime) {
          setSaveRetry((value) => value + 1);
          setToast("正在保存当前 Markdown 源文件。");
        } else {
          setToast("浏览器预览状态已保存在此浏览器。");
        }
      } else if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        openNewNote();
      } else if (key === "w" && !event.shiftKey) {
        event.preventDefault();
        closeActiveTab();
      } else if (key === "tab") {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      } else if (key === "t" && event.shiftKey) {
        event.preventDefault();
        reopenClosedTab();
      } else if (key === "v" && event.shiftKey) {
        event.preventDefault();
        setEditorMode("preview");
      } else if (key === "\\" && !event.shiftKey) {
        event.preventDefault();
        setEditorMode("split");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const pageTitle =
    activeView === "versions"
      ? "本地版本历史"
      : selectedNote?.title ?? "没有打开的笔记";
  const editorLabel = activeView === "versions"
    ? "版本"
    : editorMode === "preview"
      ? "预览"
      : editorMode === "split"
        ? "实时分栏"
        : "Markdown";
  const saveStatusLabel = nativeRuntime
    ? {
        loading: "正在打开 Markdown 工作区",
        saved: "Markdown 源文件已安全保存",
        dirty: "有尚未保存的修改",
        saving: "正在原子保存",
        conflict: "检测到外部修改（点击安全恢复）",
        error: "保存失败（点击重试）",
        mixed: "混合换行（点击明确统一为 LF）",
        preview: "浏览器预览",
      }[saveState]
    : "浏览器预览：仅保存在此浏览器";
  const lineEndingLabel =
    selectedNote?.lineEnding?.toLocaleUpperCase() ??
    (nativeRuntime ? "—" : "LF");
  const saveStatusActionable =
    nativeRuntime &&
    (saveState === "conflict" ||
      saveState === "error" ||
      saveState === "mixed");
  const indexStatusLabel = !nativeRuntime
    ? "搜索：浏览器内存"
    : nativeIndex?.state === "ready"
      ? `索引：${nativeIndex.noteCount} 篇`
      : nativeIndex?.issue === "rebuilding"
        ? "正在重建索引"
        : nativeIndex?.state === "needsRebuild"
          ? "索引需重建"
          : "索引不可用";
  const indexStatusActionable =
    nativeRuntime && nativeIndex?.state !== "ready";
  const externalChangeCount = externalChanges?.changes.length ?? 0;
  const externalChangeSummary =
    externalChanges === null
      ? ""
      : externalChanges.changes
          .map(
            (change) =>
              `${workspaceChangeKindLabel(change.kind)}：` +
              (change.currentPath ?? change.previousPath ?? change.id),
          )
          .join("\n");
  const contextNote =
    contextMenu?.noteId === undefined
      ? selectedNote
      : workspace.notes.find((note) => note.id === contextMenu.noteId);
  const contextSnapshot =
    contextMenu?.snapshotId === undefined
      ? undefined
      : workspace.snapshots.find(
          (snapshot) => snapshot.id === contextMenu.snapshotId,
        );

  return (
    <main
      className={`app-shell${isSidebarOpen ? "" : " is-sidebar-collapsed"}`}
      onContextMenu={openContextMenu}
    >
      <header
        className="app-titlebar"
        data-context="titlebar"
        data-tauri-drag-region
        onDoubleClick={() => void runWindowAction("maximize")}
      >
        <div className="titlebar-identity" data-tauri-drag-region>
          <BrainCircuit />
          <span data-tauri-drag-region>知织</span>
          <small data-tauri-drag-region>
            {selectedNote?.title ?? VIEW_COPY[activeView].label}
          </small>
        </div>
        <div className="window-controls">
          <button
            aria-label="最小化窗口"
            onClick={() => void runWindowAction("minimize")}
            title="最小化"
            type="button"
          >
            <Minus />
          </button>
          <button
            aria-label="最大化或还原窗口"
            onClick={() => void runWindowAction("maximize")}
            title="最大化或还原"
            type="button"
          >
            <Maximize2 />
          </button>
          <button
            aria-label="关闭窗口"
            className="close-window"
            onClick={() => void runWindowAction("close")}
            title="关闭"
            type="button"
          >
            <X />
          </button>
        </div>
      </header>

      <aside
        className="activity-bar"
        aria-label="主要区域"
        data-context="activity"
      >
        <button
          aria-label="显示或隐藏笔记栏"
          className="activity-brand"
          onClick={() => setIsSidebarOpen((value) => !value)}
          title="显示或隐藏笔记栏"
          type="button"
        >
          <BrainCircuit />
        </button>

        <nav aria-label="学习导航">
          {PRIMARY_NAVIGATION.map(({ key, icon: Icon }) => (
            <button
              aria-current={activeView === key ? "page" : undefined}
              aria-label={VIEW_COPY[key].label}
              className={activeView === key ? "is-active" : ""}
              key={key}
              onClick={() => navigate(key)}
              title={VIEW_COPY[key].label}
              type="button"
            >
              <Icon />
            </button>
          ))}
        </nav>

        <nav className="activity-secondary" aria-label="工作区工具">
          {SECONDARY_NAVIGATION.map(({ key, icon: Icon }) => (
            <button
              aria-current={activeView === key ? "page" : undefined}
              aria-label={VIEW_COPY[key].label}
              className={activeView === key ? "is-active" : ""}
              key={key}
              onClick={() => navigate(key)}
              title={VIEW_COPY[key].label}
              type="button"
            >
              <Icon />
            </button>
          ))}
        </nav>
      </aside>

      <aside
        className="explorer"
        aria-label="笔记栏"
        data-context="explorer"
      >
        <header className="explorer-header">
          <div>
            <span>{VIEW_COPY[activeView].label}</span>
            <small>{visibleNotes.length} 条笔记</small>
          </div>
          <div className="explorer-actions">
            {activeView === "today" && (
              <button
                aria-label="打开今日日记"
                onClick={openTodayJournal}
                title="打开今日日记"
                type="button"
              >
                <NotebookPen />
              </button>
            )}
            <button
              aria-label="新建笔记"
              onClick={openNewNote}
              title="新建笔记"
              type="button"
            >
              <Plus />
            </button>
          </div>
        </header>

        <div className="sidebar-search">
          <label>
            <Search />
            <input
              aria-label="搜索笔记"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索笔记"
              ref={searchInputRef}
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
        </div>

        <section className="note-list" aria-label="笔记列表">
          <h2>{query.trim().length > 0 ? "搜索结果" : "笔记"}</h2>
          {(query.trim().length > 0 ? results : visibleNotes).map((note) => (
            <button
              className={note.id === selectedNote?.id ? "is-current" : ""}
              data-context="note-item"
              data-note-id={note.id}
              key={note.id}
              onClick={() => selectNote(note)}
              type="button"
            >
              <span>{note.title}</span>
              <small>{formatRelativeDate(note.updatedAt)}</small>
            </button>
          ))}
          {query.trim().length > 0 && results.length === 0 && (
            <p className="sidebar-empty">
              {nativeSearchState === "searching"
                ? "正在搜索本地索引…"
                : nativeSearchState === "error"
                  ? "全文索引不可用，请从底部状态栏重建"
                  : "没有匹配的笔记"}
            </p>
          )}
          {query.trim().length === 0 && visibleNotes.length === 0 && (
            <p className="sidebar-empty">这个区域还没有笔记</p>
          )}
        </section>

        <footer className="explorer-footer">
          <span title={nativeRoot}>
            {nativeRuntime
              ? nativeRoot.length > 0
                ? "Markdown 文件是内容事实源"
                : "正在打开本地工作区"
              : "浏览器预览数据，不是桌面端文件"}
          </span>
        </footer>
      </aside>

      <section className="workspace">
        <header className="workbench-toolbar">
          <div className="document-trail">
            <button
              aria-label="显示或隐藏笔记栏"
              onClick={() => setIsSidebarOpen((value) => !value)}
              title="显示或隐藏笔记栏"
              type="button"
            >
              <Menu />
            </button>
            <span>{VIEW_COPY[activeView].label}</span>
            <i>/</i>
            <strong title={pageTitle}>{pageTitle}</strong>
          </div>

          <div className="header-actions">
            {activeView === "versions" ? (
              <button
                className="primary"
                disabled={selectedNote === undefined}
                onClick={saveVersion}
                type="button"
              >
                <Save />
                <span>保存当前版本</span>
              </button>
            ) : (
              <>
                <div className="editor-mode-switch" aria-label="编辑器显示模式">
                  <button
                    aria-pressed={editorMode === "edit"}
                    className={editorMode === "edit" ? "is-active" : ""}
                    onClick={() => setEditorMode("edit")}
                    title="编辑"
                    type="button"
                  >
                    <PencilLine />
                    <span>编辑</span>
                  </button>
                  <button
                    aria-pressed={editorMode === "split"}
                    className={editorMode === "split" ? "is-active" : ""}
                    onClick={() => setEditorMode("split")}
                    title="实时分栏预览 (Ctrl+\\)"
                    type="button"
                  >
                    <Columns2 />
                    <span>分栏</span>
                  </button>
                  <button
                    aria-pressed={editorMode === "preview"}
                    className={editorMode === "preview" ? "is-active" : ""}
                    onClick={() => setEditorMode("preview")}
                    title="Markdown 预览 (Ctrl+Shift+V)"
                    type="button"
                  >
                    <BookOpenText />
                    <span>预览</span>
                  </button>
                </div>
                <button
                  onClick={createUuidLab}
                  title="新建 UUID 交互实验"
                  type="button"
                >
                  <FlaskConical />
                  <span>交互实验</span>
                </button>
                <button onClick={saveVersion} title="保存版本" type="button">
                  <Save />
                  <span>保存版本</span>
                </button>
                <button
                  className="primary"
                  onClick={() => void copyForAi()}
                  title="复制给 AI"
                  type="button"
                >
                  <Sparkles />
                  <span>复制给 AI</span>
                </button>
              </>
            )}
          </div>
        </header>

        <div className="editor-tabs" role="tablist" aria-label="打开的笔记">
          {activeView === "versions" ? (
            <div aria-selected="true" className="is-active" role="tab">
              <button
                className="tab-main"
                onClick={() => undefined}
                type="button"
              >
                <GitBranch />
                <strong>本地版本历史</strong>
              </button>
              <button
                aria-label="关闭版本标签"
                className="tab-close"
                onClick={closeActiveTab}
                title="关闭 (Ctrl+W)"
                type="button"
              >
                <X />
              </button>
            </div>
          ) : (
            openNotes.map((note) => (
              <div
                aria-selected={note.id === activeNoteId}
                className={note.id === activeNoteId ? "is-active" : ""}
                data-context="tab"
                data-note-id={note.id}
                key={note.id}
                role="tab"
              >
                <button
                  className="tab-main"
                  onClick={() => activateNote(note)}
                  title={note.title}
                  type="button"
                >
                  <span>#</span>
                  <strong>{note.title}</strong>
                </button>
                <button
                  aria-label={`关闭 ${note.title}`}
                  className="tab-close"
                  onClick={() => closeTab(note.id)}
                  title="关闭 (Ctrl+W)"
                  type="button"
                >
                  <X />
                </button>
              </div>
            ))
          )}
        </div>

        <section className="editor-stage" data-context="workspace">
          {activeView === "versions" ? (
            <VersionHistory
              currentNote={selectedNote}
              isNative={nativeRuntime}
              nativeHistory={nativeVersionHistory}
              onDelete={deleteVersion}
              onReset={resetDemoData}
              onRestore={restoreVersion}
              workspace={workspace}
            />
          ) : selectedNote === undefined ? (
            <EmptyWorkspace onCreate={openNewNote} />
          ) : editorMode === "preview" ? (
            <MarkdownPreview markdown={selectedNote.markdown} />
          ) : editorMode === "split" ? (
            <div className="editor-split">
              <MarkdownEditor
                key={selectedNote.id}
                onChange={updateMarkdown}
                onStatusChange={setEditorStatus}
                ref={editorRef}
                value={selectedNote.markdown}
              />
              <MarkdownPreview markdown={selectedNote.markdown} />
            </div>
          ) : (
            <MarkdownEditor
              key={selectedNote.id}
              onChange={updateMarkdown}
              onStatusChange={setEditorStatus}
              ref={editorRef}
              value={selectedNote.markdown}
            />
          )}
        </section>

        <footer className="status-bar" data-context="status">
          <button
            aria-disabled={!saveStatusActionable}
            className={`save-status is-${saveState}`}
            onClick={() => void handleSaveStatusAction()}
            tabIndex={saveStatusActionable ? 0 : -1}
            title={saveStatusLabel}
            type="button"
          >
            <i />
            {saveStatusLabel}
          </button>
          <button
            aria-disabled={!indexStatusActionable}
            className={`status-index is-${nativeIndex?.state ?? "preview"}`}
            onClick={() => {
              if (indexStatusActionable) {
                void rebuildSearchIndex();
              }
            }}
            tabIndex={indexStatusActionable ? 0 : -1}
            title={
              nativeIndex?.issue === null || nativeIndex?.issue === undefined
                ? indexStatusLabel
                : `${indexStatusLabel}（${nativeIndex.issue}）`
            }
            type="button"
          >
            <Database />
            {indexStatusLabel}
          </button>
          {externalChangeCount > 0 && (
            <button
              className="status-external"
              onClick={() => setIsExternalChangesOpen(true)}
              title={externalChangeSummary}
              type="button"
            >
              <GitFork />
              外部更改：{externalChangeCount}
            </button>
          )}
          <span className="status-version" title="当前版本节点数">
            <GitBranch />
            {selectedNote === undefined
              ? 0
              : workspace.snapshots.filter(
                  (snapshot) => snapshot.noteId === selectedNote.id,
                ).length}
          </span>
          {editorStatus.selectionLength > 0 && (
            <span className="status-selection">
              已选择 {editorStatus.selectionLength} 字符
            </span>
          )}
          <span className="status-cursor">
            行 {editorStatus.line}，列 {editorStatus.column}
          </span>
          <span className="status-lines">{editorStatus.lines} 行</span>
          <span className="status-words">{editorStatus.words} 词</span>
          <span className="status-characters">
            {editorStatus.characters} 字符
          </span>
          <span className="status-encoding">
            UTF-8{selectedNote?.hasUtf8Bom ? " BOM" : ""}
          </span>
          <span className="status-line-ending">{lineEndingLabel}</span>
          <span className="status-mode">{editorLabel}</span>
          <span className="status-sync" title="同步服务尚未连接">
            同步：本机
          </span>
          <span className="status-protocol">
            {status?.protocol ?? "ZHIWEAVE/1"}
          </span>
        </footer>
      </section>

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
                <span className="eyebrow">新建笔记</span>
                <h2 id="new-note-title">从一个问题开始</h2>
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
                位置
                <select
                  onChange={(event) =>
                    setNewView(
                      event.target.value as Exclude<ViewKey, "versions">,
                    )}
                  value={newView}
                >
                  {NOTE_VIEWS.map((view) => (
                    <option key={view} value={view}>
                      {VIEW_COPY[view].label}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {nativeRuntime
                  ? "创建后立即写入本地 Markdown 工作区。"
                  : "浏览器模式仅用于界面预览，不会创建桌面端文件。"}
              </p>
              <footer>
                <button onClick={() => setIsNewNoteOpen(false)} type="button">
                  取消
                </button>
                <button
                  className="primary"
                  disabled={newTitle.trim().length === 0}
                  type="submit"
                >
                  <Plus />
                  创建笔记
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {isExternalChangesOpen && externalChanges !== null && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="external-changes-title"
            aria-modal="true"
            className="external-changes-modal"
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">Windows 文件变化</span>
                <h2 id="external-changes-title">外部更改中心</h2>
                <p>
                  这些结果来自完整磁盘核对，不是未经验证的监听事件。
                </p>
              </div>
              <button
                aria-label="关闭外部更改中心"
                disabled={isResolvingExternalChanges}
                onClick={() => setIsExternalChangesOpen(false)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="external-change-list">
              {externalChanges.changes.map((change) => {
                const local = workspace.notes.find(
                  (note) => note.id === change.id,
                );
                const hasLocalEdits =
                  local !== undefined &&
                  lastPersistedMarkdownRef.current.get(local.id) !==
                    local.markdown;
                return (
                  <article
                    className={hasLocalEdits ? "has-conflict" : ""}
                    key={`${change.kind}:${change.id}`}
                  >
                    <span className={`change-kind is-${change.kind}`}>
                      {workspaceChangeKindLabel(change.kind)}
                    </span>
                    <div>
                      <strong>
                        {change.currentTitle ??
                          local?.title ??
                          change.previousPath ??
                          "未知节点"}
                      </strong>
                      <p>
                        {change.kind === "moved"
                          ? `${change.previousPath} → ${change.currentPath}`
                          : (change.currentPath ??
                            change.previousPath ??
                            change.id)}
                      </p>
                      {change.kind === "moved" &&
                        change.contentChanged && (
                          <small>移动时正文也发生了变化</small>
                        )}
                    </div>
                    {hasLocalEdits && <em>保留着未保存编辑</em>}
                  </article>
                );
              })}
            </div>
            <footer>
              <p>
                “安全应用”会刷新无冲突笔记，并继续保留有冲突的编辑缓冲。
              </p>
              <div>
                <button
                  disabled={isResolvingExternalChanges}
                  onClick={() => setIsExternalChangesOpen(false)}
                  type="button"
                >
                  稍后处理
                </button>
                <button
                  disabled={isResolvingExternalChanges}
                  onClick={() => void applyVerifiedExternalChanges()}
                  type="button"
                >
                  <RotateCcw />
                  安全应用无冲突更改
                </button>
                <button
                  className="primary"
                  disabled={isResolvingExternalChanges}
                  onClick={() => void recoverEditsAndAcceptExternalChanges()}
                  type="button"
                >
                  <Save />
                  {isResolvingExternalChanges
                    ? "正在创建恢复副本…"
                    : "备份编辑并接受磁盘版本"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {toast.length > 0 && (
        <div className="toast" role="status">
          <CheckCircle2 />
          <span>{toast}</span>
        </div>
      )}

      {contextMenu !== null && (
        <section
          aria-label="知织命令菜单"
          className="context-menu"
          onContextMenu={(event) => event.preventDefault()}
          onMouseDown={(event) => {
            if (contextMenu.hasSelection) {
              event.preventDefault();
            }
          }}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <span className="context-heading">
            {contextMenuLabel(contextMenu.scope, contextNote, contextSnapshot)}
          </span>

          {contextMenu.hasSelection && (
            <>
              <span className="context-label">选中内容</span>
              <button
                onClick={() => document.execCommand("copy")}
                role="menuitem"
              >
                <Copy />
                复制选中内容
                <kbd>Ctrl+C</kbd>
              </button>
              {contextMenu.scope === "input" && (
                <button
                  onClick={() => document.execCommand("cut")}
                  role="menuitem"
                >
                  <Trash2 />
                  剪切选中内容
                  <kbd>Ctrl+X</kbd>
                </button>
              )}
            </>
          )}

          {contextMenu.scope === "input" && (
            <>
              <span className="context-label">文本输入</span>
              <button
                onClick={() => void pasteIntoContextInput()}
                role="menuitem"
              >
                <NotebookPen />
                粘贴
                <kbd>Ctrl+V</kbd>
              </button>
              <button
                onClick={() => document.execCommand("selectAll")}
                role="menuitem"
              >
                <CheckCircle2 />
                全选
                <kbd>Ctrl+A</kbd>
              </button>
            </>
          )}

          {(contextMenu.scope === "editor" ||
            contextMenu.scope === "preview" ||
            contextMenu.scope === "embedded-lab") && (
            <>
              <span className="context-label">
                {contextMenu.scope === "embedded-lab" ? "当前实验" : "当前笔记"}
              </span>
              {contextMenu.scope === "editor" && (
                <>
                  <button
                    disabled={editorStatus.undoDepth === 0}
                    onClick={() => editorRef.current?.undo()}
                    role="menuitem"
                  >
                    <RotateCcw />
                    撤销
                    <kbd>Ctrl+Z</kbd>
                  </button>
                  <button
                    disabled={editorStatus.redoDepth === 0}
                    onClick={() => editorRef.current?.redo()}
                    role="menuitem"
                  >
                    <RotateCcw />
                    重做
                    <kbd>Ctrl+Y</kbd>
                  </button>
                </>
              )}
              <button
                disabled={contextNote === undefined}
                onClick={() => {
                  if (contextNote !== undefined) {
                    saveVersionFor(contextNote);
                  }
                }}
                role="menuitem"
              >
                <Save />
                保存版本节点
                <kbd>Ctrl+Alt+S</kbd>
              </button>
              <button
                disabled={contextNote === undefined}
                onClick={() => void copyForAi(contextNote)}
                role="menuitem"
              >
                <Sparkles />
                复制节点学习提示词
              </button>
              <button onClick={() => setEditorMode("edit")} role="menuitem">
                <PencilLine />
                切换到编辑
              </button>
              <button onClick={() => setEditorMode("split")} role="menuitem">
                <Columns2 />
                实时分栏预览
                <kbd>Ctrl+\</kbd>
              </button>
              <button onClick={() => setEditorMode("preview")} role="menuitem">
                <BookOpenText />
                切换到阅读预览
                <kbd>Ctrl+⇧V</kbd>
              </button>
              <button
                disabled={contextNote === undefined}
                onClick={() => {
                  if (contextNote !== undefined) {
                    openVersionsFor(contextNote);
                  }
                }}
                role="menuitem"
              >
                <GitBranch />
                查看这个节点的版本图
              </button>
            </>
          )}

          {contextMenu.scope === "status" && (
            <>
              <span className="context-label">保存与工作区</span>
              <button
                disabled={
                  !nativeRuntime ||
                  !["conflict", "error", "mixed"].includes(saveState)
                }
                onClick={() => void handleSaveStatusAction()}
                role="menuitem"
              >
                <Save />
                {saveState === "conflict"
                  ? "备份编辑内容并重新载入"
                  : saveState === "mixed"
                    ? "明确统一为 LF 并保存"
                    : "重试保存"}
              </button>
              <button
                disabled={!nativeRuntime || nativeRoot.length === 0}
                onClick={() => {
                  void copyText(nativeRoot).then(
                    () => setToast("Markdown 工作区位置已复制。"),
                    () => setToast("无法复制工作区位置。"),
                  );
                }}
                role="menuitem"
              >
                <Database />
                复制 Markdown 工作区位置
              </button>
              <button
                disabled={externalChanges === null}
                onClick={() => setIsExternalChangesOpen(true)}
                role="menuitem"
              >
                <GitFork />
                查看外部文件更改
              </button>
              <button
                disabled={!nativeRuntime}
                onClick={() => void rebuildSearchIndex()}
                role="menuitem"
              >
                <RotateCcw />
                从 Markdown 重建全文索引
              </button>
              {!nativeRuntime && (
                <button onClick={resetDemoData} role="menuitem">
                  <RotateCcw />
                  重置浏览器预览数据
                </button>
              )}
            </>
          )}

          {(contextMenu.scope === "note-item" ||
            contextMenu.scope === "tab") && contextNote !== undefined && (
            <>
              <span className="context-label">
                {contextMenu.scope === "tab" ? "标签" : "知识节点"}
              </span>
              <button
                onClick={() => activateNote(contextNote)}
                role="menuitem"
              >
                <BookOpenText />
                打开“{contextNote.title}”
              </button>
              <button
                onClick={() => openSplitFor(contextNote)}
                role="menuitem"
              >
                <Columns2 />
                打开并实时预览
              </button>
              <button
                onClick={() => void copyNoteTitle(contextNote)}
                role="menuitem"
              >
                <Copy />
                复制节点名称
              </button>
              {nativeRuntime && (
                <button
                  disabled={
                    contextNote.path === undefined ||
                    contextNote.revision === undefined ||
                    lastPersistedMarkdownRef.current.get(contextNote.id) !==
                      contextNote.markdown
                  }
                  onClick={() => void renameNoteFile(contextNote)}
                  role="menuitem"
                >
                  <PencilLine />
                  移动或重命名 Markdown
                  <kbd>F2</kbd>
                </button>
              )}
              <button
                onClick={() => void copyForAi(contextNote)}
                role="menuitem"
              >
                <Sparkles />
                复制学习提示词
              </button>
              <button
                onClick={() => saveVersionFor(contextNote)}
                role="menuitem"
              >
                <Save />
                保存这个节点的版本
              </button>
              <button
                onClick={() => openVersionsFor(contextNote)}
                role="menuitem"
              >
                <GitBranch />
                查看版本分支图
              </button>
              {contextMenu.scope === "tab" && (
                <>
                  <span className="context-label">标签管理</span>
                  <button
                    onClick={() => closeTab(contextNote.id)}
                    role="menuitem"
                  >
                    <X />
                    关闭这个标签
                    <kbd>Ctrl+W</kbd>
                  </button>
                  <button
                    disabled={openNoteIds.length < 2}
                    onClick={() => closeOtherTabs(contextNote)}
                    role="menuitem"
                  >
                    <X />
                    关闭其他标签
                  </button>
                  <button
                    disabled={closedNoteIds.length === 0}
                    onClick={reopenClosedTab}
                    role="menuitem"
                  >
                    <RotateCcw />
                    重新打开已关闭标签
                    <kbd>Ctrl+⇧T</kbd>
                  </button>
                </>
              )}
            </>
          )}

          {contextMenu.scope === "version-node" &&
            contextSnapshot !== undefined && (
              <>
                <span className="context-label">所选版本节点</span>
                <button
                  onClick={() => void restoreVersion(contextSnapshot)}
                  role="menuitem"
                >
                  <RotateCcw />
                  恢复到这个版本
                </button>
                <button
                  onClick={() => void copySnapshotMarkdown(contextSnapshot)}
                  role="menuitem"
                >
                  <Copy />
                  复制这个版本的 Markdown
                </button>
                {contextNote !== undefined && (
                  <button
                    onClick={() => activateNote(contextNote)}
                    role="menuitem"
                  >
                    <BookOpenText />
                    打开所属知识节点
                  </button>
                )}
                <button
                  className="danger"
                  onClick={() => void deleteVersion(contextSnapshot)}
                  role="menuitem"
                >
                  <Trash2 />
                  删除这个版本节点
                </button>
              </>
            )}

          {(contextMenu.scope === "workspace" ||
            contextMenu.scope === "activity" ||
            contextMenu.scope === "explorer") && (
            <>
              <span className="context-label">工作区</span>
              <button onClick={openNewNote} role="menuitem">
                <Plus />
                新建知识节点
                <kbd>Ctrl+N</kbd>
              </button>
              <button onClick={openTodayJournal} role="menuitem">
                <NotebookPen />
                打开今日日记
              </button>
              <button onClick={createUuidLab} role="menuitem">
                <FlaskConical />
                新建 UUID 交互实验
              </button>
              {contextMenu.scope === "explorer" && (
                <button
                  onClick={() => searchInputRef.current?.focus()}
                  role="menuitem"
                >
                  <Search />
                  搜索知识节点
                  <kbd>Ctrl+P</kbd>
                </button>
              )}
              <button
                onClick={() => setIsSidebarOpen((value) => !value)}
                role="menuitem"
              >
                <Menu />
                显示或隐藏笔记栏
                <kbd>Ctrl+B</kbd>
              </button>
            </>
          )}

          {contextMenu.scope === "titlebar" && (
            <>
              <span className="context-label">窗口</span>
              <button
                onClick={() => void runWindowAction("minimize")}
                role="menuitem"
              >
                <Minus />
                最小化
              </button>
              <button
                onClick={() => void runWindowAction("maximize")}
                role="menuitem"
              >
                <Maximize2 />
                最大化或还原
              </button>
              <button
                className="danger"
                onClick={() => void runWindowAction("close")}
                role="menuitem"
              >
                <X />
                关闭知织
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}

interface VersionHistoryProps {
  readonly currentNote: LearningNote | undefined;
  readonly isNative: boolean;
  readonly nativeHistory: NativeVersionHistory | null;
  readonly workspace: WorkspaceState;
  readonly onDelete: (snapshot: NoteSnapshot) => void | Promise<void>;
  readonly onReset: () => void;
  readonly onRestore: (snapshot: NoteSnapshot) => void | Promise<void>;
}

function VersionHistory({
  currentNote,
  isNative,
  nativeHistory,
  workspace,
  onDelete,
  onReset,
  onRestore,
}: VersionHistoryProps) {
  const snapshots = workspace.snapshots;
  const relevant = currentNote === undefined
    ? snapshots
    : snapshots.filter((snapshot) => snapshot.noteId === currentNote.id);
  const graph = buildVersionGraph(
    relevant,
    currentNote === undefined
      ? undefined
      : workspace.versionHeads[currentNote.id],
  );
  const durableStats =
    nativeHistory !== null && nativeHistory.noteId === currentNote?.id
      ? nativeHistory.stats
      : undefined;
  const storedBytes =
    durableStats?.storedBytes ??
    relevant.reduce(
      (total, snapshot) => total + snapshotStorageBytes(snapshot),
      0,
    );
  const fullBytes =
    durableStats?.logicalBytes ??
    relevant.reduce(
      (total, snapshot) => total + snapshot.contentLength,
      0,
    );
  const savedPercent =
    fullBytes === 0
      ? 0
      : Math.max(0, Math.round((1 - storedBytes / fullBytes) * 100));
  return (
    <section className="version-history" aria-label="本地版本历史">
      <div className="version-intro">
        <GitBranch />
        <div>
          <h2>{currentNote?.title ?? "当前笔记"}</h2>
          <p>
            内容块会压缩并跨版本复用；从旧节点恢复后继续保存会形成分支。
          </p>
        </div>
        {!isNative && (
          <button className="reset-workspace" onClick={onReset} type="button">
            重置演示数据
          </button>
        )}
      </div>
      <div className="version-metrics" aria-label="版本存储摘要">
        <span>
          <GitFork />
          <strong>{relevant.length}</strong>
          个节点
        </span>
        <span>
          <Database />
          实际占用 <strong>{formatBytes(storedBytes)}</strong>
        </span>
        {durableStats !== undefined && (
          <span>
            去重内容块 <strong>{durableStats.chunkCount}</strong>
          </span>
        )}
        <span>
          相比完整副本节省 <strong>{savedPercent}%</strong>
        </span>
      </div>
      {isNative && nativeHistory === null ? (
        <div className="empty-state compact">
          <Clock3 />
          <h3>正在校验版本历史</h3>
          <p>知织正在检查版本图、分块清单和本地历史库。</p>
        </div>
      ) : relevant.length === 0 ? (
        <div className="empty-state compact">
          <Clock3 />
          <h3>还没有手动版本</h3>
          <p>点击工具栏中的“保存当前版本”，建立一个可恢复节点。</p>
        </div>
      ) : (
        <div
          className="version-graph"
          style={{
            gridTemplateColumns: `${graph.width}px minmax(0, 1fr)`,
            minHeight: `${graph.height}px`,
          }}
        >
          <svg
            aria-label="版本分支关系"
            height={graph.height}
            role="img"
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            width={graph.width}
          >
            {graph.edges.map((edge) => (
              <path
                className={`version-lane lane-${edge.lane % 7}`}
                d={edge.path}
                key={`${edge.from}-${edge.to}`}
              />
            ))}
            {graph.rows.map((row) => (
              <circle
                className={`version-node lane-${row.lane % 7}`}
                cx={row.x}
                cy={row.y}
                key={row.snapshot.id}
                r={row.isHead ? 6 : 5}
              />
            ))}
          </svg>
          <div className="version-cards">
            {graph.rows.map((row) => {
              const markdown =
                row.snapshot.contentHash === undefined
                  ? (resolveSnapshotMarkdown(workspace, row.snapshot.id) ??
                    "")
                  : undefined;
              return (
                <article
                  className={row.isHead ? "is-head" : ""}
                  data-context="version-node"
                  data-note-id={row.snapshot.noteId}
                  data-snapshot-id={row.snapshot.id}
                  key={row.snapshot.id}
                  style={{ height: `${VERSION_GRAPH_ROW_HEIGHT}px` }}
                >
                  <header>
                    <div>
                      <strong>{row.snapshot.noteTitle}</strong>
                      {row.isHead && <span>当前分支头</span>}
                      {row.childCount > 1 && <span>分支节点</span>}
                    </div>
                    <small>{formatDate(row.snapshot.createdAt)}</small>
                  </header>
                  <p>
                    {markdown === undefined
                      ? `内容指纹 ${row.snapshot.contentHash?.slice(0, 12)}… · 完整正文 ${formatBytes(row.snapshot.contentLength)}`
                      : markdown.slice(0, 110).replaceAll("\n", " ")}
                  </p>
                  <footer>
                    <span>
                      {row.snapshot.contentHash === undefined
                        ? `增量 ${formatBytes(snapshotStorageBytes(row.snapshot))}`
                        : `可独立校验 · ${row.snapshot.message ?? "手动版本"}`}
                    </span>
                    <button
                      onClick={() => void onRestore(row.snapshot)}
                      type="button"
                    >
                      <RotateCcw />
                      恢复
                    </button>
                    <button
                      className="danger"
                      onClick={() => void onDelete(row.snapshot)}
                      type="button"
                    >
                      <Trash2 />
                      删除
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function EmptyWorkspace({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <section className="empty-state">
      <FilePlus2 />
      <h2>这里还没有内容</h2>
      <p>创建一条笔记，从问题、证据和下一步开始。</p>
      <button className="primary" onClick={onCreate} type="button">
        <Plus />
        新建笔记
      </button>
    </section>
  );
}

const VERSION_GRAPH_ROW_HEIGHT = 112;

interface VersionGraphRow {
  readonly snapshot: NoteSnapshot;
  readonly lane: number;
  readonly x: number;
  readonly y: number;
  readonly isHead: boolean;
  readonly childCount: number;
}

interface VersionGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly lane: number;
  readonly path: string;
}

function buildVersionGraph(
  snapshots: readonly NoteSnapshot[],
  headId: string | undefined,
): {
  readonly rows: readonly VersionGraphRow[];
  readonly edges: readonly VersionGraphEdge[];
  readonly width: number;
  readonly height: number;
} {
  const chronological = [...snapshots].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const children = new Map<string, NoteSnapshot[]>();
  for (const snapshot of chronological) {
    if (snapshot.parentId === null) {
      continue;
    }
    const items = children.get(snapshot.parentId) ?? [];
    items.push(snapshot);
    children.set(snapshot.parentId, items);
  }

  const laneById = new Map<string, number>();
  let nextLane = 0;
  const assignLane = (snapshot: NoteSnapshot, lane: number) => {
    if (laneById.has(snapshot.id)) {
      return;
    }
    laneById.set(snapshot.id, lane);
    const descendants = children.get(snapshot.id) ?? [];
    descendants.forEach((child, index) => {
      const childLane = index === 0 ? lane : ++nextLane;
      assignLane(child, childLane);
    });
  };
  for (const root of chronological.filter(
    (snapshot) =>
      snapshot.parentId === null ||
      !chronological.some((item) => item.id === snapshot.parentId),
  )) {
    const rootLane = laneById.size === 0 ? 0 : ++nextLane;
    assignLane(root, rootLane);
  }
  for (const snapshot of chronological) {
    if (!laneById.has(snapshot.id)) {
      assignLane(snapshot, ++nextLane);
    }
  }

  const newestFirst = [...chronological].reverse();
  const rows: VersionGraphRow[] = newestFirst.map((snapshot, index) => {
    const lane = laneById.get(snapshot.id) ?? 0;
    return {
      snapshot,
      lane,
      x: 14 + lane * 20,
      y: index * VERSION_GRAPH_ROW_HEIGHT + 20,
      isHead: snapshot.id === headId,
      childCount: children.get(snapshot.id)?.length ?? 0,
    };
  });
  const rowById = new Map(rows.map((row) => [row.snapshot.id, row]));
  const edges: VersionGraphEdge[] = [];
  for (const row of rows) {
    if (row.snapshot.parentId === null) {
      continue;
    }
    const parent = rowById.get(row.snapshot.parentId);
    if (parent === undefined) {
      continue;
    }
    const bendY = parent.y - 18;
    const path =
      row.x === parent.x
        ? `M ${row.x} ${row.y} L ${parent.x} ${parent.y}`
        : `M ${row.x} ${row.y} L ${row.x} ${bendY - 8} Q ${row.x} ${bendY} ${row.x + Math.sign(parent.x - row.x) * 8} ${bendY} L ${parent.x} ${bendY} L ${parent.x} ${parent.y}`;
    edges.push({
      from: row.snapshot.id,
      to: parent.snapshot.id,
      lane: row.lane,
      path,
    });
  }

  return {
    rows,
    edges,
    width: Math.max(42, (nextLane + 1) * 20 + 20),
    height: rows.length * VERSION_GRAPH_ROW_HEIGHT,
  };
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

function formatRelativeDate(value: string): string {
  const timestamp = new Date(value).getTime();
  const today = new Date();
  const sameDay =
    new Date(value).toDateString() === today.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function formatBytes(value: number): string {
  if (value < 1_024) {
    return `${value} B`;
  }
  if (value < 1_048_576) {
    return `${(value / 1_024).toFixed(1)} KB`;
  }
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function workspaceChangeKindLabel(
  kind: NativeWorkspaceChangeKind,
): string {
  switch (kind) {
    case "created":
      return "新建";
    case "modified":
      return "修改";
    case "deleted":
      return "删除";
    case "moved":
      return "移动";
  }
}

function isContextScope(
  value: string | undefined,
): value is ContextMenuState["scope"] {
  switch (value) {
    case "activity":
    case "editor":
    case "embedded-lab":
    case "explorer":
    case "input":
    case "note-item":
    case "preview":
    case "status":
    case "tab":
    case "titlebar":
    case "version-node":
    case "workspace":
      return true;
    default:
      return false;
  }
}

function contextMenuLabel(
  scope: ContextMenuState["scope"],
  note: LearningNote | undefined,
  snapshot: NoteSnapshot | undefined,
): string {
  switch (scope) {
    case "editor":
      return note === undefined ? "编辑器" : `编辑：${note.title}`;
    case "preview":
      return note === undefined ? "阅读视图" : `阅读：${note.title}`;
    case "embedded-lab":
      return note === undefined ? "交互实验" : `实验：${note.title}`;
    case "note-item":
      return note === undefined ? "知识节点" : note.title;
    case "tab":
      return note === undefined ? "标签" : `标签：${note.title}`;
    case "version-node":
      return snapshot === undefined
        ? "版本节点"
        : `版本：${formatDate(snapshot.createdAt)}`;
    case "input":
      return "文本输入";
    case "explorer":
      return "笔记栏";
    case "activity":
      return "学习工作区";
    case "status":
      return "当前文档状态";
    case "titlebar":
      return "知织窗口";
    case "workspace":
      return "工作区";
  }
}

async function runWindowAction(
  action: "close" | "maximize" | "minimize",
): Promise<void> {
  try {
    const currentWindow = getCurrentWindow();
    if (action === "close") {
      await currentWindow.close();
    } else if (action === "maximize") {
      await currentWindow.toggleMaximize();
    } else {
      await currentWindow.minimize();
    }
  } catch {
    // Browser preview has no native Tauri window. The controls remain inert.
  }
}
