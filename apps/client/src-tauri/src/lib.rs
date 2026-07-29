use std::{
    path::{Component, Path},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, RecvTimeoutError},
    },
    time::Duration,
};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager, State};
use zhiweave_application::{
    ApplyVersionRetentionRequest, ApplyVersionRetentionResult, CheckoutVersionRequest,
    CreateNoteRequest, CreateWorkspaceBackupRequest, CreateWorkspaceBackupResult,
    DeleteVersionRequest, DeleteVersionResult, DetectWorkspaceChangesRequest, NoteDocument,
    PrepareWorkspaceRestoreRequest, PrepareWorkspaceRestoreResult, PreviewVersionRetentionRequest,
    ReadVersionRequest, RebuildIndexResult, RenameNoteRequest, SaveNoteRequest, SaveNoteResult,
    SaveVersionRequest, SaveVersionResult, SearchNoteResult, SearchNotesRequest,
    SetVersionCheckpointRequest, SystemStatus, VerifyWorkspaceBackupRequest,
    VerifyWorkspaceBackupResult, VersionContent, VersionHistory, VersionHistoryRequest,
    VersionRetentionPreview, WorkspaceApplication, WorkspaceBackupSummary, WorkspaceChangesResult,
    WorkspaceFailure, WorkspaceSnapshot,
};
use zhiweave_domain::PortablePath;
use zhiweave_storage::FileWorkspace;

type NativeWorkspace = Arc<Mutex<WorkspaceApplication<FileWorkspace>>>;

const WORKSPACE_CHANGED_EVENT: &str = "workspace-files-changed";
const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

struct NativeWorkspaceWatcher {
    _watcher: Mutex<RecommendedWatcher>,
}

impl NativeWorkspaceWatcher {
    fn start(root: &Path, app: tauri::AppHandle) -> notify::Result<Self> {
        let root_for_callback = root.to_path_buf();
        // Capacity one deliberately coalesces event storms without blocking the
        // platform watcher callback. A queued wake-up already guarantees a
        // complete application-level rescan.
        let (sender, receiver) = mpsc::sync_channel(1);
        let mut watcher = notify::recommended_watcher(move |event| {
            if watcher_event_requires_rescan(&root_for_callback, &event) {
                let _ = sender.try_send(());
            }
        })?;
        watcher.watch(root, RecursiveMode::Recursive)?;
        std::thread::Builder::new()
            .name("zhiweave-workspace-watch".to_owned())
            .spawn(move || emit_debounced_workspace_changes(&receiver, &app))
            .map_err(notify::Error::io)?;
        Ok(Self {
            _watcher: Mutex::new(watcher),
        })
    }
}

fn watcher_event_requires_rescan(root: &Path, event: &notify::Result<Event>) -> bool {
    let Ok(event) = event else {
        return true;
    };
    event.need_rescan()
        || event.paths.is_empty()
        || event
            .paths
            .iter()
            .any(|path| !is_hidden_workspace_metadata(root, path))
}

fn is_hidden_workspace_metadata(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .next()
        .is_some_and(
            |component| matches!(component, Component::Normal(name) if name == ".zhiweave"),
        )
}

