use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Component, Path},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, RecvTimeoutError},
    },
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zhiweave_application::{
    ApplyVersionRetentionRequest, ApplyVersionRetentionResult, AttachmentImportPresentation,
    AttachmentImportProposal, AttachmentMediaType, AttachmentResolution, AttachmentResolutionState,
    BacklinkReference, BacklinksRequest, CheckoutVersionRequest, CreateNoteRequest,
    CreateWikiTargetRequest, CreateWorkspaceBackupRequest, CreateWorkspaceBackupResult,
    DeleteVersionRequest, DeleteVersionResult, DetectWorkspaceChangesRequest,
    ImportAttachmentRequest, MAX_ATTACHMENT_IMPORT_BYTES, NoteDocument,
    PrepareWorkspaceRestoreRequest, PrepareWorkspaceRestoreResult, PreviewVersionRetentionRequest,
    ProposeAttachmentImportRequest, ReadVersionRequest, RebuildIndexResult, RenameNoteRequest,
    ResolveAttachmentRequest, ResolveWikiTargetRequest, SaveNoteRequest, SaveNoteResult,
    SaveVersionRequest, SaveVersionResult, SearchNoteResult, SearchNotesRequest,
    SetVersionCheckpointRequest, SystemStatus, VerifyWorkspaceBackupRequest,
    VerifyWorkspaceBackupResult, VersionContent, VersionHistory, VersionHistoryRequest,
    VersionRetentionPreview, WikiTargetResolution, WorkspaceApplication, WorkspaceBackupSummary,
    WorkspaceChangesResult, WorkspaceFailure, WorkspaceSnapshot,
};
use zhiweave_domain::{NoteId, PortablePath, PortableResourcePath};
use zhiweave_storage::FileWorkspace;

type NativeWorkspace = Arc<Mutex<WorkspaceApplication<FileWorkspace>>>;
type NativePendingAttachmentImports = Arc<Mutex<PendingAttachmentImports>>;

const WORKSPACE_CHANGED_EVENT: &str = "workspace-files-changed";
const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);
const PENDING_ATTACHMENT_IMPORT_TTL: Duration = Duration::from_mins(10);
const MAX_PENDING_ATTACHMENT_IMPORTS: usize = 8;
const MAX_PENDING_ATTACHMENT_IMPORT_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeAttachmentPreview {
    raw_target: String,
    recognized_attachment: bool,
    state: AttachmentResolutionState,
    path: Option<PortableResourcePath>,
    media_type: Option<AttachmentMediaType>,
    mime_type: Option<String>,
    byte_length: Option<u64>,
    content_sha256: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    data_url: Option<String>,
}

