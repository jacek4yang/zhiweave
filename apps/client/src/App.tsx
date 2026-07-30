import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Archive,
  BookOpenText,
  Bookmark,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Columns2,
  Command as CommandIcon,
  Copy,
  Database,
  Eye,
  FilePlus2,
  FlaskConical,
  GitFork,
  GitBranch,
  GraduationCap,
  Library,
  Link2,
  ListTree,
  Maximize2,
  Menu,
  Minus,
  Network,
  NotebookPen,
  Paperclip,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { CommandPalette } from "./CommandPalette";
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
  commandById,
  commandForShortcut,
  commandsForContext,
  resolveCommandById,
  type CommandCapability,
  type CommandContext,
  type CommandId,
  type CommandScope,
  type ResolvedCommand,
} from "./commandRegistry";
import {
  MarkdownEditor,
  type EditorStatus,
  type MarkdownEditorHandle,
} from "./MarkdownEditor";
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
  utf16OffsetFromUtf8ByteOffset,
} from "./nativeWorkspaceModel";
import {
  isNativeRuntime,
  loadSystemStatus,
  type SystemStatus,
} from "./system";
import {
  applyNativeVersionRetention,
  asWorkspaceFailure,
  cancelNativeAttachmentImport,
  checkoutNativeVersion,
  confirmNativeAttachmentImport,
  createNativeNote,
  createNativeWikiTarget,
  createNativeWorkspaceBackup,
  deleteNativeVersion,
  detectNativeWorkspaceChanges,
  loadNativeWorkspace,
  loadNativeBacklinks,
  loadNativeLocalGraph,
  loadNativeVersionHistory,
  listNativeWorkspaceBackups,
  pickNativeAttachmentImport,
  prepareNativeWorkspaceRestore,
  previewNativeVersionRetention,
  readNativeVersion,
  rebuildNativeIndex,
  renameNativeNote,
  resolveNativeAttachment,
  resolveNativeWikiTarget,
  saveNativeNote,
  saveNativeVersion,
  searchNativeNotes,
  setNativeVersionCheckpoint,
  type NativeIndexStatus,
  type NativeBacklinkReference,
  type NativeLocalGraph,
  type NativeLocalGraphNode,
  type NativeAttachmentPreview,
  type NativeAttachmentImportProposal,
  type NativeNoteDocument,
  type NativeVersionHistory,
  type NativeVersionRetentionPolicy,
  type NativeVersionRetentionPreview,
  type NativeWorkspaceBackupSummary,
  type NativeWorkspaceChangeKind,
  type NativeWorkspaceChangesResult,
  type NativeWikiTargetCreationProposal,
  verifyNativeWorkspaceBackup,
} from "./workspaceClient";

const MarkdownPreview = lazy(async () => {
  const module = await import("./MarkdownPreview");
  return { default: module.MarkdownPreview };
});
const DocumentOutline = lazy(async () => {
  const module = await import("./DocumentOutline");
  return { default: module.DocumentOutline };
});
const BacklinksPanel = lazy(async () => {
  const module = await import("./BacklinksPanel");
  return { default: module.BacklinksPanel };
});
const LocalGraphPanel = lazy(async () => {
  const module = await import("./LocalGraphPanel");
  return { default: module.LocalGraphPanel };
});
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type EditorMode = "edit" | "preview" | "split";
const WORKBENCH_PREFERENCES_KEY = "zhiweave.workbench.preferences.v1";
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
  readonly scope: CommandScope;
  readonly hasSelection: boolean;
  readonly noteId?: string;
  readonly rawAttachmentTarget?: string;
  readonly rawWikiTarget?: string;
  readonly snapshotId?: string;
}

interface CommandTarget {
  readonly backupId?: string;
  readonly hasSelection?: boolean;
  readonly noteId?: string;
  readonly rawAttachmentTarget?: string;
  readonly rawWikiTarget?: string;
  readonly scope?: CommandScope;
  readonly snapshotId?: string;
}

interface PendingWikiCreation {
  readonly proposal: NativeWikiTargetCreationProposal;
  readonly rawTarget: string;
  readonly sourceNoteId: string;
}

const EMPTY_EDITOR_STATUS: EditorStatus = {
  line: 1,
  column: 1,
  lines: 1,
  characters: 0,
  words: 0,
  selectionCount: 1,
  selectionLength: 0,
  undoDepth: 0,
  redoDepth: 0,
};