fn emit_debounced_workspace_changes(receiver: &Receiver<()>, app: &tauri::AppHandle) {
    let mut sequence = 0_u64;
    while receiver.recv().is_ok() {
        loop {
            match receiver.recv_timeout(WATCH_DEBOUNCE) {
                Ok(()) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        sequence = sequence.saturating_add(1);
        let _ = app.emit(WORKSPACE_CHANGED_EVENT, sequence);
    }
}

#[tauri::command]
fn system_status() -> SystemStatus {
    zhiweave_application::system_status()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_snapshot(
    workspace: State<'_, NativeWorkspace>,
) -> Result<WorkspaceSnapshot, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .snapshot()
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_changes(
    workspace: State<'_, NativeWorkspace>,
    request: DetectWorkspaceChangesRequest,
) -> Result<WorkspaceChangesResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .detect_changes(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn note_create(
    workspace: State<'_, NativeWorkspace>,
    request: CreateNoteRequest,
) -> Result<NoteDocument, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .create(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn note_save(
    workspace: State<'_, NativeWorkspace>,
    request: SaveNoteRequest,
) -> Result<SaveNoteResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .save(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn note_rename(
    workspace: State<'_, NativeWorkspace>,
    request: RenameNoteRequest,
) -> Result<NoteDocument, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .rename(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_search(
    workspace: State<'_, NativeWorkspace>,
    request: SearchNotesRequest,
) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .search(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
async fn workspace_rebuild_index(
    workspace: State<'_, NativeWorkspace>,
) -> Result<RebuildIndexResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .rebuild_index()
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_history(
    workspace: State<'_, NativeWorkspace>,
    request: VersionHistoryRequest,
) -> Result<VersionHistory, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .version_history(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_save(
    workspace: State<'_, NativeWorkspace>,
    request: SaveVersionRequest,
) -> Result<SaveVersionResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .save_version(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_read(
    workspace: State<'_, NativeWorkspace>,
    request: ReadVersionRequest,
) -> Result<VersionContent, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .read_version(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_checkout(
    workspace: State<'_, NativeWorkspace>,
    request: CheckoutVersionRequest,
) -> Result<VersionHistory, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .checkout_version(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_delete(
    workspace: State<'_, NativeWorkspace>,
    request: DeleteVersionRequest,
) -> Result<DeleteVersionResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .delete_version(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_set_checkpoint(
    workspace: State<'_, NativeWorkspace>,
    request: SetVersionCheckpointRequest,
) -> Result<VersionHistory, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .set_version_checkpoint(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_retention_preview(
    workspace: State<'_, NativeWorkspace>,
    request: PreviewVersionRetentionRequest,
) -> Result<VersionRetentionPreview, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .preview_version_retention(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn version_retention_apply(
    workspace: State<'_, NativeWorkspace>,
    request: ApplyVersionRetentionRequest,
) -> Result<ApplyVersionRetentionResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .apply_version_retention(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
async fn workspace_backup_list(
    workspace: State<'_, NativeWorkspace>,
) -> Result<Vec<WorkspaceBackupSummary>, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .list_workspace_backups()
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_backup_create(
    workspace: State<'_, NativeWorkspace>,
    request: CreateWorkspaceBackupRequest,
) -> Result<CreateWorkspaceBackupResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .create_workspace_backup(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_backup_verify(
    workspace: State<'_, NativeWorkspace>,
    request: VerifyWorkspaceBackupRequest,
) -> Result<VerifyWorkspaceBackupResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .verify_workspace_backup(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_restore_prepare(
    workspace: State<'_, NativeWorkspace>,
    request: PrepareWorkspaceRestoreRequest,
) -> Result<PrepareWorkspaceRestoreResult, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .prepare_workspace_restore(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

fn seed_empty_workspace(
    application: &WorkspaceApplication<FileWorkspace>,
    should_seed: bool,
) -> Result<(), WorkspaceFailure> {
    if !should_seed || !application.snapshot()?.documents.is_empty() {
        return Ok(());
    }

    for (path, markdown) in [
        (
            "learning/welcome.md",
            concat!(
                "# 欢迎来到知织\n\n",
                "把问题、证据、代码、论文、英语和复习组织成可持续修正的知识网络。\n\n",
                "## 下一步\n\n",
                "- [ ] 写下一个可在 45 分钟内回答的问题\n",
                "- [ ] 连接一份可靠来源\n",
                "- [ ] 用自己的话解释并留下证据\n",
            ),
        ),
        (
            "daily/today.md",
            concat!(
                "# 今天的学习计划\n\n",
                "## 唯一目标\n\n",
                "找出一个可以在 45 分钟内回答的问题，并留下证据。\n\n",
                "## 完成条件\n\n",
                "- [ ] 写出问题\n",
                "- [ ] 阅读一份可靠资料\n",
                "- [ ] 用自己的话解释\n",
                "- [ ] 创建一个手动版本\n",
            ),
        ),
        (
            "topics/ownership.md",
            concat!(
                "# Rust 所有权\n\n",
                "## 当前理解\n\n",
                "所有权让资源释放时机在编译期可推理。\n\n",
                "## 待验证\n\n",
                "- [ ] 比较移动、借用与复制\n",
                "- [ ] 为每条结论连接证据\n",
            ),
        ),
        (
            "sources/paper-reading.md",
            "# 论文阅读方法\n\n先记录主张，再记录证据、限制与可复现实验。\n",
        ),
        (
            "experiments/uuid-lab.md",
            concat!(
                "# UUID 交互实验\n\n",
                "```zhiweave-lab\n",
                "{\n",
                "  \"type\": \"uuid\",\n",
                "  \"version\": 1,\n",
                "  \"title\": \"观察 UUID 的结构与版本位\"\n",
                "}\n",
                "```\n",
            ),
        ),
        (
            "review/offline-first.md",
            "# 离线优先复习卡\n\n问题：为什么 Markdown 必须是可移植的事实源？\n",
        ),
    ] {
        let path = PortablePath::new_markdown(path).map_err(|_| WorkspaceFailure::Unavailable)?;
        application.create(&CreateNoteRequest {
            path,
            markdown: markdown.to_owned(),
        })?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Starts the cross-platform application shell.
///
/// # Panics
///
/// Panics when the native runtime cannot initialize or exits unexpectedly.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("workspace");
            let should_seed = !root.join(".zhiweave").join("identity.json").exists();
            let application = WorkspaceApplication::new(FileWorkspace::new(root.clone())?);
            seed_empty_workspace(&application, should_seed)?;
            let watcher = NativeWorkspaceWatcher::start(&root, app.handle().clone())?;
            app.manage(Arc::new(Mutex::new(application)));
            app.manage(watcher);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_status,
            workspace_snapshot,
            workspace_changes,
            note_create,
            note_save,
            note_rename,
            workspace_search,
            workspace_rebuild_index,
            version_history,
            version_save,
            version_read,
            version_checkout,
            version_delete,
            version_set_checkpoint,
            version_retention_preview,
            version_retention_apply,
            workspace_backup_list,
            workspace_backup_create,
            workspace_backup_verify,
            workspace_restore_prepare
        ])
        .run(tauri::generate_context!())
        .expect("ZhiWeave client failed to start");
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    use zhiweave_application::{
        IndexState, SaveNoteRequest, SearchNotesRequest, WorkspaceApplication,
    };
    use zhiweave_storage::FileWorkspace;

    use notify::{
        Error, Event,
        event::{EventKind, Flag},
    };

    use super::{
        is_hidden_workspace_metadata, seed_empty_workspace, watcher_event_requires_rescan,
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zhiweave-client-seed-{}-{nonce}", process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let temp = std::env::temp_dir().canonicalize().unwrap();
            let target = self.0.canonicalize().unwrap_or_else(|_| self.0.clone());
            assert!(target.starts_with(temp));
            assert!(
                target
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("zhiweave-client-seed-"))
            );
            let _ = fs::remove_dir_all(target);
        }
    }

    #[test]
    fn initial_seed_is_complete_and_never_overwrites_existing_markdown() {
        let directory = TestDirectory::new();
        let application = WorkspaceApplication::new(FileWorkspace::new(directory.path()).unwrap());
        seed_empty_workspace(&application, true).unwrap();
        let snapshot = application.snapshot().unwrap();
        assert_eq!(snapshot.documents.len(), 6);
        assert_eq!(snapshot.index.state, IndexState::Ready);
        assert_eq!(snapshot.index.note_count, 6);
        let welcome = snapshot
            .documents
            .into_iter()
            .find(|document| document.path.as_str() == "learning/welcome.md")
            .unwrap();
        let welcome_id = welcome.id;

        application
            .save(&SaveNoteRequest {
                path: welcome.path,
                markdown: "# User content\n".to_owned(),
                expected_revision: welcome.revision,
                line_ending: welcome.line_ending,
                has_utf8_bom: welcome.has_utf8_bom,
            })
            .unwrap();
        seed_empty_workspace(&application, true).unwrap();

        let reloaded = application.snapshot().unwrap();
        assert_eq!(reloaded.documents.len(), 6);
        assert_eq!(
            reloaded
                .documents
                .iter()
                .find(|document| document.path.as_str() == "learning/welcome.md")
                .unwrap()
                .markdown,
            "# User content\n"
        );
        drop(application);

        let reopened = WorkspaceApplication::new(FileWorkspace::new(directory.path()).unwrap());
        let restarted = reopened.snapshot().unwrap();
        assert_eq!(
            restarted
                .documents
                .iter()
                .find(|document| document.path.as_str() == "learning/welcome.md")
                .unwrap()
                .id,
            welcome_id
        );
        assert!(
            reopened
                .search(&SearchNotesRequest {
                    query: "User content".to_owned(),
                    limit: 20,
                })
                .unwrap()
                .iter()
                .any(|result| result.id == welcome_id)
        );
    }

    #[test]
    fn initialized_empty_workspace_is_not_reseeded() {
        let directory = TestDirectory::new();
        let application = WorkspaceApplication::new(FileWorkspace::new(directory.path()).unwrap());

        seed_empty_workspace(&application, false).unwrap();

        assert!(application.snapshot().unwrap().documents.is_empty());
    }

    #[test]
    fn watcher_ignores_only_application_owned_hidden_metadata() {
        let root = PathBuf::from("workspace");
        assert!(is_hidden_workspace_metadata(
            &root,
            &root.join(".zhiweave").join("index.sqlite3")
        ));
        assert!(!is_hidden_workspace_metadata(
            &root,
            &root.join("topics").join("ownership.md")
        ));
        assert!(!is_hidden_workspace_metadata(
            &root,
            &root.join(".other").join("notes.md")
        ));
    }

    #[test]
    fn dropped_or_incomplete_watcher_events_always_request_a_verified_rescan() {
        let root = PathBuf::from("workspace");
        let hidden_event =
            Event::new(EventKind::Any).add_path(root.join(".zhiweave").join("index.sqlite3"));
        let source_event =
            Event::new(EventKind::Any).add_path(root.join("topics").join("ownership.md"));
        let dropped_event = Event::new(EventKind::Any)
            .add_path(root.join(".zhiweave").join("index.sqlite3"))
            .set_flag(Flag::Rescan);

        assert!(!watcher_event_requires_rescan(&root, &Ok(hidden_event)));
        assert!(watcher_event_requires_rescan(&root, &Ok(source_event)));
        assert!(watcher_event_requires_rescan(&root, &Ok(dropped_event)));
        assert!(watcher_event_requires_rescan(
            &root,
            &Err(Error::generic("platform event loss"))
        ));
        assert!(watcher_event_requires_rescan(
            &root,
            &Ok(Event::new(EventKind::Any))
        ));
    }
}
