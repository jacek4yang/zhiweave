use std::sync::{Arc, Mutex};

use tauri::{Manager, State};
use zhiweave_application::{
    CreateNoteRequest, NoteDocument, RebuildIndexResult, RenameNoteRequest, SaveNoteRequest,
    SaveNoteResult, SearchNoteResult, SearchNotesRequest, SystemStatus, WorkspaceApplication,
    WorkspaceFailure, WorkspaceSnapshot,
};
use zhiweave_domain::PortablePath;
use zhiweave_storage::FileWorkspace;

type NativeWorkspace = Arc<Mutex<WorkspaceApplication<FileWorkspace>>>;

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

fn seed_empty_workspace(
    application: &WorkspaceApplication<FileWorkspace>,
) -> Result<(), WorkspaceFailure> {
    if !application.snapshot()?.documents.is_empty() {
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
            let application = WorkspaceApplication::new(FileWorkspace::new(root)?);
            seed_empty_workspace(&application)?;
            app.manage(Arc::new(Mutex::new(application)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_status,
            workspace_snapshot,
            note_create,
            note_save,
            note_rename,
            workspace_search,
            workspace_rebuild_index
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

    use super::seed_empty_workspace;

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
        seed_empty_workspace(&application).unwrap();
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
        seed_empty_workspace(&application).unwrap();

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
}