impl From<AttachmentResolution> for NativeAttachmentPreview {
    fn from(resolution: AttachmentResolution) -> Self {
        let mut preview = Self {
            raw_target: resolution.raw_target,
            recognized_attachment: resolution.recognized_attachment,
            state: resolution.state,
            path: None,
            media_type: None,
            mime_type: None,
            byte_length: None,
            content_sha256: None,
            width: None,
            height: None,
            data_url: None,
        };
        if let Some(content) = resolution.content {
            let mime_type = content.media_type.mime_type();
            preview.path = Some(content.path);
            preview.media_type = Some(content.media_type);
            preview.mime_type = Some(mime_type.to_owned());
            preview.byte_length = Some(content.byte_length);
            preview.content_sha256 = Some(content.content_sha256);
            preview.width = Some(content.width);
            preview.height = Some(content.height);
            preview.data_url = Some(format!(
                "data:{mime_type};base64,{}",
                STANDARD.encode(content.bytes)
            ));
        }
        preview
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeAttachmentImportProposal {
    token: String,
    source_note_id: NoteId,
    original_file_name: String,
    path: PortableResourcePath,
    markdown_reference: String,
    presentation: AttachmentImportPresentation,
    byte_length: u64,
    content_sha256: String,
}

impl NativeAttachmentImportProposal {
    fn from_proposal(token: String, proposal: &AttachmentImportProposal) -> Self {
        Self {
            token,
            source_note_id: proposal.source_note_id,
            original_file_name: proposal.original_file_name.clone(),
            path: proposal.path.clone(),
            markdown_reference: proposal.markdown_reference.clone(),
            presentation: proposal.presentation,
            byte_length: proposal.byte_length,
            content_sha256: proposal.content_sha256.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickAttachmentImportRequest {
    source_note_id: NoteId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmAttachmentImportRequest {
    token: String,
}

struct PendingAttachmentImport {
    proposal: AttachmentImportProposal,
    bytes: Vec<u8>,
    created_at: Instant,
}

#[derive(Default)]
struct PendingAttachmentImports {
    entries: HashMap<String, PendingAttachmentImport>,
}

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
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_backlinks(
    workspace: State<'_, NativeWorkspace>,
    request: BacklinksRequest,
) -> Result<Vec<BacklinkReference>, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .backlinks(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_resolve_wiki_target(
    workspace: State<'_, NativeWorkspace>,
    request: ResolveWikiTargetRequest,
) -> Result<WikiTargetResolution, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .resolve_wiki_target(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_create_wiki_target(
    workspace: State<'_, NativeWorkspace>,
    request: CreateWikiTargetRequest,
) -> Result<NoteDocument, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .create_wiki_target(&request)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_resolve_attachment(
    workspace: State<'_, NativeWorkspace>,
    request: ResolveAttachmentRequest,
) -> Result<NativeAttachmentPreview, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    tauri::async_runtime::spawn_blocking(move || {
        workspace
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?
            .resolve_attachment(&request)
            .map(NativeAttachmentPreview::from)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_pick_attachment_import(
    window: tauri::WebviewWindow,
    workspace: State<'_, NativeWorkspace>,
    pending_imports: State<'_, NativePendingAttachmentImports>,
    request: PickAttachmentImportRequest,
) -> Result<Option<NativeAttachmentImportProposal>, WorkspaceFailure> {
    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("选择要导入知织工作区的附件")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| invalid_attachment_import("unsupportedPickerResource"))?;
    let workspace = Arc::clone(workspace.inner());
    let pending_imports = Arc::clone(pending_imports.inner());
    tauri::async_runtime::spawn_blocking(move || {
        prepare_pending_attachment_import(
            &workspace,
            &pending_imports,
            request.source_note_id,
            &selected,
        )
        .map(Some)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_confirm_attachment_import(
    workspace: State<'_, NativeWorkspace>,
    pending_imports: State<'_, NativePendingAttachmentImports>,
    request: ConfirmAttachmentImportRequest,
) -> Result<AttachmentImportProposal, WorkspaceFailure> {
    let workspace = Arc::clone(workspace.inner());
    let pending_imports = Arc::clone(pending_imports.inner());
    tauri::async_runtime::spawn_blocking(move || {
        commit_pending_attachment_import(&workspace, &pending_imports, &request.token)
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri command extractors are ABI values.
async fn workspace_cancel_attachment_import(
    pending_imports: State<'_, NativePendingAttachmentImports>,
    request: ConfirmAttachmentImportRequest,
) -> Result<bool, WorkspaceFailure> {
    let pending_imports = Arc::clone(pending_imports.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut pending = pending_imports
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?;
        purge_expired_imports(&mut pending);
        Ok(pending.entries.remove(&request.token).is_some())
    })
    .await
    .map_err(|_| WorkspaceFailure::Unavailable)?
}

fn prepare_pending_attachment_import(
    workspace: &NativeWorkspace,
    pending_imports: &NativePendingAttachmentImports,
    source_note_id: NoteId,
    selected: &Path,
) -> Result<NativeAttachmentImportProposal, WorkspaceFailure> {
    let (original_file_name, bytes) = read_selected_attachment(selected)?;
    let import_request = ProposeAttachmentImportRequest {
        source_note_id,
        original_file_name,
        bytes,
    };
    let proposal = workspace
        .lock()
        .map_err(|_| WorkspaceFailure::Unavailable)?
        .propose_attachment_import(&import_request)?;
    let token = Uuid::now_v7().to_string();
    let native = NativeAttachmentImportProposal::from_proposal(token.clone(), &proposal);
    let mut pending = pending_imports
        .lock()
        .map_err(|_| WorkspaceFailure::Unavailable)?;
    purge_expired_imports(&mut pending);
    if pending.entries.len() >= MAX_PENDING_ATTACHMENT_IMPORTS {
        return Err(WorkspaceFailure::LimitExceeded {
            limit: format!("pending attachment imports {MAX_PENDING_ATTACHMENT_IMPORTS}"),
        });
    }
    let pending_bytes = pending.entries.values().fold(0_u64, |total, entry| {
        total.saturating_add(entry.proposal.byte_length)
    });
    if pending_bytes.saturating_add(proposal.byte_length) > MAX_PENDING_ATTACHMENT_IMPORT_BYTES {
        return Err(WorkspaceFailure::LimitExceeded {
            limit: format!("pending attachment import bytes {MAX_PENDING_ATTACHMENT_IMPORT_BYTES}"),
        });
    }
    pending.entries.insert(
        token,
        PendingAttachmentImport {
            proposal,
            bytes: import_request.bytes,
            created_at: Instant::now(),
        },
    );
    Ok(native)
}

fn commit_pending_attachment_import(
    workspace: &NativeWorkspace,
    pending_imports: &NativePendingAttachmentImports,
    token: &str,
) -> Result<AttachmentImportProposal, WorkspaceFailure> {
    if Uuid::parse_str(token).is_err() {
        return Err(invalid_attachment_import("invalidPendingToken"));
    }
    let pending = {
        let mut imports = pending_imports
            .lock()
            .map_err(|_| WorkspaceFailure::Unavailable)?;
        purge_expired_imports(&mut imports);
        imports
            .entries
            .remove(token)
            .ok_or_else(|| invalid_attachment_import("unknownOrExpiredPendingToken"))?
    };
    workspace
        .lock()
        .map_err(|_| WorkspaceFailure::Unavailable)?
        .import_attachment(&ImportAttachmentRequest {
            source_note_id: pending.proposal.source_note_id,
            original_file_name: pending.proposal.original_file_name,
            expected_path: pending.proposal.path,
            expected_markdown_reference: pending.proposal.markdown_reference,
            expected_presentation: pending.proposal.presentation,
            expected_byte_length: pending.proposal.byte_length,
            expected_content_sha256: pending.proposal.content_sha256,
            bytes: pending.bytes,
        })
}

fn read_selected_attachment(selected: &Path) -> Result<(String, Vec<u8>), WorkspaceFailure> {
    let original_file_name = selected
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_attachment_import("invalidSelectedFileName"))?
        .to_owned();
    let metadata = fs::symlink_metadata(selected)
        .map_err(|error| external_io_failure("inspectSelectedAttachment", &error))?;
    if is_selected_file_indirection(&metadata) {
        return Err(invalid_attachment_import("selectedSymbolicLink"));
    }
    if !metadata.is_file() {
        return Err(invalid_attachment_import("selectedResourceNotFile"));
    }
    if metadata.len() > MAX_ATTACHMENT_IMPORT_BYTES {
        return Err(WorkspaceFailure::LimitExceeded {
            limit: format!("attachment import bytes {MAX_ATTACHMENT_IMPORT_BYTES}"),
        });
    }
    let file = open_selected_file(selected)
        .map_err(|error| external_io_failure("openSelectedAttachment", &error))?;
    let opened_metadata = file
        .metadata()
        .map_err(|error| external_io_failure("inspectOpenedAttachment", &error))?;
    if is_selected_file_indirection(&opened_metadata) {
        return Err(invalid_attachment_import("selectedSymbolicLink"));
    }
    if !opened_metadata.is_file() {
        return Err(invalid_attachment_import("selectedResourceNotFile"));
    }
    if opened_metadata.len() > MAX_ATTACHMENT_IMPORT_BYTES {
        return Err(WorkspaceFailure::LimitExceeded {
            limit: format!("attachment import bytes {MAX_ATTACHMENT_IMPORT_BYTES}"),
        });
    }
    let mut bytes = Vec::with_capacity(
        usize::try_from(opened_metadata.len().min(MAX_ATTACHMENT_IMPORT_BYTES)).unwrap_or(0),
    );
    file.take(MAX_ATTACHMENT_IMPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| external_io_failure("readSelectedAttachment", &error))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ATTACHMENT_IMPORT_BYTES {
        return Err(WorkspaceFailure::LimitExceeded {
            limit: format!("attachment import bytes {MAX_ATTACHMENT_IMPORT_BYTES}"),
        });
    }
    Ok((original_file_name, bytes))
}

#[cfg(windows)]
fn open_selected_file(selected: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;

    // Prevent a picker path from following a reparse point introduced between
    // the metadata check and the open. The opened handle is checked again.
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(selected)
}

#[cfg(not(windows))]
fn open_selected_file(selected: &Path) -> std::io::Result<File> {
    File::open(selected)
}

#[cfg(windows)]
fn is_selected_file_indirection(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_selected_file_indirection(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn purge_expired_imports(imports: &mut PendingAttachmentImports) {
    imports
        .entries
        .retain(|_, pending| pending.created_at.elapsed() <= PENDING_ATTACHMENT_IMPORT_TTL);
}

fn invalid_attachment_import(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::InvalidAttachmentImport {
        kind: kind.to_owned(),
    }
}

fn external_io_failure(operation: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::Io {
        operation: operation.to_owned(),
        path: "selectedAttachment".to_owned(),
        kind: match error.kind() {
            std::io::ErrorKind::NotFound => "notFound",
            std::io::ErrorKind::PermissionDenied => "permissionDenied",
            std::io::ErrorKind::InvalidData | std::io::ErrorKind::InvalidInput => "invalidData",
            _ => "other",
        }
        .to_owned(),
    }
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
                "- [ ] 连接一份可靠来源，例如 [[Rust 所有权]]\n",
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("workspace");
            let should_seed = !root.join(".zhiweave").join("identity.json").exists();
            let application = WorkspaceApplication::new(FileWorkspace::new(root.clone())?);
            seed_empty_workspace(&application, should_seed)?;
            let watcher = NativeWorkspaceWatcher::start(&root, app.handle().clone())?;
            app.manage(Arc::new(Mutex::new(application)));
            app.manage(Arc::new(Mutex::new(PendingAttachmentImports::default())));
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
            workspace_backlinks,
            workspace_resolve_wiki_target,
            workspace_create_wiki_target,
            workspace_resolve_attachment,
            workspace_pick_attachment_import,
            workspace_confirm_attachment_import,
            workspace_cancel_attachment_import,
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
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    use zhiweave_application::{
        AttachmentReferenceKind, AttachmentResolutionState, BacklinksRequest, CreateNoteRequest,
        CreateWikiTargetRequest, IndexState, ResolveAttachmentRequest, ResolveWikiTargetRequest,
        SaveNoteRequest, SearchNotesRequest, WikiTargetResolutionState, WorkspaceApplication,
    };
    use zhiweave_domain::PortablePath;
    use zhiweave_storage::FileWorkspace;

    use notify::{
        Error, Event,
        event::{EventKind, Flag},
    };

    use super::{
        NativeAttachmentPreview, PendingAttachmentImports, commit_pending_attachment_import,
        is_hidden_workspace_metadata, prepare_pending_attachment_import, seed_empty_workspace,
        watcher_event_requires_rescan,
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
        let ownership_id = snapshot
            .documents
            .iter()
            .find(|document| document.path.as_str() == "topics/ownership.md")
            .unwrap()
            .id;
        let welcome = snapshot
            .documents
            .into_iter()
            .find(|document| document.path.as_str() == "learning/welcome.md")
            .unwrap();
        let welcome_id = welcome.id;
        let backlinks = application
            .backlinks(&BacklinksRequest {
                note_id: ownership_id,
                limit: 20,
            })
            .unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_note_id, welcome_id);
        let forward = application
            .resolve_wiki_target(&ResolveWikiTargetRequest {
                source_note_id: welcome_id,
                raw_target: "Rust 所有权".to_owned(),
            })
            .unwrap();
        assert_eq!(forward.state, WikiTargetResolutionState::Resolved);
        assert_eq!(forward.target.unwrap().id, ownership_id);

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
    fn native_boundary_creates_confirmed_wiki_targets_and_transports_inert_images() {
        let directory = TestDirectory::new();
        fs::create_dir(directory.path().join("learning")).unwrap();
        fs::create_dir(directory.path().join("attachments")).unwrap();
        let application = WorkspaceApplication::new(FileWorkspace::new(directory.path()).unwrap());
        let source = application
            .create(&CreateNoteRequest {
                path: PortablePath::new_markdown("learning/source.md").unwrap(),
                markdown: "# Source\n".to_owned(),
            })
            .unwrap();
        let resolution = application
            .resolve_wiki_target(&ResolveWikiTargetRequest {
                source_note_id: source.id,
                raw_target: "UUID 结构#版本位".to_owned(),
            })
            .unwrap();
        let proposal = resolution.creation.unwrap();
        let created = application
            .create_wiki_target(&CreateWikiTargetRequest {
                source_note_id: source.id,
                raw_target: "UUID 结构#版本位".to_owned(),
                expected_path: proposal.path.clone(),
            })
            .unwrap();
        assert_eq!(created.path, proposal.path);
        assert_eq!(created.markdown, "# UUID 结构\n\n## 版本位\n");

        let mut png = vec![0; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&32_u32.to_be_bytes());
        png[20..24].copy_from_slice(&16_u32.to_be_bytes());
        fs::write(directory.path().join("attachments/uuid.png"), &png).unwrap();
        let preview = NativeAttachmentPreview::from(
            application
                .resolve_attachment(&ResolveAttachmentRequest {
                    source_note_id: source.id,
                    raw_target: "../attachments/uuid.png".to_owned(),
                    reference_kind: AttachmentReferenceKind::MarkdownImage,
                })
                .unwrap(),
        );
        assert_eq!(preview.state, AttachmentResolutionState::Resolved);
        assert_eq!(preview.path.unwrap().as_str(), "attachments/uuid.png");
        assert_eq!(preview.mime_type.as_deref(), Some("image/png"));
        assert_eq!(preview.byte_length, Some(24));
        assert_eq!((preview.width, preview.height), (Some(32), Some(16)));
        assert_eq!(
            preview.data_url.as_deref(),
            Some("data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAACAAAAAQ")
        );
    }

    #[test]
    fn native_attachment_import_tokens_hide_paths_and_are_one_shot() {
        let directory = TestDirectory::new();
        let workspace_root = directory.path().join("workspace");
        let application = WorkspaceApplication::new(FileWorkspace::new(&workspace_root).unwrap());
        let source = application
            .create(&CreateNoteRequest {
                path: PortablePath::new_markdown("learning/source.md").unwrap(),
                markdown: "# Source\n".to_owned(),
            })
            .unwrap();
        let selected = directory.path().join("Original proof.PDF");
        fs::write(&selected, b"original-pdf-bytes").unwrap();
        let workspace = Arc::new(Mutex::new(application));
        let pending = Arc::new(Mutex::new(PendingAttachmentImports::default()));

        let proposal =
            prepare_pending_attachment_import(&workspace, &pending, source.id, &selected).unwrap();
        assert_eq!(proposal.original_file_name, "Original proof.PDF");
        assert_eq!(proposal.path.as_str(), "attachments/Original-proof.pdf");
        assert_eq!(
            proposal.markdown_reference,
            "![[attachments/Original-proof.pdf]]"
        );
        assert!(!format!("{proposal:?}").contains(directory.path().to_str().unwrap()));
        assert!(!workspace_root.join(proposal.path.as_str()).exists());

        let imported =
            commit_pending_attachment_import(&workspace, &pending, &proposal.token).unwrap();
        assert_eq!(imported.path, proposal.path);
        assert_eq!(
            fs::read(workspace_root.join(imported.path.as_str())).unwrap(),
            b"original-pdf-bytes"
        );
        assert!(commit_pending_attachment_import(&workspace, &pending, &proposal.token).is_err());
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