const DEFAULT_RETENTION_POLICY: NativeVersionRetentionPolicy = {
  keepLatest: 20,
  keepDays: 30,
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
  const [livePreviewEnabled, setLivePreviewEnabled] = useState(
    () => readWorkbenchPreferences().livePreviewEnabled,
  );
  const [outlineOpen, setOutlineOpen] = useState(
    () => readWorkbenchPreferences().outlineOpen,
  );
  const [backlinksOpen, setBacklinksOpen] = useState(
    () => nativeRuntime && readWorkbenchPreferences().backlinksOpen,
  );
  const [localGraphOpen, setLocalGraphOpen] = useState(
    () => nativeRuntime && readWorkbenchPreferences().localGraphOpen,
  );
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
  const [nativeBacklinks, setNativeBacklinks] = useState<
    readonly NativeBacklinkReference[]
  >([]);
  const [nativeBacklinksState, setNativeBacklinksState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [nativeLocalGraph, setNativeLocalGraph] =
    useState<NativeLocalGraph | null>(null);
  const [nativeLocalGraphState, setNativeLocalGraphState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [nativeRelationEpoch, setNativeRelationEpoch] = useState(0);
  const [nativeVersionHistory, setNativeVersionHistory] =
    useState<NativeVersionHistory | null>(null);
  const [retentionPolicy, setRetentionPolicy] =
    useState<NativeVersionRetentionPolicy>(DEFAULT_RETENTION_POLICY);
  const [retentionPreview, setRetentionPreview] =
    useState<NativeVersionRetentionPreview | null>(null);
  const [retentionState, setRetentionState] = useState<
    "idle" | "previewing" | "applying"
  >("idle");
  const [workspaceBackups, setWorkspaceBackups] = useState<
    readonly NativeWorkspaceBackupSummary[]
  >([]);
  const [backupState, setBackupState] = useState<
    "idle" | "loading" | "creating" | "verifying" | "restoring"
  >(nativeRuntime ? "loading" : "idle");
  const [verifiedBackupId, setVerifiedBackupId] = useState<string | null>(
    null,
  );
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
  const [pendingWikiNavigation, setPendingWikiNavigation] = useState<{
    readonly heading: string;
    readonly noteId: string;
  } | null>(null);
  const [pendingWikiCreation, setPendingWikiCreation] =
    useState<PendingWikiCreation | null>(null);
  const [isCreatingWikiTarget, setIsCreatingWikiTarget] = useState(false);
  const [pendingAttachmentImport, setPendingAttachmentImport] =
    useState<NativeAttachmentImportProposal | null>(null);
  const [attachmentImportState, setAttachmentImportState] = useState<
    "idle" | "selecting" | "reviewing" | "confirming"
  >("idle");
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [externalChanges, setExternalChanges] =
    useState<NativeWorkspaceChangesResult | null>(null);
  const [isExternalChangesOpen, setIsExternalChangesOpen] = useState(false);
  const [isResolvingExternalChanges, setIsResolvingExternalChanges] =
    useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const contextMenuRef = useRef<HTMLElement>(null);
  const contextTargetRef = useRef<HTMLElement | SVGElement | null>(null);
  const newNoteDialogRef = useRef<HTMLElement>(null);
  const wikiCreationDialogRef = useRef<HTMLElement>(null);
  const attachmentImportDialogRef = useRef<HTMLElement>(null);
  const externalDialogRef = useRef<HTMLElement>(null);
  const modalPreviousFocusRef = useRef<HTMLElement | null>(null);
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
    setRetentionPreview(null);
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
      return;
    }
    let active = true;
    setBackupState("loading");
    void listNativeWorkspaceBackups()
      .then((backups) => {
        if (active) {
          setWorkspaceBackups(backups);
          setBackupState("idle");
        }
      })
      .catch(() => {
        if (active) {
          setBackupState("idle");
          setToast("无法读取本地备份清单；Markdown 正文未受影响。");
        }
      });
    return () => {
      active = false;
    };
  }, [nativeRuntime]);

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
    if (!backlinksOpen) {
      setNativeBacklinks([]);
      setNativeBacklinksState("idle");
      return undefined;
    }
    if (
      !nativeRuntime ||
      selectedNote === undefined ||
      nativeIndex?.state !== "ready"
    ) {
      setNativeBacklinks([]);
      setNativeBacklinksState(
        nativeIndex === null ? "idle" : "error",
      );
      return undefined;
    }

    let active = true;
    setNativeBacklinks([]);
    setNativeBacklinksState("loading");
    void loadNativeBacklinks(selectedNote.id)
      .then((references) => {
        if (active) {
          setNativeBacklinks(references);
          setNativeBacklinksState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setNativeBacklinks([]);
          setNativeBacklinksState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [
    backlinksOpen,
    nativeIndex?.state,
    nativeRelationEpoch,
    nativeRuntime,
    selectedNote?.id,
  ]);

  useEffect(() => {
    if (!localGraphOpen) {
      setNativeLocalGraph(null);
      setNativeLocalGraphState("idle");
      return undefined;
    }
    if (
      !nativeRuntime ||
      selectedNote === undefined ||
      nativeIndex?.state !== "ready"
    ) {
      setNativeLocalGraph(null);
      setNativeLocalGraphState(nativeIndex === null ? "idle" : "error");
      return undefined;
    }

    let active = true;
    setNativeLocalGraph(null);
    setNativeLocalGraphState("loading");
    void loadNativeLocalGraph(selectedNote.id, 40)
      .then((graph) => {
        if (active) {
          setNativeLocalGraph(graph);
          setNativeLocalGraphState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setNativeLocalGraph(null);
          setNativeLocalGraphState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [
    localGraphOpen,
    nativeIndex?.state,
    nativeRelationEpoch,
    nativeRuntime,
    selectedNote?.id,
  ]);

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
    if (
      pendingWikiNavigation === null ||
      selectedNote?.id !== pendingWikiNavigation.noteId
    ) {
      return undefined;
    }
    let active = true;
    let timer: number | undefined;
    void import("./wikiNavigation").then(({ wikiHeadingOffset }) => {
      if (!active) {
        return;
      }
      const offset = wikiHeadingOffset(
        selectedNote.markdown,
        pendingWikiNavigation.heading,
      );
      setPendingWikiNavigation(null);
      if (offset === null) {
        setToast(
          `已打开“${selectedNote.title}”，但没有找到小节“${pendingWikiNavigation.heading}”。`,
        );
        return;
      }
      timer = window.setTimeout(() => {
        if (editorMode === "preview") {
          document.getElementById(`heading-${offset}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
          editorRef.current?.revealOffset(offset);
        }
      }, 0);
    });
    return () => {
      active = false;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [editorMode, pendingWikiNavigation, selectedNote]);

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
    try {
      localStorage.setItem(
        WORKBENCH_PREFERENCES_KEY,
        JSON.stringify({
          backlinksOpen,
          livePreviewEnabled,
          localGraphOpen,
          outlineOpen,
        }),
      );
    } catch {
      // UI preferences are optional; Markdown persistence is independent.
    }
  }, [backlinksOpen, livePreviewEnabled, localGraphOpen, outlineOpen]);

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
          if (indexUpdated) {
            setNativeRelationEpoch((epoch) => epoch + 1);
          } else {
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
    if (
      !isNewNoteOpen &&
      !isExternalChangesOpen &&
      pendingWikiCreation === null &&
      pendingAttachmentImport === null
    ) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isNewNoteOpen) {
          runCommand("dialog.closeNewNote");
        } else if (pendingWikiCreation !== null) {
          if (!isCreatingWikiTarget) {
            setPendingWikiCreation(null);
          }
        } else if (pendingAttachmentImport !== null) {
          if (attachmentImportState !== "confirming") {
            runCommand("dialog.closeAttachmentImport");
          }
        } else {
          runCommand("dialog.closeExternalChanges");
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [
    isCreatingWikiTarget,
    isExternalChangesOpen,
    isNewNoteOpen,
    attachmentImportState,
    pendingAttachmentImport,
    pendingWikiCreation,
  ]);

  useEffect(() => {
    if (
      !isNewNoteOpen &&
      !isExternalChangesOpen &&
      pendingWikiCreation === null &&
      pendingAttachmentImport === null
    ) {
      const previous = modalPreviousFocusRef.current;
      modalPreviousFocusRef.current = null;
      if (previous?.isConnected === true) {
        previous.focus();
      }
      return undefined;
    }
    modalPreviousFocusRef.current ??=
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = isNewNoteOpen
        ? newNoteDialogRef.current
        : pendingWikiCreation !== null
          ? wikiCreationDialogRef.current
          : pendingAttachmentImport !== null
            ? attachmentImportDialogRef.current
            : externalDialogRef.current;
      const initialFocus = isNewNoteOpen
        ? dialog?.querySelector<HTMLElement>("input")
        : pendingAttachmentImport !== null
          ? dialog?.querySelector<HTMLElement>(
              "footer button.primary:not(:disabled)",
            )
          : dialog?.querySelector<HTMLElement>("button:not(:disabled)");
      initialFocus?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    isExternalChangesOpen,
    isNewNoteOpen,
    pendingAttachmentImport,
    pendingWikiCreation,
  ]);

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

  function openBacklink(reference: NativeBacklinkReference) {
    const source = workspace.notes.find(
      (note) => note.id === reference.sourceNoteId,
    );
    if (source === undefined) {
      setToast(
        "引用来源已在磁盘上变化；请先处理外部更改，再重新打开反向链接。",
      );
      return;
    }
    activateNote(source);
    setEditorMode("edit");
    window.setTimeout(() => {
      editorRef.current?.revealOffset(
        utf16OffsetFromUtf8ByteOffset(
          source.markdown,
          reference.sourceByteStart,
        ),
      );
    }, 0);
  }

  function openGraphNode(node: NativeLocalGraphNode) {
    const note = workspace.notes.find((candidate) => candidate.id === node.id);
    if (note === undefined) {
      setToast(
        "图谱节点已在磁盘上变化；请先处理外部更改，再重新打开局部图谱。",
      );
      return;
    }
    activateNote(note);
  }

  async function openWikiTarget(
    rawTarget: string,
    sourceNoteId = activeNoteIdRef.current,
  ) {
    if (!nativeRuntime || sourceNoteId === null) {
      setToast("当前预览没有本地知识索引，未执行 Wiki 跳转。");
      return;
    }
    try {
      const resolution = await resolveNativeWikiTarget(
        sourceNoteId,
        rawTarget,
      );
      if (resolution.state === "missing") {
        if (resolution.creation === null) {
          setToast(
            `未找到 Wiki 目标“${resolution.rawTarget}”，而且这个目标不能安全创建。`,
          );
          return;
        }
        modalPreviousFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setPendingWikiCreation({
          proposal: resolution.creation,
          rawTarget: resolution.rawTarget,
          sourceNoteId,
        });
        return;
      }
      if (resolution.state === "ambiguous") {
        setToast(
          `Wiki 目标“${resolution.rawTarget}”匹配多个节点；请改用完整 Markdown 路径。`,
        );
        return;
      }
      const resolved = resolution.target;
      const target =
        resolved === null
          ? undefined
          : workspaceRef.current.notes.find(
              (note) => note.id === resolved.id,
            );
      if (target === undefined) {
        setToast("Wiki 索引与当前文件快照不一致；请先处理外部更改。");
        return;
      }
      if (resolution.heading !== null) {
        setPendingWikiNavigation({
          heading: resolution.heading,
          noteId: target.id,
        });
      } else {
        setPendingWikiNavigation(null);
      }
      activateNote(target);
      setToast(
        resolution.heading === null
          ? `已打开知识节点“${target.title}”。`
          : `已打开“${target.title}”，正在定位小节“${resolution.heading}”。`,
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setToast(
        failure?.code === "invalidWikiTarget"
          ? "这个 Wiki 目标格式无效，未执行跳转。"
          : "Wiki 目标解析失败；没有打开未经确认的节点。",
      );
    }
  }

  const resolvePreviewAttachment = useCallback(
    (
      sourceNoteId: string,
      rawTarget: string,
      referenceKind: "markdownImage" | "wikiEmbed",
    ): Promise<NativeAttachmentPreview> => {
      if (!nativeRuntime) {
        return Promise.reject(new Error("native attachment resolver unavailable"));
      }
      return resolveNativeAttachment(
        sourceNoteId,
        rawTarget,
        referenceKind,
      );
    },
    [nativeRuntime],
  );

  async function confirmWikiTargetCreation() {
    if (pendingWikiCreation === null || isCreatingWikiTarget) {
      return;
    }
    const pending = pendingWikiCreation;
    setIsCreatingWikiTarget(true);
    try {
      const document = await createNativeWikiTarget(
        pending.sourceNoteId,
        pending.rawTarget,
        pending.proposal.path,
      );
      if (pending.proposal.heading !== null) {
        setPendingWikiNavigation({
          heading: pending.proposal.heading,
          noteId: document.id,
        });
      }
      addCreatedNativeDocument(document);
      setPendingWikiCreation(null);
      setToast(`已创建并打开知识节点“${document.title}”。`);
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setPendingWikiCreation(null);
      if (
        failure?.code === "invalidWikiTarget" &&
        failure.kind === "targetNoLongerMissing"
      ) {
        setToast("目标状态刚刚发生变化，正在重新解析。");
        void openWikiTarget(pending.rawTarget, pending.sourceNoteId);
      } else if (
        failure?.code === "alreadyExists" ||
        failure?.kind === "staleCreationProposal"
      ) {
        setToast("建议路径已发生变化；没有覆盖任何文件，请重新打开链接。");
      } else {
        setToast("知识节点创建失败；没有覆盖或修改现有 Markdown。");
      }
    } finally {
      setIsCreatingWikiTarget(false);
    }
  }

  async function beginAttachmentImport(note: LearningNote) {
    if (
      !nativeRuntime ||
      attachmentImportState !== "idle" ||
      pendingAttachmentImport !== null
    ) {
      return;
    }
    modalPreviousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    let openedReview = false;
    setAttachmentImportState("selecting");
    try {
      const proposal = await pickNativeAttachmentImport(note.id);
      if (proposal === null) {
        setToast("已取消选择，没有导入或修改任何文件。");
        return;
      }
      if (activeNoteIdRef.current !== note.id) {
        await cancelNativeAttachmentImport(proposal.token).catch(() => false);
        setToast("当前知识节点已经切换，附件未导入；请在目标节点中重新选择。");
        return;
      }
      setPendingAttachmentImport(proposal);
      setAttachmentImportState("reviewing");
      openedReview = true;
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      if (
        failure?.code === "limitExceeded" &&
        failure.limit?.startsWith("pending attachment import")
      ) {
        setToast("待确认附件已达到安全上限；请先完成或取消已有导入。");
      } else if (failure?.code === "limitExceeded") {
        setToast("附件超过 64 MB，未读取、未复制，也未修改笔记。");
      } else if (
        failure?.code === "invalidAttachmentImport" &&
        failure.kind === "selectedSymbolicLink"
      ) {
        setToast("不能导入符号链接；请选择真实的本机文件。");
      } else if (failure?.code === "io" && failure.kind === "permissionDenied") {
        setToast("Windows 拒绝读取所选文件；没有导入或修改任何内容。");
      } else {
        setToast("附件读取失败；没有导入文件，也没有修改当前笔记。");
      }
    } finally {
      if (!openedReview) {
        setAttachmentImportState("idle");
        const previous = modalPreviousFocusRef.current;
        modalPreviousFocusRef.current = null;
        if (previous?.isConnected === true) {
          previous.focus();
        }
      }
    }
  }

  async function cancelAttachmentImport() {
    if (
      pendingAttachmentImport === null ||
      attachmentImportState === "confirming"
    ) {
      return;
    }
    const token = pendingAttachmentImport.token;
    setPendingAttachmentImport(null);
    setAttachmentImportState("idle");
    await cancelNativeAttachmentImport(token).catch(() => false);
    setToast("已取消导入，没有复制文件，也没有修改笔记。");
  }

  async function confirmAttachmentImport() {
    if (
      pendingAttachmentImport === null ||
      attachmentImportState !== "reviewing"
    ) {
      return;
    }
    const proposal = pendingAttachmentImport;
    if (activeNoteIdRef.current !== proposal.sourceNoteId) {
      await cancelNativeAttachmentImport(proposal.token).catch(() => false);
      setPendingAttachmentImport(null);
      setAttachmentImportState("idle");
      setToast("当前知识节点已经切换，附件未导入；请重新选择。");
      return;
    }
    setAttachmentImportState("confirming");
    try {
      const result = await confirmNativeAttachmentImport(proposal.token);
      const inserted = editorRef.current?.insertMarkdownReference(
        result.markdownReference,
      );
      setPendingAttachmentImport(null);
      setAttachmentImportState("idle");
      setNativeRelationEpoch((value) => value + 1);
      if (inserted === true) {
        setToast(
          `已保留原始字节并导入到 ${result.path}；引用已插入，可用 Ctrl+Z 撤销。`,
        );
      } else {
        setToast(
          `附件已安全保存到 ${result.path}，但编辑器光标已不可用；引用为 ${result.markdownReference}`,
        );
      }
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setPendingAttachmentImport(null);
      setAttachmentImportState("idle");
      if (
        failure?.code === "invalidAttachmentImport" &&
        failure.kind === "staleDestination"
      ) {
        setToast("目标位置刚刚发生变化；没有覆盖文件，请重新选择以生成新位置。");
      } else if (
        failure?.code === "invalidAttachmentImport" &&
        failure.kind === "staleSourceLocation"
      ) {
        setToast("知识节点位置刚刚发生变化；没有写入附件，请在当前节点重新选择。");
      } else if (
        failure?.code === "invalidAttachmentImport" &&
        failure.kind === "unknownOrExpiredPendingToken"
      ) {
        setToast("导入确认已经过期；没有写入文件，请重新选择。");
      } else if (failure?.code === "alreadyExists") {
        setToast("目标文件已经存在；没有覆盖它，请重新选择以生成新名称。");
      } else {
        setToast("附件导入失败；没有覆盖文件，也没有修改当前笔记。");
      }
    }
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

  async function createNote() {
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
    setNativeRelationEpoch((epoch) => epoch + 1);
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
      setNativeRelationEpoch((epoch) => epoch + 1);
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
      setNativeRelationEpoch((epoch) => epoch + 1);
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
      setNativeRelationEpoch((epoch) => epoch + 1);
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
      setNativeRelationEpoch((epoch) => epoch + 1);
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

  async function copyNoteContent(
    note: LearningNote,
    format: "markdown" | "plainText",
  ) {
    try {
      const text =
        format === "markdown"
          ? note.markdown
          : await import("./markdownAst").then((markdownAst) =>
              markdownAst.plainTextFromMarkdown(
                markdownAst.parseMarkdownDocument(note.markdown),
              ),
            );
      await copyText(text);
      setToast(
        format === "markdown"
          ? `已复制“${note.title}”的 Markdown 原文。`
          : `已复制“${note.title}”的结构化阅读文本。`,
      );
    } catch {
      setToast("复制失败，请检查 Markdown 内容与系统剪贴板权限。");
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
      setNativeRelationEpoch((epoch) => epoch + 1);
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
      `${snapshot.checkpointName === undefined ? "" : `这是检查点“${snapshot.checkpointName}”。`}\n删除“${snapshot.noteTitle}”在 ${formatDate(snapshot.createdAt)} 的版本节点？后续分支会自动重接，笔记正文不会被删除。`,
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

  async function toggleVersionCheckpoint(snapshot: NoteSnapshot) {
    if (!nativeRuntime) {
      setToast("浏览器预览不写入正式检查点；请在 Windows 桌面端使用。");
      return;
    }
    const checkpointName =
      snapshot.checkpointName === undefined
        ? window.prompt(
            "为这个版本命名。命名检查点不会被自动清理（最多 80 个字符）。",
            snapshot.message ?? "重要里程碑",
          )
        : null;
    if (snapshot.checkpointName === undefined && checkpointName === null) {
      return;
    }
    const normalizedName = checkpointName?.trim() ?? null;
    if (
      normalizedName !== null &&
      (normalizedName.length === 0 ||
        [...normalizedName].length > 80 ||
        /[\u0000-\u001f\u007f]/u.test(normalizedName))
    ) {
      setToast("检查点名称需为 1–80 个可见字符。");
      return;
    }
    try {
      const currentHistory =
        nativeVersionHistory?.noteId === snapshot.noteId
          ? nativeVersionHistory
          : await loadNativeVersionHistory(snapshot.noteId);
      const history = await setNativeVersionCheckpoint(
        snapshot.noteId,
        snapshot.id,
        currentHistory.head,
        normalizedName,
      );
      if (activeNoteIdRef.current === snapshot.noteId) {
        applyNativeHistory(history);
      }
      setToast(
        normalizedName === null
          ? "已取消检查点保护；这个版本以后可以进入清理预览。"
          : `已设为检查点“${normalizedName}”；自动清理会始终保护它。`,
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      if (failure?.code === "versionConflict") {
        void loadNativeVersionHistory(snapshot.noteId).then(
          applyNativeHistory,
        );
        setToast("分支头已变化；版本图已刷新，没有修改检查点。");
      } else {
        setToast(
          failure?.kind === "checkpointNameAlreadyExists"
            ? "这个知识节点已有同名检查点，请换一个名称。"
            : failure?.code === "historyCorrupt"
              ? "版本库完整性检查失败，没有修改检查点。"
              : "检查点未修改；现有历史保持不变。",
        );
      }
    }
  }

  function updateRetentionPolicy(policy: NativeVersionRetentionPolicy) {
    setRetentionPolicy(policy);
    setRetentionPreview(null);
  }

  async function previewVersionRetention() {
    if (!nativeRuntime || selectedNote === undefined) {
      setToast("清理预览只会在 Windows 桌面端读取正式版本库。");
      return;
    }
    setRetentionState("previewing");
    try {
      const currentHistory =
        nativeVersionHistory?.noteId === selectedNote.id
          ? nativeVersionHistory
          : await loadNativeVersionHistory(selectedNote.id);
      const preview = await previewNativeVersionRetention(
        selectedNote.id,
        currentHistory.head,
        retentionPolicy,
      );
      if (activeNoteIdRef.current === selectedNote.id) {
        setRetentionPreview(preview);
      }
      setToast(
        preview.candidates.length === 0
          ? "当前策略没有可安全清理的版本。"
          : `预览完成：可清理 ${preview.candidates.length} 个旧版本，预计释放 ${formatBytes(preview.releasedBytes)}。`,
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setRetentionPreview(null);
      if (failure?.code === "versionConflict") {
        void loadNativeVersionHistory(selectedNote.id).then(
          applyNativeHistory,
        );
        setToast("分支头已变化；版本图已刷新，请重新生成清理预览。");
      } else {
        setToast(
          failure?.code === "historyCorrupt"
            ? "发现不可安全读取的历史内容；没有生成清理计划，也没有删除任何数据。"
            : "无法生成清理预览；现有历史保持不变。",
        );
      }
    } finally {
      setRetentionState("idle");
    }
  }

  async function applyVersionRetention() {
    if (retentionPreview === null || retentionPreview.candidates.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `按刚才的预览清理 ${retentionPreview.candidates.length} 个旧版本？\n将保留 ${retentionPreview.remainingVersionCount} 个版本；检查点、分支末端、最早基线和当前分支头不会删除。`,
    );
    if (!confirmed) {
      return;
    }
    setRetentionState("applying");
    try {
      const result = await applyNativeVersionRetention(retentionPreview);
      applyNativeHistory(result.history);
      setToast(
        result.releasedBytes > 0
          ? `已清理 ${result.deletedVersions} 个旧版本并释放 ${formatBytes(result.releasedBytes)}；所有保留节点仍可独立恢复。`
          : `已清理 ${result.deletedVersions} 个旧版本；共享内容块仍被保留节点引用。`,
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      if (
        failure?.code === "versionConflict" ||
        failure?.kind === "staleRetentionPreview"
      ) {
        if (selectedNote !== undefined) {
          void loadNativeVersionHistory(selectedNote.id).then(
            applyNativeHistory,
          );
        }
        setToast("版本历史或检查点已变化；旧预览作废，没有删除任何数据。");
      } else {
        setToast(
          failure?.code === "historyCorrupt"
            ? "版本库完整性检查失败；清理事务已中止，没有删除任何数据。"
            : "旧版本清理未完成；现有历史保持不变。",
        );
      }
    } finally {
      setRetentionState("idle");
    }
  }

  function workspaceIsCleanForBackup(): boolean {
    return (
      savingNoteIdsRef.current.size === 0 &&
      workspace.notes.every(
        (note) =>
          lastPersistedMarkdownRef.current.get(note.id) === note.markdown,
      ) &&
      externalChanges === null &&
      !isResolvingExternalChanges
    );
  }

  async function createWorkspaceBackup() {
    if (!nativeRuntime) {
      setToast("正式工作区备份只在 Windows 桌面端创建。");
      return;
    }
    if (!workspaceIsCleanForBackup()) {
      setToast("请先保存或处理外部更改，再创建完整工作区备份。");
      return;
    }
    const proposed = `手动备份 ${new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date())}`;
    const label = window.prompt(
      "为完整工作区备份添加一个容易识别的名称（最多 80 个字符）。",
      proposed,
    );
    if (label === null) {
      return;
    }
    const normalized = label.trim();
    if (
      normalized.length === 0 ||
      [...normalized].length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
      setToast("备份名称需为 1–80 个可见字符。");
      return;
    }
    setBackupState("creating");
    try {
      const result = await createNativeWorkspaceBackup(normalized);
      setWorkspaceBackups((current) => [
        result.backup,
        ...current.filter((item) => item.id !== result.backup.id),
      ]);
      setVerifiedBackupId(result.backup.id);
      setToast(
        `完整备份已校验并保存到 ${result.backup.pathDisplay}（${formatBytes(result.backup.totalBytes)}）。`,
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setToast(
        failure?.code === "backupCorrupt"
          ? "备份校验失败，未发布不完整备份包。"
          : failure?.kind === "sourceChanged"
            ? "备份期间有文件被外部修改；未发布不一致备份，请重试。"
            : "完整备份未完成；现有 Markdown 与历史均保持不变。",
      );
    } finally {
      setBackupState("idle");
    }
  }

  async function verifyWorkspaceBackup(backup: NativeWorkspaceBackupSummary) {
    setBackupState("verifying");
    try {
      const verified = await verifyNativeWorkspaceBackup(backup.id);
      setVerifiedBackupId(backup.id);
      setToast(
        `备份校验通过：重新读取 ${verified.verifiedFiles} 个文件、${formatBytes(verified.verifiedBytes)}，包括 ${verified.backup.historyVersionCount} 个版本节点。`,
      );
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setVerifiedBackupId(null);
      setToast(
        failure?.code === "backupCorrupt"
          ? "备份内容或校验清单已损坏，不能用于恢复。"
          : "备份校验未完成；没有更改工作区。",
      );
    } finally {
      setBackupState("idle");
    }
  }

  async function restoreWorkspaceBackup(backup: NativeWorkspaceBackupSummary) {
    if (!workspaceIsCleanForBackup()) {
      setToast("请先保存或处理外部更改，再准备完整工作区恢复。");
      return;
    }
    const confirmed = window.confirm(
      `恢复到“${backup.label ?? formatDate(new Date(backup.createdAtMillis).toISOString())}”？\n\n知织会先完整校验该备份，再为当前工作区创建一份安全备份。真正替换会在下次启动、文件监控和数据库打开之前完成；当前目录仍会保留为可回退副本。`,
    );
    if (!confirmed) {
      return;
    }
    setBackupState("restoring");
    try {
      const prepared = await prepareNativeWorkspaceRestore(backup.id);
      window.alert(
        `恢复已安全准备完成。\n\n当前工作区已另存为“${prepared.safetyBackup.label ?? "恢复前自动保护"}”。知织现在会关闭；请重新打开，恢复将在启动前完成。`,
      );
      await getCurrentWindow().close();
    } catch (error: unknown) {
      const failure = asWorkspaceFailure(error);
      setToast(
        failure?.code === "backupCorrupt"
          ? "备份校验失败，未准备恢复，也没有替换当前工作区。"
          : failure?.kind === "restoreAlreadyPending"
            ? "已有一项恢复等待重启，请先重新打开知织。"
            : "恢复准备未完成；当前工作区保持原样。",
      );
      setBackupState("idle");
    }
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

  function commandContextFor(target: CommandTarget = {}): CommandContext {
    const note =
      target.noteId === undefined
        ? selectedNote
        : workspace.notes.find((candidate) => candidate.id === target.noteId);
    const snapshot =
      target.snapshotId === undefined
        ? undefined
        : workspace.snapshots.find(
            (candidate) => candidate.id === target.snapshotId,
          );
    const backup =
      target.backupId === undefined
        ? undefined
        : workspaceBackups.find(
            (candidate) => candidate.id === target.backupId,
          );
    const capabilities = new Set<CommandCapability>([
      nativeRuntime ? "native" : "browser",
    ]);
    if (note !== undefined) {
      capabilities.add("note");
    }
    if (
      target.rawWikiTarget !== undefined &&
      target.rawWikiTarget.trim().length > 0
    ) {
      capabilities.add("wikiTarget");
    }
    if (
      target.rawAttachmentTarget !== undefined &&
      target.rawAttachmentTarget.trim().length > 0
    ) {
      capabilities.add("attachmentTarget");
    }
    if (snapshot !== undefined) {
      capabilities.add("snapshot");
    }
    if (backup !== undefined) {
      capabilities.add("backup");
    }
    if (target.hasSelection === true) {
      capabilities.add("selection");
    }
    if (
      contextTargetRef.current instanceof HTMLInputElement ||
      contextTargetRef.current instanceof HTMLTextAreaElement
    ) {
      capabilities.add("inputTarget");
    }
    if (editorStatus.undoDepth > 0) {
      capabilities.add("undo");
    }
    if (editorStatus.redoDepth > 0) {
      capabilities.add("redo");
    }
    if (["conflict", "error", "mixed"].includes(saveState)) {
      capabilities.add("saveRecovery");
    }
    if (nativeRoot.length > 0) {
      capabilities.add("root");
    }
    if (externalChanges !== null) {
      capabilities.add("externalChanges");
    }
    if (openNoteIds.length > 1) {
      capabilities.add("multiTabs");
    }
    if (closedNoteIds.length > 0) {
      capabilities.add("closedTabs");
    }
    if (query.length > 0) {
      capabilities.add("query");
    }
    if (isNewNoteOpen) {
      capabilities.add("newNoteDialog");
      if (newTitle.trim().length > 0) {
        capabilities.add("newNoteReady");
      }
    }
    if (isExternalChangesOpen) {
      capabilities.add("externalDialog");
      if (!isResolvingExternalChanges) {
        capabilities.add("externalApplySafe");
        capabilities.add("externalRecovery");
      }
    }
    if (
      nativeRuntime &&
      note !== undefined &&
      note.id === selectedNote?.id &&
      activeView !== "versions" &&
      editorMode !== "preview" &&
      !isNewNoteOpen &&
      !isExternalChangesOpen &&
      pendingWikiCreation === null &&
      pendingAttachmentImport === null &&
      attachmentImportState === "idle"
    ) {
      capabilities.add("attachmentImport");
    }
    if (pendingAttachmentImport !== null) {
      capabilities.add("attachmentImportDialog");
      if (attachmentImportState === "reviewing") {
        capabilities.add("attachmentImportReady");
      }
    }
    if (
      activeView === "versions" ||
      activeNoteId !== null ||
      target.noteId !== undefined
    ) {
      capabilities.add("tab");
    }
    if (backupState === "idle") {
      capabilities.add("backupIdle");
    }
    if (retentionPreview !== null) {
      capabilities.add("retentionPreview");
    }
    if (
      nativeRuntime &&
      note?.path !== undefined &&
      note.revision !== undefined &&
      lastPersistedMarkdownRef.current.get(note.id) === note.markdown
    ) {
      capabilities.add("noteRename");
    }
    return {
      capabilities,
      ...(target.scope === undefined ? {} : { scope: target.scope }),
    };
  }

  function runCommand(id: CommandId, target: CommandTarget = {}) {
    const resolved = resolveCommandById(id, commandContextFor(target));
    if (resolved === undefined || !resolved.enabled) {
      setToast("当前上下文不能安全执行这个命令。");
      return;
    }
    const note =
      target.noteId === undefined
        ? selectedNote
        : workspace.notes.find((candidate) => candidate.id === target.noteId);
    const snapshot =
      target.snapshotId === undefined
        ? undefined
        : workspace.snapshots.find(
            (candidate) => candidate.id === target.snapshotId,
          );
    const backup =
      target.backupId === undefined
        ? undefined
        : workspaceBackups.find(
            (candidate) => candidate.id === target.backupId,
          );
    setContextMenu(null);
    if (id !== "workbench.commandPalette") {
      setIsCommandPaletteOpen(false);
    }

    switch (id) {
      case "workbench.commandPalette":
        setIsCommandPaletteOpen(true);
        return;
      case "workbench.quickOpen":
        setIsSidebarOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      case "workbench.clearQuickOpen":
        setQuery("");
        return;
      case "workbench.toggleSidebar":
        setIsSidebarOpen((value) => !value);
        return;
      case "workspace.createNote":
        modalPreviousFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        openNewNote();
        return;
      case "workspace.confirmCreateNote":
        void createNote();
        return;
      case "dialog.closeNewNote":
        setIsNewNoteOpen(false);
        return;
      case "workspace.openToday":
        void openTodayJournal();
        return;
      case "workspace.createUuidLab":
        void createUuidLab();
        return;
      case "workspace.save":
        if (nativeRuntime) {
          setSaveRetry((value) => value + 1);
          setToast("正在保存当前 Markdown 源文件。");
        } else {
          setToast("浏览器预览状态已保存在此浏览器。");
        }
        return;
      case "workspace.resolveSave":
        void handleSaveStatusAction();
        return;
      case "workspace.copyRoot":
        void copyText(nativeRoot).then(
          () => setToast("Markdown 工作区位置已复制。"),
          () => setToast("无法复制工作区位置。"),
        );
        return;
      case "workspace.openExternalChanges":
        modalPreviousFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setIsExternalChangesOpen(true);
        return;
      case "workspace.applyExternalChanges":
        void applyVerifiedExternalChanges();
        return;
      case "workspace.recoverAndApplyExternalChanges":
        void recoverEditsAndAcceptExternalChanges();
        return;
      case "dialog.closeExternalChanges":
        setIsExternalChangesOpen(false);
        return;
      case "workspace.rebuildIndex":
        void rebuildSearchIndex();
        return;
      case "workspace.resetPreview":
        resetDemoData();
        return;
      case "backup.create":
        void createWorkspaceBackup();
        return;
      case "backup.verify":
        if (backup !== undefined) {
          void verifyWorkspaceBackup(backup);
        }
        return;
      case "backup.restore":
        if (backup !== undefined) {
          void restoreWorkspaceBackup(backup);
        }
        return;
      case "retention.preview":
        setActiveView("versions");
        void previewVersionRetention();
        return;
      case "retention.apply":
        void applyVersionRetention();
        return;
      case "note.open":
        if (note !== undefined) {
          activateNote(note);
          setQuery("");
        }
        return;
      case "wiki.open":
        if (note !== undefined && target.rawWikiTarget !== undefined) {
          void openWikiTarget(target.rawWikiTarget, note.id);
        }
        return;
      case "wiki.copyTarget":
        if (target.rawWikiTarget !== undefined) {
          void copyText(target.rawWikiTarget).then(
            () => setToast("Wiki 目标已复制。"),
            () => setToast("无法复制 Wiki 目标。"),
          );
        }
        return;
      case "attachment.copyTarget":
        if (target.rawAttachmentTarget !== undefined) {
          void copyText(target.rawAttachmentTarget).then(
            () => setToast("附件目标已复制。"),
            () => setToast("无法复制附件目标。"),
          );
        }
        return;
      case "attachment.import":
        if (note !== undefined) {
          void beginAttachmentImport(note);
        }
        return;
      case "attachment.confirmImport":
        void confirmAttachmentImport();
        return;
      case "dialog.closeAttachmentImport":
        void cancelAttachmentImport();
        return;
      case "note.openSplit":
        if (note !== undefined) {
          openSplitFor(note);
        }
        return;
      case "note.copyTitle":
        if (note !== undefined) {
          void copyNoteTitle(note);
        }
        return;
      case "note.copyMarkdown":
        if (note !== undefined) {
          void copyNoteContent(note, "markdown");
        }
        return;
      case "note.copyPlainText":
        if (note !== undefined) {
          void copyNoteContent(note, "plainText");
        }
        return;
      case "note.rename":
        if (note !== undefined) {
          void renameNoteFile(note);
        }
        return;
      case "note.copyLearningPrompt":
        void copyForAi(note);
        return;
      case "note.showVersions":
        if (note !== undefined) {
          openVersionsFor(note);
        }
        return;
      case "version.save":
        if (note !== undefined) {
          void saveVersionFor(note);
        }
        return;
      case "view.edit":
      case "view.split":
      case "view.preview":
        if (note !== undefined && activeView === "versions") {
          activateNote(note);
        }
        setEditorMode(
          id === "view.edit"
            ? "edit"
            : id === "view.split"
              ? "split"
              : "preview",
        );
        return;
      case "view.toggleLivePreview":
        setLivePreviewEnabled((enabled) => {
          setToast(
            enabled
              ? "已关闭编辑器实时预览；Markdown 源码保持可见。"
              : "已开启编辑器实时预览；光标进入语法时会显示源码。",
          );
          return !enabled;
        });
        return;
      case "view.toggleOutline":
        setOutlineOpen((open) => {
          const next = !open;
          if (next) {
            setBacklinksOpen(false);
            setLocalGraphOpen(false);
          }
          return next;
        });
        return;
      case "view.toggleBacklinks":
        setBacklinksOpen((open) => {
          const next = !open;
          if (next) {
            setOutlineOpen(false);
            setLocalGraphOpen(false);
          }
          return next;
        });
        return;
      case "view.toggleGraph":
        setLocalGraphOpen((open) => {
          const next = !open;
          if (next) {
            setOutlineOpen(false);
            setBacklinksOpen(false);
          }
          return next;
        });
        return;
      case "tab.close":
        if (target.noteId === undefined) {
          closeActiveTab();
        } else {
          closeTab(target.noteId);
        }
        return;
      case "tab.closeOthers":
        if (note !== undefined) {
          closeOtherTabs(note);
        }
        return;
      case "tab.reopenClosed":
        reopenClosedTab();
        return;
      case "tab.next":
        cycleTab(1);
        return;
      case "tab.previous":
        cycleTab(-1);
        return;
      case "edit.copy":
        document.execCommand("copy");
        return;
      case "edit.cut":
        document.execCommand("cut");
        return;
      case "edit.paste":
        void pasteIntoContextInput();
        return;
      case "edit.selectAll":
        document.execCommand("selectAll");
        return;
      case "edit.undo":
        editorRef.current?.undo();
        return;
      case "edit.redo":
        editorRef.current?.redo();
        return;
      case "version.restore":
        if (snapshot !== undefined) {
          void restoreVersion(snapshot);
        }
        return;
      case "version.copyMarkdown":
        if (snapshot !== undefined) {
          void copySnapshotMarkdown(snapshot);
        }
        return;
      case "version.toggleCheckpoint":
        if (snapshot !== undefined) {
          void toggleVersionCheckpoint(snapshot);
        }
        return;
      case "version.openNote":
        if (note !== undefined) {
          activateNote(note);
        }
        return;
      case "version.delete":
        if (snapshot !== undefined) {
          void deleteVersion(snapshot);
        }
        return;
      case "window.minimize":
        void runWindowAction("minimize");
        return;
      case "window.maximize":
        void runWindowAction("maximize");
        return;
      case "window.close":
        void runWindowAction("close");
        return;
      case "view.today":
        navigate("today");
        return;
      case "view.continue":
        navigate("continue");
        return;
      case "view.topics":
        navigate("topics");
        return;
      case "view.review":
        navigate("review");
        return;
      case "view.sources":
        navigate("sources");
        return;
      case "view.experiments":
        navigate("experiments");
        return;
      case "view.versions":
        navigate("versions");
        return;
    }
  }

  function handleDialogKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'input, select, button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleContextMenuKeyboard(
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      setContextMenu(null);
      contextTargetRef.current?.focus();
      return;
    }
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex(
      (item) => item === document.activeElement,
    );
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1 + items.length) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        (currentIndex <= 0 ? items.length : currentIndex) - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  }

  function handleRovingKeyboard(
    event: ReactKeyboardEvent<HTMLElement>,
    selector: string,
    orientation: "horizontal" | "vertical",
    activate = false,
  ) {
    const current =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>(selector)
        : null;
    if (current === null) {
      return;
    }
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(selector),
    ].filter((item) => !item.matches(":disabled"));
    const currentIndex = items.indexOf(current);
    if (currentIndex < 0 || items.length === 0) {
      return;
    }
    let nextIndex: number | undefined;
    if (
      event.key ===
      (orientation === "horizontal" ? "ArrowRight" : "ArrowDown")
    ) {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (
      event.key ===
      (orientation === "horizontal" ? "ArrowLeft" : "ArrowUp")
    ) {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      const next = items[nextIndex];
      next?.focus();
      if (activate) {
        next?.click();
      }
    }
  }

  function openContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    const target = event.target instanceof Element
      ? event.target
      : event.currentTarget;
    const contextElement = target.closest<HTMLElement | SVGElement>(
      "[data-context]",
    );
    const nativeInput = target.closest("input, textarea");
    const focusableTarget = target.closest<HTMLElement | SVGElement>(
      'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    );
    contextTargetRef.current =
      nativeInput instanceof HTMLElement
        ? nativeInput
        : (focusableTarget ??
          (document.activeElement instanceof HTMLElement
            ? document.activeElement
            : event.currentTarget));
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
    const contextualNoteId =
      contextElement?.dataset.noteId ??
      contextElement
        ?.closest<HTMLElement | SVGElement>("[data-note-id]")
        ?.dataset.noteId;
    setContextMenu({
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - width - 4)),
      y: Math.max(34, Math.min(event.clientY, window.innerHeight - height - 4)),
      scope,
      hasSelection,
      ...(contextualNoteId === undefined
        ? {}
        : { noteId: contextualNoteId }),
      ...(contextElement?.dataset.wikiTarget === undefined
        ? {}
        : { rawWikiTarget: contextElement.dataset.wikiTarget }),
      ...(contextElement?.dataset.attachmentTarget === undefined
        ? {}
        : {
            rawAttachmentTarget:
              contextElement.dataset.attachmentTarget,
          }),
      ...(contextElement?.dataset.snapshotId === undefined
        ? {}
        : { snapshotId: contextElement.dataset.snapshotId }),
    });
    setIsCommandPaletteOpen(false);
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
    if (contextMenu === null) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        isCommandPaletteOpen ||
        isNewNoteOpen ||
        isExternalChangesOpen ||
        pendingWikiCreation !== null
      ) {
        return;
      }
      if (event.key === "Escape") {
        setContextMenu(null);
        return;
      }
      const command = commandForShortcut(event);
      if (command === undefined) {
        return;
      }
      event.preventDefault();
      const focused = document.activeElement?.closest<HTMLElement>(
        '[data-context="note-item"], [data-context="tab"]',
      );
      runCommand(command.id, {
        ...(focused?.dataset.noteId === undefined
          ? {}
          : { noteId: focused.dataset.noteId }),
      });
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
        : livePreviewEnabled
          ? "Markdown · 实时语法"
          : "Markdown · 源码";
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
  const contextCommandTarget: CommandTarget =
    contextMenu === null
      ? {}
      : {
          scope: contextMenu.scope,
          hasSelection: contextMenu.hasSelection,
          ...(contextMenu.noteId === undefined
            ? {}
            : { noteId: contextMenu.noteId }),
          ...(contextMenu.rawWikiTarget === undefined
            ? {}
            : { rawWikiTarget: contextMenu.rawWikiTarget }),
          ...(contextMenu.rawAttachmentTarget === undefined
            ? {}
            : {
                rawAttachmentTarget:
                  contextMenu.rawAttachmentTarget,
              }),
          ...(contextMenu.snapshotId === undefined
            ? {}
            : { snapshotId: contextMenu.snapshotId }),
        };
  const contextCommands =
    contextMenu === null
      ? []
      : commandsForContext(commandContextFor(contextCommandTarget));
  const paletteContext = commandContextFor();

  return (
    <main
      className={`app-shell${isSidebarOpen ? "" : " is-sidebar-collapsed"}`}
      onContextMenu={openContextMenu}
    >
      <header
        className="app-titlebar"
        data-context="titlebar"
        data-tauri-drag-region
        onDoubleClick={() => runCommand("window.maximize")}
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
            onClick={() => runCommand("window.minimize")}
            title="最小化"
            type="button"
          >
            <Minus />
          </button>
          <button
            aria-label="最大化或还原窗口"
            onClick={() => runCommand("window.maximize")}
            title="最大化或还原"
            type="button"
          >
            <Maximize2 />
          </button>
          <button
            aria-label="关闭窗口"
            className="close-window"
            onClick={() => runCommand("window.close")}
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
          onClick={() => runCommand("workbench.toggleSidebar")}
          title="显示或隐藏笔记栏"
          type="button"
        >
          <BrainCircuit />
        </button>

        <nav
          aria-label="学习导航"
          onKeyDown={(event) =>
            handleRovingKeyboard(event, "button", "vertical")
          }
        >
          {PRIMARY_NAVIGATION.map(({ key, icon: Icon }) => (
            <button
              aria-current={activeView === key ? "page" : undefined}
              aria-label={VIEW_COPY[key].label}
              className={activeView === key ? "is-active" : ""}
              key={key}
              onClick={() => runCommand(viewCommandId(key))}
              title={VIEW_COPY[key].label}
              type="button"
            >
              <Icon />
            </button>
          ))}
        </nav>

        <nav
          aria-label="工作区工具"
          className="activity-secondary"
          onKeyDown={(event) =>
            handleRovingKeyboard(event, "button", "vertical")
          }
        >
          {SECONDARY_NAVIGATION.map(({ key, icon: Icon }) => (
            <button
              aria-current={activeView === key ? "page" : undefined}
              aria-label={VIEW_COPY[key].label}
              className={activeView === key ? "is-active" : ""}
              key={key}
              onClick={() => runCommand(viewCommandId(key))}
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
                onClick={() => runCommand("workspace.openToday")}
                title="打开今日日记"
                type="button"
              >
                <NotebookPen />
              </button>
            )}
            <button
              aria-label="新建笔记"
              onClick={() => runCommand("workspace.createNote")}
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
                onClick={() => runCommand("workbench.clearQuickOpen")}
                type="button"
              >
                <X />
              </button>
            )}
          </label>
        </div>

        <section
          aria-label="笔记列表"
          className="note-list"
          onKeyDown={(event) =>
            handleRovingKeyboard(event, "button", "vertical")
          }
        >
          <h2>{query.trim().length > 0 ? "搜索结果" : "笔记"}</h2>
          {(query.trim().length > 0 ? results : visibleNotes).map((note) => (
            <button
              className={note.id === selectedNote?.id ? "is-current" : ""}
              data-context="note-item"
              data-note-id={note.id}
              key={note.id}
              onClick={() => runCommand("note.open", { noteId: note.id })}
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
              onClick={() => runCommand("workbench.toggleSidebar")}
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
            <button
              aria-keyshortcuts="Control+Shift+P"
              className="command-palette-trigger"
              onClick={() => runCommand("workbench.commandPalette")}
              title={`${commandById("workbench.commandPalette").title} (Ctrl+Shift+P)`}
              type="button"
            >
              <CommandIcon />
              <span>命令</span>
            </button>
            {activeView === "versions" ? (
              <button
                className="primary"
                disabled={selectedNote === undefined}
                onClick={() => runCommand("version.save")}
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
                    onClick={() => runCommand("view.edit")}
                    title="编辑"
                    type="button"
                  >
                    <PencilLine />
                    <span>编辑</span>
                  </button>
                  <button
                    aria-pressed={editorMode === "split"}
                    className={editorMode === "split" ? "is-active" : ""}
                    onClick={() => runCommand("view.split")}
                    title="实时分栏预览 (Ctrl+\\)"
                    type="button"
                  >
                    <Columns2 />
                    <span>分栏</span>
                  </button>
                  <button
                    aria-pressed={editorMode === "preview"}
                    className={editorMode === "preview" ? "is-active" : ""}
                    onClick={() => runCommand("view.preview")}
                    title="Markdown 预览 (Ctrl+Shift+V)"
                    type="button"
                  >
                    <BookOpenText />
                    <span>预览</span>
                  </button>
                </div>
                <button
                  aria-pressed={livePreviewEnabled}
                  className={livePreviewEnabled ? "is-active" : undefined}
                  onClick={() => runCommand("view.toggleLivePreview")}
                  title={
                    livePreviewEnabled
                      ? "关闭光标感知实时预览"
                      : "开启光标感知实时预览"
                  }
                  type="button"
                >
                  <Eye />
                  <span>实时语法</span>
                </button>
                <button
                  aria-pressed={outlineOpen}
                  className={outlineOpen ? "is-active" : undefined}
                  onClick={() => runCommand("view.toggleOutline")}
                  title={outlineOpen ? "关闭文档大纲" : "打开文档大纲"}
                  type="button"
                >
                  <ListTree />
                  <span>大纲</span>
                </button>
                {nativeRuntime ? (
                  <>
                    <button
                      aria-pressed={backlinksOpen}
                      className={backlinksOpen ? "is-active" : undefined}
                      onClick={() => runCommand("view.toggleBacklinks")}
                      title={
                        backlinksOpen ? "关闭反向链接" : "打开反向链接"
                      }
                      type="button"
                    >
                      <Link2 />
                      <span>反向链接</span>
                    </button>
                    <button
                      aria-pressed={localGraphOpen}
                      className={localGraphOpen ? "is-active" : undefined}
                      onClick={() => runCommand("view.toggleGraph")}
                      title={localGraphOpen ? "关闭局部图谱" : "打开局部图谱"}
                      type="button"
                    >
                      <Network />
                      <span>局部图谱</span>
                    </button>
                    <button
                      aria-busy={attachmentImportState === "selecting"}
                      disabled={
                        selectedNote === undefined ||
                        editorMode === "preview" ||
                        attachmentImportState !== "idle" ||
                        pendingAttachmentImport !== null
                      }
                      onClick={() => runCommand("attachment.import")}
                      title="选择本机文件，确认后导入并在光标处插入引用"
                      type="button"
                    >
                      <Paperclip />
                      <span>
                        {attachmentImportState === "selecting"
                          ? "正在选择"
                          : "附件"}
                      </span>
                    </button>
                  </>
                ) : null}
                <button
                  onClick={() => runCommand("workspace.createUuidLab")}
                  title="新建 UUID 交互实验"
                  type="button"
                >
                  <FlaskConical />
                  <span>交互实验</span>
                </button>
                <button
                  onClick={() => runCommand("version.save")}
                  title="保存版本"
                  type="button"
                >
                  <Save />
                  <span>保存版本</span>
                </button>
                <button
                  className="primary"
                  onClick={() => runCommand("note.copyLearningPrompt")}
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

        <div
          aria-label="打开的笔记"
          className="editor-tabs"
          onKeyDown={(event) =>
            handleRovingKeyboard(event, ".tab-main", "horizontal", true)
          }
          role="tablist"
        >
          {activeView === "versions" ? (
            <div className="is-active">
              <button
                aria-selected="true"
                className="tab-main"
                onClick={() => runCommand("view.versions")}
                role="tab"
                type="button"
              >
                <GitBranch />
                <strong>本地版本历史</strong>
              </button>
              <button
                aria-label="关闭版本标签"
                className="tab-close"
                onClick={() => runCommand("tab.close")}
                title="关闭 (Ctrl+W)"
                type="button"
              >
                <X />
              </button>
            </div>
          ) : (
            openNotes.map((note) => (
              <div
                className={note.id === activeNoteId ? "is-active" : ""}
                data-context="tab"
                data-note-id={note.id}
                key={note.id}
              >
                <button
                  aria-selected={note.id === activeNoteId}
                  className="tab-main"
                  onClick={() => runCommand("note.open", { noteId: note.id })}
                  role="tab"
                  tabIndex={note.id === activeNoteId ? 0 : -1}
                  title={note.title}
                  type="button"
                >
                  <span>#</span>
                  <strong>{note.title}</strong>
                </button>
                <button
                  aria-label={`关闭 ${note.title}`}
                  className="tab-close"
                  onClick={() => runCommand("tab.close", { noteId: note.id })}
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
              backupState={backupState}
              backups={workspaceBackups}
              currentNote={selectedNote}
              isNative={nativeRuntime}
              nativeHistory={nativeVersionHistory}
              onApplyRetention={() => runCommand("retention.apply")}
              onCreateBackup={() => runCommand("backup.create")}
              onDelete={(snapshot) =>
                runCommand("version.delete", { snapshotId: snapshot.id })
              }
              onPreviewRetention={() => runCommand("retention.preview")}
              onReset={() => runCommand("workspace.resetPreview")}
              onRestore={(snapshot) =>
                runCommand("version.restore", { snapshotId: snapshot.id })
              }
              onRestoreBackup={(backup) =>
                runCommand("backup.restore", { backupId: backup.id })
              }
              onToggleCheckpoint={(snapshot) =>
                runCommand("version.toggleCheckpoint", {
                  snapshotId: snapshot.id,
                })
              }
              onVerifyBackup={(backup) =>
                runCommand("backup.verify", { backupId: backup.id })
              }
              retentionPolicy={retentionPolicy}
              retentionPreview={retentionPreview}
              retentionState={retentionState}
              setRetentionPolicy={updateRetentionPolicy}
              verifiedBackupId={verifiedBackupId}
              workspace={workspace}
            />
          ) : selectedNote === undefined ? (
            <EmptyWorkspace
              onCreate={() => runCommand("workspace.createNote")}
            />
          ) : (
            <div
              className={
                `editor-workspace${localGraphOpen ? " has-graph" : ""}${
                  outlineOpen || backlinksOpen || localGraphOpen
                    ? " has-inspector"
                    : ""
                }`
              }
            >
              <div className="editor-surface">
                {editorMode === "preview" ? (
                  <Suspense fallback={<MarkdownPreviewLoading />}>
                    <MarkdownPreview
                      markdown={selectedNote.markdown}
                      sourceNoteId={selectedNote.id}
                      {...(nativeRuntime
                        ? {
                            onOpenWikiTarget: openWikiTarget,
                            onResolveAttachment: resolvePreviewAttachment,
                          }
                        : {})}
                    />
                  </Suspense>
                ) : editorMode === "split" ? (
                  <div className="editor-split">
                    <MarkdownEditor
                      key={selectedNote.id}
                      livePreview={livePreviewEnabled}
                      noteId={selectedNote.id}
                      onChange={updateMarkdown}
                      {...(nativeRuntime
                        ? {
                            onOpenWikiTarget: openWikiTarget,
                            onResolveAttachment: resolvePreviewAttachment,
                          }
                        : {})}
                      onStatusChange={setEditorStatus}
                      ref={editorRef}
                      value={selectedNote.markdown}
                    />
                    <Suspense fallback={<MarkdownPreviewLoading />}>
                      <MarkdownPreview
                        markdown={selectedNote.markdown}
                        sourceNoteId={selectedNote.id}
                        {...(nativeRuntime
                          ? {
                              onOpenWikiTarget: openWikiTarget,
                              onResolveAttachment: resolvePreviewAttachment,
                            }
                          : {})}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <MarkdownEditor
                    key={selectedNote.id}
                    livePreview={livePreviewEnabled}
                    noteId={selectedNote.id}
                    onChange={updateMarkdown}
                    {...(nativeRuntime
                      ? {
                          onOpenWikiTarget: openWikiTarget,
                          onResolveAttachment: resolvePreviewAttachment,
                        }
                      : {})}
                    onStatusChange={setEditorStatus}
                    ref={editorRef}
                    value={selectedNote.markdown}
                  />
                )}
              </div>
              {outlineOpen ? (
                <Suspense fallback={null}>
                  <DocumentOutline
                    markdown={selectedNote.markdown}
                    noteId={selectedNote.id}
                    onClose={() => runCommand("view.toggleOutline")}
                    onNavigate={(item) => {
                      if (item.offset === null) {
                        return;
                      }
                      if (editorMode === "preview") {
                        document
                          .getElementById(`heading-${item.offset}`)
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                      } else {
                        editorRef.current?.revealOffset(item.offset);
                      }
                    }}
                  />
                </Suspense>
              ) : null}
              {backlinksOpen ? (
                <Suspense fallback={null}>
                  <BacklinksPanel
                    noteId={selectedNote.id}
                    onClose={() => runCommand("view.toggleBacklinks")}
                    onOpen={openBacklink}
                    references={nativeBacklinks}
                    state={nativeBacklinksState}
                  />
                </Suspense>
              ) : null}
              {localGraphOpen ? (
                <Suspense fallback={null}>
                  <LocalGraphPanel
                    graph={nativeLocalGraph}
                    noteId={selectedNote.id}
                    onClose={() => runCommand("view.toggleGraph")}
                    onOpen={openGraphNode}
                    state={nativeLocalGraphState}
                  />
                </Suspense>
              ) : null}
            </div>
          )}
        </section>

        <footer className="status-bar" data-context="status">
          <button
            aria-disabled={!saveStatusActionable}
            className={`save-status is-${saveState}`}
            onClick={() => runCommand("workspace.resolveSave")}
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
                runCommand("workspace.rebuildIndex");
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
              onClick={() => runCommand("workspace.openExternalChanges")}
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
          {editorStatus.selectionCount > 1 && (
            <span className="status-selections">
              {editorStatus.selectionCount} 个光标
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

      {pendingAttachmentImport !== null && (
        <div className="modal-backdrop">
          <section
            aria-describedby="attachment-import-description"
            aria-labelledby="attachment-import-title"
            aria-modal="true"
            className="new-note-modal attachment-import-modal"
            onKeyDown={handleDialogKeyboard}
            ref={attachmentImportDialogRef}
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">受控附件导入</span>
                <h2 id="attachment-import-title">确认保存与插入位置</h2>
              </div>
              <button
                aria-label="取消附件导入"
                disabled={attachmentImportState === "confirming"}
                onClick={() => runCommand("dialog.closeAttachmentImport")}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="attachment-import-details">
              <p id="attachment-import-description">
                目前只读取了所选文件，还没有写入工作区。确认时会再次核对目标位置，
                保留原始字节且绝不覆盖同名文件，然后在当前光标处完成一次可撤销的
                Markdown 插入。
              </p>
              <dl>
                <div>
                  <dt>原文件名</dt>
                  <dd>{pendingAttachmentImport.originalFileName}</dd>
                </div>
                <div>
                  <dt>保存位置</dt>
                  <dd>
                    <code>{pendingAttachmentImport.path}</code>
                  </dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{formatBytes(pendingAttachmentImport.byteLength)}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{pendingAttachmentImport.contentSha256}</code>
                  </dd>
                </div>
                <div>
                  <dt>显示方式</dt>
                  <dd>
                    {pendingAttachmentImport.presentation === "inlineImage"
                      ? "安全的本地图片预览"
                      : "惰性附件引用（不会执行文件）"}
                  </dd>
                </div>
                <div className="attachment-reference-row">
                  <dt>插入内容</dt>
                  <dd>
                    <code>{pendingAttachmentImport.markdownReference}</code>
                  </dd>
                </div>
              </dl>
            </div>
            <footer>
              <button
                disabled={attachmentImportState === "confirming"}
                onClick={() => runCommand("dialog.closeAttachmentImport")}
                type="button"
              >
                取消
              </button>
              <button
                className="primary"
                disabled={attachmentImportState !== "reviewing"}
                onClick={() => runCommand("attachment.confirmImport")}
                type="button"
              >
                <Paperclip />
                {attachmentImportState === "confirming"
                  ? "正在核验并导入…"
                  : "确认导入并插入"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {pendingWikiCreation !== null && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="wiki-create-title"
            aria-modal="true"
            className="new-note-modal wiki-create-modal"
            onKeyDown={handleDialogKeyboard}
            ref={wikiCreationDialogRef}
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">缺失的 Wiki 目标</span>
                <h2 id="wiki-create-title">创建新的知识节点？</h2>
              </div>
              <button
                aria-label="取消创建 Wiki 目标"
                disabled={isCreatingWikiTarget}
                onClick={() => setPendingWikiCreation(null)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className="wiki-create-details">
              <p>
                当前链接没有匹配任何知识节点。知织只会在你确认后创建下面这个
                Markdown 文件，不会覆盖已有内容。
              </p>
              <dl>
                <div>
                  <dt>节点名称</dt>
                  <dd>{pendingWikiCreation.proposal.title}</dd>
                </div>
                <div>
                  <dt>创建位置</dt>
                  <dd>
                    <code>{pendingWikiCreation.proposal.path}</code>
                  </dd>
                </div>
                {pendingWikiCreation.proposal.heading === null ? null : (
                  <div>
                    <dt>同时创建小节</dt>
                    <dd>{pendingWikiCreation.proposal.heading}</dd>
                  </div>
                )}
              </dl>
            </div>
            <footer>
              <button
                disabled={isCreatingWikiTarget}
                onClick={() => setPendingWikiCreation(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary"
                disabled={isCreatingWikiTarget}
                onClick={() => void confirmWikiTargetCreation()}
                type="button"
              >
                <Plus />
                {isCreatingWikiTarget ? "正在安全创建…" : "创建并打开"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {isNewNoteOpen && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="new-note-title"
            aria-modal="true"
            className="new-note-modal"
            onKeyDown={handleDialogKeyboard}
            ref={newNoteDialogRef}
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">新建笔记</span>
                <h2 id="new-note-title">从一个问题开始</h2>
              </div>
              <button
                aria-label="关闭新建窗口"
                onClick={() => runCommand("dialog.closeNewNote")}
                type="button"
              >
                <X />
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                runCommand("workspace.confirmCreateNote");
              }}
            >
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
                <button
                  onClick={() => runCommand("dialog.closeNewNote")}
                  type="button"
                >
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
            onKeyDown={handleDialogKeyboard}
            ref={externalDialogRef}
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
                onClick={() => runCommand("dialog.closeExternalChanges")}
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
                  onClick={() => runCommand("dialog.closeExternalChanges")}
                  type="button"
                >
                  稍后处理
                </button>
                <button
                  disabled={isResolvingExternalChanges}
                  onClick={() => runCommand("workspace.applyExternalChanges")}
                  type="button"
                >
                  <RotateCcw />
                  安全应用无冲突更改
                </button>
                <button
                  className="primary"
                  disabled={isResolvingExternalChanges}
                  onClick={() =>
                    runCommand("workspace.recoverAndApplyExternalChanges")
                  }
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
          aria-label="知织上下文命令"
          className="context-menu"
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={handleContextMenuKeyboard}
          onMouseDown={(event) => {
            if (contextMenu.hasSelection) {
              event.preventDefault();
            }
          }}
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <span className="context-heading">
            {contextMenuLabel(
              contextMenu.scope,
              contextNote,
              contextSnapshot,
              contextMenu.rawWikiTarget,
              contextMenu.rawAttachmentTarget,
            )}
          </span>
          {contextCommands.map((command, index) => {
            const previous = contextCommands[index - 1];
            const Icon = commandIcon(command.id);
            return (
              <Fragment key={command.id}>
                {previous?.group !== command.group && (
                  <span className="context-label">
                    {contextCommandGroupLabel(command.group, contextMenu.scope)}
                  </span>
                )}
                <button
                  aria-keyshortcuts={command.shortcut?.label.replace(
                    "Ctrl",
                    "Control",
                  )}
                  className={command.dangerous === true ? "danger" : undefined}
                  disabled={!command.enabled}
                  onClick={() => runCommand(command.id, contextCommandTarget)}
                  role="menuitem"
                  type="button"
                >
                  <Icon />
                  {contextCommandTitle(
                    command,
                    contextNote,
                    contextSnapshot,
                    saveState,
                  )}
                  {command.shortcut !== undefined && (
                    <kbd>{command.shortcut.label}</kbd>
                  )}
                </button>
              </Fragment>
            );
          })}
        </section>
      )}
      {isCommandPaletteOpen && (
        <CommandPalette
          context={paletteContext}
          onClose={() => setIsCommandPaletteOpen(false)}
          onRun={(id) => runCommand(id)}
        />
      )}
    </main>
  );
}

interface VersionHistoryProps {
  readonly backups: readonly NativeWorkspaceBackupSummary[];
  readonly backupState:
    | "idle"
    | "loading"
    | "creating"
    | "verifying"
    | "restoring";
  readonly currentNote: LearningNote | undefined;
  readonly isNative: boolean;
  readonly nativeHistory: NativeVersionHistory | null;
  readonly onApplyRetention: () => void | Promise<void>;
  readonly onCreateBackup: () => void | Promise<void>;
  readonly workspace: WorkspaceState;
  readonly onDelete: (snapshot: NoteSnapshot) => void | Promise<void>;
  readonly onPreviewRetention: () => void | Promise<void>;
  readonly onReset: () => void;
  readonly onRestore: (snapshot: NoteSnapshot) => void | Promise<void>;
  readonly onRestoreBackup: (
    backup: NativeWorkspaceBackupSummary,
  ) => void | Promise<void>;
  readonly onToggleCheckpoint: (
    snapshot: NoteSnapshot,
  ) => void | Promise<void>;
  readonly retentionPolicy: NativeVersionRetentionPolicy;
  readonly retentionPreview: NativeVersionRetentionPreview | null;
  readonly retentionState: "idle" | "previewing" | "applying";
  readonly setRetentionPolicy: (
    policy: NativeVersionRetentionPolicy,
  ) => void;
  readonly onVerifyBackup: (
    backup: NativeWorkspaceBackupSummary,
  ) => void | Promise<void>;
  readonly verifiedBackupId: string | null;
}

function VersionHistory({
  backups,
  backupState,
  currentNote,
  isNative,
  nativeHistory,
  onApplyRetention,
  onCreateBackup,
  workspace,
  onDelete,
  onPreviewRetention,
  onReset,
  onRestore,
  onRestoreBackup,
  onToggleCheckpoint,
  retentionPolicy,
  retentionPreview,
  retentionState,
  setRetentionPolicy,
  onVerifyBackup,
  verifiedBackupId,
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
      {isNative && (
        <section className="retention-panel" aria-label="旧版本保留与清理">
          <div className="retention-copy">
            <Bookmark />
            <div>
              <h3>安全清理旧版本</h3>
              <p>
                始终保护检查点、当前分支头、最早基线和每条分支末端；先预览，再执行。
              </p>
            </div>
          </div>
          <div className="retention-controls">
            <label>
              至少保留最新
              <input
                aria-label="至少保留的最新版本数"
                max={1000}
                min={1}
                onChange={(event) =>
                  setRetentionPolicy({
                    ...retentionPolicy,
                    keepLatest: boundedInteger(
                      event.currentTarget.value,
                      1,
                      1000,
                      retentionPolicy.keepLatest,
                    ),
                  })
                }
                type="number"
                value={retentionPolicy.keepLatest}
              />
              个
            </label>
            <label>
              保留最近
              <input
                aria-label="保留最近天数"
                max={3650}
                min={0}
                onChange={(event) =>
                  setRetentionPolicy({
                    ...retentionPolicy,
                    keepDays: boundedInteger(
                      event.currentTarget.value,
                      0,
                      3650,
                      retentionPolicy.keepDays,
                    ),
                  })
                }
                type="number"
                value={retentionPolicy.keepDays}
              />
              天
            </label>
            <button
              disabled={
                currentNote === undefined || retentionState !== "idle"
              }
              onClick={() => void onPreviewRetention()}
              type="button"
            >
              {retentionState === "previewing" ? "正在校验…" : "预览清理"}
            </button>
          </div>
          {retentionPreview !== null && (
            <div className="retention-preview" aria-live="polite">
              <div>
                <strong>
                  {retentionPreview.candidates.length === 0
                    ? "没有可安全清理的版本"
                    : `将清理 ${retentionPreview.candidates.length} 个旧版本`}
                </strong>
                <span>
                  保留 {retentionPreview.remainingVersionCount} 个 · 预计释放{" "}
                  {formatBytes(retentionPreview.releasedBytes)}
                </span>
              </div>
              {retentionPreview.candidates.length > 0 && (
                <>
                  <ol>
                    {retentionPreview.candidates.slice(0, 4).map((node) => (
                      <li key={node.id}>
                        {formatDate(
                          new Date(node.createdAtMillis).toISOString(),
                        )}
                        <span>{node.message ?? "手动版本"}</span>
                      </li>
                    ))}
                  </ol>
                  {retentionPreview.candidates.length > 4 && (
                    <small>
                      另有 {retentionPreview.candidates.length - 4} 个版本
                    </small>
                  )}
                  <button
                    className="danger"
                    disabled={retentionState !== "idle"}
                    onClick={() => void onApplyRetention()}
                    type="button"
                  >
                    <Trash2 />
                    {retentionState === "applying"
                      ? "正在清理…"
                      : "按此预览清理"}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {isNative && (
        <section className="backup-panel" aria-label="完整工作区备份与恢复">
          <header>
            <div>
              <Archive />
              <span>
                <strong>完整工作区备份</strong>
                <small>
                  Markdown、附件、身份清单、恢复副本和版本库；搜索索引会重建。
                </small>
              </span>
            </div>
            <button
              disabled={backupState !== "idle"}
              onClick={() => void onCreateBackup()}
              type="button"
            >
              <Archive />
              {backupState === "creating" ? "正在校验…" : "创建完整备份"}
            </button>
          </header>
          {backupState === "loading" ? (
            <p>正在读取本机备份清单…</p>
          ) : backups.length === 0 ? (
            <p>还没有完整工作区备份。版本节点不能替代独立备份。</p>
          ) : (
            <div className="backup-list">
              {backups.slice(0, 8).map((backup) => (
                <article key={backup.id}>
                  <div>
                    <strong>
                      {backup.label ??
                        formatDate(
                          new Date(backup.createdAtMillis).toISOString(),
                        )}
                    </strong>
                    {verifiedBackupId === backup.id && (
                      <span>
                        <ShieldCheck />
                        本次已校验
                      </span>
                    )}
                    <small>
                      {formatDate(
                        new Date(backup.createdAtMillis).toISOString(),
                      )}{" "}
                      · {backup.fileCount} 个文件 ·{" "}
                      {formatBytes(backup.totalBytes)} ·{" "}
                      {backup.historyVersionCount} 个版本
                    </small>
                    <code title={backup.pathDisplay}>
                      {backup.pathDisplay}
                    </code>
                  </div>
                  <footer>
                    <button
                      disabled={backupState !== "idle"}
                      onClick={() => void onVerifyBackup(backup)}
                      type="button"
                    >
                      <ShieldCheck />
                      完整校验
                    </button>
                    <button
                      className="restore"
                      disabled={backupState !== "idle"}
                      onClick={() => void onRestoreBackup(backup)}
                      type="button"
                    >
                      <RotateCcw />
                      恢复（重启）
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
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
                      {row.snapshot.checkpointName !== undefined && (
                        <span className="checkpoint-badge">
                          <Bookmark />
                          {row.snapshot.checkpointName}
                        </span>
                      )}
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
                    {isNative && (
                      <button
                        className={
                          row.snapshot.checkpointName === undefined
                            ? ""
                            : "is-checkpoint"
                        }
                        onClick={() =>
                          void onToggleCheckpoint(row.snapshot)
                        }
                        title={
                          row.snapshot.checkpointName === undefined
                            ? "命名并保护为检查点"
                            : "取消检查点保护"
                        }
                        type="button"
                      >
                        <Bookmark />
                        {row.snapshot.checkpointName === undefined
                          ? "检查点"
                          : "取消保护"}
                      </button>
                    )}
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

function MarkdownPreviewLoading() {
  return (
    <div className="markdown-preview-loading" role="status">
      正在解析 Markdown 结构…
    </div>
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

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
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
    case "attachment":
    case "backlinks":
    case "editor":
    case "embedded-lab":
    case "explorer":
    case "graph":
    case "input":
    case "note-item":
    case "outline":
    case "preview":
    case "status":
    case "tab":
    case "titlebar":
    case "version-node":
    case "wiki-link":
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
  rawWikiTarget?: string,
  rawAttachmentTarget?: string,
): string {
  switch (scope) {
    case "attachment":
      return rawAttachmentTarget === undefined
        ? "本地附件"
        : `附件：${rawAttachmentTarget}`;
    case "backlinks":
      return note === undefined ? "反向链接" : `反向链接：${note.title}`;
    case "graph":
      return note === undefined ? "局部图谱" : `局部图谱：${note.title}`;
    case "editor":
      return note === undefined ? "编辑器" : `编辑：${note.title}`;
    case "preview":
      return note === undefined ? "阅读视图" : `阅读：${note.title}`;
    case "embedded-lab":
      return note === undefined ? "交互实验" : `实验：${note.title}`;
    case "outline":
      return note === undefined ? "文档大纲" : `大纲：${note.title}`;
    case "note-item":
      return note === undefined ? "知识节点" : note.title;
    case "tab":
      return note === undefined ? "标签" : `标签：${note.title}`;
    case "version-node":
      return snapshot === undefined
        ? "版本节点"
        : `版本：${formatDate(snapshot.createdAt)}`;
    case "wiki-link":
      return rawWikiTarget === undefined
        ? "Wiki 链接"
        : `Wiki 链接：${rawWikiTarget}`;
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

function viewCommandId(view: ViewKey): CommandId {
  switch (view) {
    case "today":
      return "view.today";
    case "continue":
      return "view.continue";
    case "topics":
      return "view.topics";
    case "review":
      return "view.review";
    case "sources":
      return "view.sources";
    case "experiments":
      return "view.experiments";
    case "versions":
      return "view.versions";
  }
}

function contextCommandGroupLabel(
  group: string,
  scope: CommandScope,
): string {
  switch (group) {
    case "selection":
      return "选中内容";
    case "editing":
      return "编辑历史";
    case "document":
      return scope === "embedded-lab" ? "当前实验" : "当前知识节点";
    case "view":
      return "显示方式";
    case "note":
      return scope === "tab" ? "知识节点" : "所选知识节点";
    case "tabs":
      return "标签管理";
    case "status":
      return "保存与工作区";
    case "workspace":
      return "工作区";
    case "version":
      return "所选版本节点";
    case "wiki":
      return "Wiki 链接";
    case "attachment":
      return "附件";
    case "window":
      return "窗口";
    default:
      return "可用命令";
  }
}

function contextCommandTitle(
  command: ResolvedCommand,
  note: LearningNote | undefined,
  snapshot: NoteSnapshot | undefined,
  saveState: SaveState,
): string {
  switch (command.id) {
    case "edit.copy":
      return "复制选中内容";
    case "edit.cut":
      return "剪切选中内容";
    case "edit.undo":
      return "撤销";
    case "edit.redo":
      return "重做";
    case "note.open":
      return note === undefined ? command.title : `打开“${note.title}”`;
    case "wiki.open":
      return "解析并打开目标";
    case "wiki.copyTarget":
      return "复制目标文本";
    case "attachment.copyTarget":
      return "复制附件目标文本";
    case "attachment.import":
      return "从本机导入附件到当前光标";
    case "note.copyLearningPrompt":
      return "复制学习提示词";
    case "note.copyMarkdown":
      return "复制 Markdown 原文";
    case "note.copyPlainText":
      return "复制结构化阅读文本";
    case "note.showVersions":
      return "查看版本分支图";
    case "version.save":
      return "保存这个节点的版本";
    case "tab.close":
      return "关闭这个标签";
    case "version.toggleCheckpoint":
      return snapshot?.checkpointName === undefined
        ? "命名并保护为检查点"
        : "取消检查点保护";
    case "version.restore":
      return "恢复到这个版本";
    case "version.copyMarkdown":
      return "复制这个版本的 Markdown";
    case "version.delete":
      return "删除这个版本节点";
    case "workspace.resolveSave":
      return saveState === "conflict"
        ? "备份编辑内容并重新载入"
        : saveState === "mixed"
          ? "明确统一为 LF 并保存"
          : "重试保存";
    default:
      return command.title;
  }
}

function commandIcon(id: CommandId) {
  switch (id) {
    case "attachment.confirmImport":
    case "attachment.import":
      return Paperclip;
    case "backup.create":
    case "backup.restore":
    case "backup.verify":
      return Archive;
    case "edit.copy":
    case "note.copyMarkdown":
    case "note.copyPlainText":
    case "note.copyTitle":
    case "version.copyMarkdown":
    case "workspace.copyRoot":
    case "attachment.copyTarget":
    case "wiki.copyTarget":
      return Copy;
    case "edit.cut":
    case "version.delete":
      return Trash2;
    case "edit.paste":
    case "workspace.openToday":
      return NotebookPen;
    case "edit.selectAll":
      return CheckCircle2;
    case "edit.redo":
    case "edit.undo":
    case "tab.reopenClosed":
    case "version.restore":
    case "workspace.rebuildIndex":
    case "workspace.resetPreview":
      return RotateCcw;
    case "note.copyLearningPrompt":
      return Sparkles;
    case "note.open":
    case "version.openNote":
    case "view.preview":
    case "wiki.open":
      return BookOpenText;
    case "note.openSplit":
    case "view.split":
      return Columns2;
    case "view.toggleLivePreview":
      return Eye;
    case "view.toggleBacklinks":
      return Link2;
    case "view.toggleGraph":
      return Network;
    case "view.toggleOutline":
      return ListTree;
    case "note.rename":
    case "view.edit":
      return PencilLine;
    case "note.showVersions":
    case "view.versions":
    case "version.save":
      return GitBranch;
    case "retention.apply":
    case "version.toggleCheckpoint":
      return Bookmark;
    case "retention.preview":
      return ShieldCheck;
    case "tab.close":
    case "tab.closeOthers":
    case "window.close":
      return X;
    case "tab.next":
    case "tab.previous":
      return GitFork;
    case "view.today":
      return CalendarDays;
    case "view.continue":
      return GraduationCap;
    case "view.topics":
      return Network;
    case "view.review":
      return CheckCircle2;
    case "view.sources":
      return Library;
    case "view.experiments":
    case "workspace.createUuidLab":
      return FlaskConical;
    case "window.minimize":
      return Minus;
    case "window.maximize":
      return Maximize2;
    case "workbench.commandPalette":
      return CommandIcon;
    case "workbench.quickOpen":
      return Search;
    case "workbench.toggleSidebar":
      return Menu;
    case "workspace.createNote":
      return Plus;
    case "workspace.openExternalChanges":
      return GitFork;
    case "workspace.resolveSave":
    case "workspace.save":
      return Save;
    default:
      return CommandIcon;
  }
}

function readWorkbenchPreferences(): {
  readonly backlinksOpen: boolean;
  readonly livePreviewEnabled: boolean;
  readonly localGraphOpen: boolean;
  readonly outlineOpen: boolean;
} {
  const defaults = {
    backlinksOpen: false,
    livePreviewEnabled: true,
    localGraphOpen: false,
    outlineOpen: false,
  };
  try {
    const stored = localStorage.getItem(WORKBENCH_PREFERENCES_KEY);
    if (stored === null) {
      return defaults;
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return defaults;
    }
    const outlineOpen =
      "outlineOpen" in parsed &&
      typeof parsed.outlineOpen === "boolean"
        ? parsed.outlineOpen
        : defaults.outlineOpen;
    const backlinksOpen =
      "backlinksOpen" in parsed &&
      typeof parsed.backlinksOpen === "boolean"
        ? parsed.backlinksOpen
        : defaults.backlinksOpen;
    const localGraphOpen =
      "localGraphOpen" in parsed &&
      typeof parsed.localGraphOpen === "boolean"
        ? parsed.localGraphOpen
        : defaults.localGraphOpen;
    return {
      backlinksOpen: backlinksOpen && !outlineOpen,
      livePreviewEnabled:
        "livePreviewEnabled" in parsed &&
        typeof parsed.livePreviewEnabled === "boolean"
          ? parsed.livePreviewEnabled
          : defaults.livePreviewEnabled,
      localGraphOpen: localGraphOpen && !outlineOpen && !backlinksOpen,
      outlineOpen,
    };
  } catch {
    return defaults;
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
