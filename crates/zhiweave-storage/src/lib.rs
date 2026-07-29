//! Recoverable local Markdown workspace adapter.

mod backup;
mod history;
mod identity;
mod index;

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use atomic_write_file::AtomicWriteFile;
use sha2::{Digest, Sha256};
use zhiweave_application::{
    ApplyVersionRetentionRequest, ApplyVersionRetentionResult, CheckoutVersionRequest,
    CreateNoteRequest, CreateWorkspaceBackupRequest, CreateWorkspaceBackupResult,
    DeleteVersionRequest, DeleteVersionResult, FileRevision, IndexState, IndexStatus, LineEnding,
    NoteDocument, PrepareWorkspaceRestoreRequest, PrepareWorkspaceRestoreResult,
    PreviewVersionRetentionRequest, ReadVersionRequest, RebuildIndexResult, RenameNoteRequest,
    SaveNoteRequest, SaveNoteResult, SaveVersionRequest, SaveVersionResult, SearchNoteResult,
    SearchNotesRequest, SetVersionCheckpointRequest, VerifyWorkspaceBackupRequest,
    VerifyWorkspaceBackupResult, VersionContent, VersionHistory, VersionHistoryPort,
    VersionHistoryRequest, VersionRetentionPreview, WorkspaceBackupPort, WorkspaceBackupSummary,
    WorkspaceFailure, WorkspacePort, WorkspaceSnapshot,
};
use zhiweave_domain::{NoteId, NoteKind, PortablePath};
use zhiweave_markdown::first_level_one_heading;

use crate::{
    backup::{WorkspaceBackups, apply_pending_restore},
    history::SqliteHistory,
    identity::{IdentityManifest, prepare_metadata_directory},
    index::{INDEX_SCHEMA_VERSION, SqliteIndex},
};

/// Maximum accepted size of one Markdown source.
pub const MAX_NOTE_BYTES: u64 = 16 * 1024 * 1024;
/// Maximum number of Markdown sources in one snapshot.
pub const MAX_NOTE_COUNT: usize = 10_000;
/// Maximum directory depth beneath the workspace root.
pub const MAX_WORKSPACE_DEPTH: usize = 12;

/// Filesystem-backed adapter confined to one canonical workspace root.
pub struct FileWorkspace {
    root: PathBuf,
    root_display: String,
    identity_path: PathBuf,
    index: SqliteIndex,
    history: SqliteHistory,
    backups: WorkspaceBackups,
}

#[derive(Clone)]
struct RawDocument {
    title: String,
    path: PortablePath,
    kind: NoteKind,
    markdown: String,
    revision: FileRevision,
    line_ending: LineEnding,
    has_utf8_bom: bool,
    modified_at_millis: u64,
}

#[derive(Clone)]
pub(crate) struct IndexedDocument {
    id: NoteId,
    title: String,
    path: PortablePath,
    kind: NoteKind,
    markdown: String,
    revision: FileRevision,
    modified_at_millis: u64,
}

impl From<&NoteDocument> for IndexedDocument {
    fn from(document: &NoteDocument) -> Self {
        Self {
            id: document.id,
            title: document.title.clone(),
            path: document.path.clone(),
            kind: document.kind,
            markdown: document.markdown.clone(),
            revision: document.revision.clone(),
            modified_at_millis: document.modified_at_millis,
        }
    }
}

impl FileWorkspace {
    /// Opens or creates a fixed local workspace root.
    ///
    /// # Errors
    ///
    /// Returns a structured I/O failure when the root cannot be created or
    /// canonicalized.
    pub fn new(root: impl AsRef<Path>) -> Result<Self, WorkspaceFailure> {
        let requested = root.as_ref();
        apply_pending_restore(requested)?;
        fs::create_dir_all(requested)
            .map_err(|error| io_failure("createRoot", "workspace", &error))?;
        let metadata = fs::symlink_metadata(requested)
            .map_err(|error| io_failure("inspectRoot", "workspace", &error))?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceFailure::SymbolicLink {
                path: "workspace".to_owned(),
            });
        }
        if !metadata.is_dir() {
            return Err(WorkspaceFailure::Io {
                operation: "inspectRoot".to_owned(),
                path: "workspace".to_owned(),
                kind: "notDirectory".to_owned(),
            });
        }
        let root = requested
            .canonicalize()
            .map_err(|error| io_failure("canonicalizeRoot", "workspace", &error))?;
        let metadata_directory = prepare_metadata_directory(&root)?;
        let backups = WorkspaceBackups::new(&root, &metadata_directory)?;
        Ok(Self {
            root_display: root.display().to_string(),
            root,
            identity_path: metadata_directory.join("identity.json"),
            index: SqliteIndex::new(&metadata_directory),
            history: SqliteHistory::new(&metadata_directory),
            backups,
        })
    }

    fn collect_markdown_paths(&self) -> Result<Vec<PortablePath>, WorkspaceFailure> {
        let mut paths = Vec::new();
        self.collect_directory(&self.root, 0, &mut paths)?;
        paths.sort();
        Ok(paths)
    }

    fn collect_directory(
        &self,
        directory: &Path,
        depth: usize,
        paths: &mut Vec<PortablePath>,
    ) -> Result<(), WorkspaceFailure> {
        if depth > MAX_WORKSPACE_DEPTH {
            return Err(WorkspaceFailure::LimitExceeded {
                limit: format!("directory depth {MAX_WORKSPACE_DEPTH}"),
            });
        }
        let mut entries = fs::read_dir(directory)
            .map_err(|error| io_failure("readDirectory", "workspace", &error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| io_failure("readDirectoryEntry", "workspace", &error))?;
        entries.sort_by_key(fs::DirEntry::file_name);

        for entry in entries {
            let absolute = entry.path();
            let relative_display = self.relative_display(&absolute)?;
            let metadata = fs::symlink_metadata(&absolute)
                .map_err(|error| io_failure("inspectEntry", &relative_display, &error))?;
            if metadata.file_type().is_symlink() {
                return Err(WorkspaceFailure::SymbolicLink {
                    path: relative_display,
                });
            }
            if metadata.is_dir() {
                if entry.file_name() != ".zhiweave" {
                    self.collect_directory(&absolute, depth + 1, paths)?;
                }
                continue;
            }
            if !metadata.is_file()
                || !absolute
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            {
                continue;
            }
            if paths.len() >= MAX_NOTE_COUNT {
                return Err(WorkspaceFailure::LimitExceeded {
                    limit: format!("{MAX_NOTE_COUNT} Markdown files"),
                });
            }
            let path =
                PortablePath::new_markdown(relative_display).map_err(|_| WorkspaceFailure::Io {
                    operation: "validatePath".to_owned(),
                    path: "workspace".to_owned(),
                    kind: "nonPortablePath".to_owned(),
                })?;
            paths.push(path);
        }
        Ok(())
    }

    fn relative_display(&self, absolute: &Path) -> Result<String, WorkspaceFailure> {
        let relative = absolute
            .strip_prefix(&self.root)
            .map_err(|_| WorkspaceFailure::Io {
                operation: "resolvePath".to_owned(),
                path: "workspace".to_owned(),
                kind: "outsideRoot".to_owned(),
            })?;
        let mut components = Vec::new();
        for component in relative.components() {
            let Some(component) = component.as_os_str().to_str() else {
                return Err(WorkspaceFailure::Io {
                    operation: "decodePath".to_owned(),
                    path: "workspace".to_owned(),
                    kind: "nonUtf8Path".to_owned(),
                });
            };
            components.push(component);
        }
        Ok(components.join("/"))
    }

    fn resolve_existing(&self, path: &PortablePath) -> Result<PathBuf, WorkspaceFailure> {
        let mut current = self.root.clone();
        for component in path.as_str().split('/') {
            current.push(component);
            let metadata = fs::symlink_metadata(&current).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    WorkspaceFailure::NotFound {
                        path: path.to_string(),
                    }
                } else {
                    io_failure("inspectPath", path.as_str(), &error)
                }
            })?;
            if metadata.file_type().is_symlink() {
                return Err(WorkspaceFailure::SymbolicLink {
                    path: path.to_string(),
                });
            }
        }
        let canonical = current
            .canonicalize()
            .map_err(|error| io_failure("canonicalizePath", path.as_str(), &error))?;
        if !canonical.starts_with(&self.root) {
            return Err(WorkspaceFailure::Io {
                operation: "resolvePath".to_owned(),
                path: path.to_string(),
                kind: "outsideRoot".to_owned(),
            });
        }
        let metadata = canonical
            .metadata()
            .map_err(|error| io_failure("inspectFile", path.as_str(), &error))?;
        if !metadata.is_file() {
            return Err(WorkspaceFailure::NotFound {
                path: path.to_string(),
            });
        }
        Ok(canonical)
    }

    fn resolve_new(&self, path: &PortablePath) -> Result<PathBuf, WorkspaceFailure> {
        let components = path.as_str().split('/').collect::<Vec<_>>();
        let mut current = self.root.clone();
        for component in &components[..components.len() - 1] {
            current.push(component);
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(WorkspaceFailure::SymbolicLink {
                        path: path.to_string(),
                    });
                }
                Ok(metadata) if !metadata.is_dir() => {
                    return Err(WorkspaceFailure::Io {
                        operation: "createDirectory".to_owned(),
                        path: path.to_string(),
                        kind: "notDirectory".to_owned(),
                    });
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&current)
                        .map_err(|error| io_failure("createDirectory", path.as_str(), &error))?;
                }
                Err(error) => {
                    return Err(io_failure("inspectDirectory", path.as_str(), &error));
                }
            }
        }
        current.push(components[components.len() - 1]);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                Err(WorkspaceFailure::SymbolicLink {
                    path: path.to_string(),
                })
            }
            Ok(_) => Err(WorkspaceFailure::AlreadyExists {
                path: path.to_string(),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(current),
            Err(error) => Err(io_failure("inspectNewFile", path.as_str(), &error)),
        }
    }

    fn read_raw_document(&self, path: &PortablePath) -> Result<RawDocument, WorkspaceFailure> {
        let absolute = self.resolve_existing(path)?;
        let (bytes, modified_at_millis) = read_bounded(&absolute, path)?;
        decode_document(path, &bytes, modified_at_millis)
    }

    fn read_document(&self, path: &PortablePath) -> Result<NoteDocument, WorkspaceFailure> {
        let raw = self.read_raw_document(path)?;
        let mut identities = IdentityManifest::load(&self.identity_path, MAX_NOTE_COUNT)?;
        let (id, changed) = identities.ensure(path, &raw.revision);
        if changed {
            identities.persist(&self.identity_path)?;
        }
        Ok(raw.with_id(id))
    }
}

impl RawDocument {
    fn with_id(self, id: NoteId) -> NoteDocument {
        NoteDocument {
            id,
            title: self.title,
            path: self.path,
            kind: self.kind,
            markdown: self.markdown,
            revision: self.revision,
            line_ending: self.line_ending,
            has_utf8_bom: self.has_utf8_bom,
            modified_at_millis: self.modified_at_millis,
        }
    }
}

impl WorkspacePort for FileWorkspace {
    fn snapshot(&self) -> Result<WorkspaceSnapshot, WorkspaceFailure> {
        let raw_documents = self
            .collect_markdown_paths()?
            .iter()
            .map(|path| self.read_raw_document(path))
            .collect::<Result<Vec<_>, _>>()?;
        let sources = raw_documents
            .iter()
            .map(|document| (document.path.clone(), document.revision.clone()))
            .collect::<Vec<_>>();
        let mut identities = IdentityManifest::load(&self.identity_path, MAX_NOTE_COUNT)?;
        if identities.reconcile(&sources) {
            identities.persist(&self.identity_path)?;
        }
        let documents = raw_documents
            .into_iter()
            .map(|document| {
                let id = identities.id_for(&document.path).ok_or_else(|| {
                    WorkspaceFailure::MetadataCorrupt {
                        kind: "missingReconciledIdentity".to_owned(),
                    }
                })?;
                Ok(document.with_id(id))
            })
            .collect::<Result<Vec<_>, WorkspaceFailure>>()?;
        let indexed = documents
            .iter()
            .map(IndexedDocument::from)
            .collect::<Vec<_>>();
        let index = match self.index.synchronize(&indexed) {
            Ok(status) => status,
            Err(WorkspaceFailure::IndexCorrupt { kind }) => IndexStatus {
                state: IndexState::NeedsRebuild,
                schema_version: 0,
                note_count: 0,
                issue: Some(kind),
            },
            Err(WorkspaceFailure::IndexSchemaTooNew { found, .. }) => IndexStatus {
                state: IndexState::Unavailable,
                schema_version: found,
                note_count: 0,
                issue: Some("schemaTooNew".to_owned()),
            },
            Err(WorkspaceFailure::IndexUnavailable { kind, .. }) => IndexStatus {
                state: IndexState::Unavailable,
                schema_version: 0,
                note_count: 0,
                issue: Some(kind),
            },
            Err(failure) => return Err(failure),
        };
        Ok(WorkspaceSnapshot {
            root_display: self.root_display.clone(),
            documents,
            index,
        })
    }

    fn create(&self, request: &CreateNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
        validate_editor_text(&request.path, &request.markdown, LineEnding::Lf)?;
        let mut identities = IdentityManifest::load(&self.identity_path, MAX_NOTE_COUNT)?;
        let bytes = encode_editor_text(&request.markdown, LineEnding::Lf, false);
        check_size(&request.path, bytes.len() as u64)?;
        let absolute = self.resolve_new(&request.path)?;
        let mut writer = AtomicWriteFile::open(&absolute)
            .map_err(|error| io_failure("beginCreate", request.path.as_str(), &error))?;
        writer
            .write_all(&bytes)
            .map_err(|error| io_failure("writeCreate", request.path.as_str(), &error))?;
        let reservation = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&absolute)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    WorkspaceFailure::AlreadyExists {
                        path: request.path.to_string(),
                    }
                } else {
                    io_failure("reserveCreate", request.path.as_str(), &error)
                }
            })?;
        reservation
            .sync_all()
            .map_err(|error| io_failure("syncCreateReservation", request.path.as_str(), &error))?;
        drop(reservation);
        let (reserved_bytes, _) = read_bounded(&absolute, &request.path)?;
        if !reserved_bytes.is_empty() {
            return Err(conflict(
                &request.path,
                &revision(&[]),
                &revision(&reserved_bytes),
            ));
        }
        writer
            .commit()
            .map_err(|error| io_failure("commitCreate", request.path.as_str(), &error))?;
        let raw = self.read_raw_document(&request.path)?;
        let (id, identity_changed) = identities.ensure(&request.path, &raw.revision);
        if identity_changed {
            identities.persist(&self.identity_path)?;
        }
        let document = raw.with_id(id);
        let _ = self.index.update_one(&IndexedDocument::from(&document));
        Ok(document)
    }

    fn save(&self, request: &SaveNoteRequest) -> Result<SaveNoteResult, WorkspaceFailure> {
        validate_editor_text(&request.path, &request.markdown, request.line_ending)?;
        let mut identities = IdentityManifest::load(&self.identity_path, MAX_NOTE_COUNT)?;
        let absolute = self.resolve_existing(&request.path)?;
        let metadata = absolute
            .metadata()
            .map_err(|error| io_failure("inspectWritable", request.path.as_str(), &error))?;
        if metadata.permissions().readonly() {
            return Err(WorkspaceFailure::Io {
                operation: "beginSave".to_owned(),
                path: request.path.to_string(),
                kind: "permissionDenied".to_owned(),
            });
        }
        let (current_bytes, _) = read_bounded(&absolute, &request.path)?;
        let current_revision = revision(&current_bytes);
        if current_revision != request.expected_revision {
            return Err(conflict(
                &request.path,
                &request.expected_revision,
                &current_revision,
            ));
        }

        let desired_bytes =
            encode_editor_text(&request.markdown, request.line_ending, request.has_utf8_bom);
        check_size(&request.path, desired_bytes.len() as u64)?;
        if desired_bytes == current_bytes {
            let raw = self.read_raw_document(&request.path)?;
            let (id, identity_changed) = identities.ensure(&request.path, &raw.revision);
            if identity_changed {
                identities.persist(&self.identity_path)?;
            }
            let document = raw.with_id(id);
            let index_updated = self
                .index
                .update_one(&IndexedDocument::from(&document))
                .is_ok();
            return Ok(SaveNoteResult {
                document,
                changed: false,
                index_updated,
            });
        }

        let mut writer = AtomicWriteFile::open(&absolute)
            .map_err(|error| io_failure("beginSave", request.path.as_str(), &error))?;
        writer
            .write_all(&desired_bytes)
            .map_err(|error| io_failure("writeSave", request.path.as_str(), &error))?;

        let (before_commit, _) = read_bounded(&absolute, &request.path)?;
        let before_commit_revision = revision(&before_commit);
        if before_commit_revision != current_revision {
            return Err(conflict(
                &request.path,
                &current_revision,
                &before_commit_revision,
            ));
        }
        writer
            .commit()
            .map_err(|error| io_failure("commitSave", request.path.as_str(), &error))?;

        let raw = self.read_raw_document(&request.path)?;
        let (id, identity_changed) = identities.ensure(&request.path, &raw.revision);
        if identity_changed {
            identities.persist(&self.identity_path)?;
        }
        let document = raw.with_id(id);
        let desired_revision = revision(&desired_bytes);
        if document.revision != desired_revision {
            return Err(WorkspaceFailure::Io {
                operation: "verifySave".to_owned(),
                path: request.path.to_string(),
                kind: "contentMismatch".to_owned(),
            });
        }
        let index_updated = self
            .index
            .update_one(&IndexedDocument::from(&document))
            .is_ok();
        Ok(SaveNoteResult {
            document,
            changed: true,
            index_updated,
        })
    }

    fn rename(&self, request: &RenameNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
        if request.path == request.new_path {
            return self.read_document(&request.path);
        }
        let opened = self.read_document(&request.path)?;
        if opened.revision != request.expected_revision {
            return Err(conflict(
                &request.path,
                &request.expected_revision,
                &opened.revision,
            ));
        }
        let source = self.resolve_existing(&request.path)?;
        let destination = self.resolve_new(&request.new_path)?;
        let (source_bytes, _) = read_bounded(&source, &request.path)?;
        let source_revision = revision(&source_bytes);
        if source_revision != request.expected_revision {
            return Err(conflict(
                &request.path,
                &request.expected_revision,
                &source_revision,
            ));
        }

        let mut destination_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    WorkspaceFailure::AlreadyExists {
                        path: request.new_path.to_string(),
                    }
                } else {
                    io_failure("createRenameDestination", request.new_path.as_str(), &error)
                }
            })?;
        destination_file.write_all(&source_bytes).map_err(|error| {
            io_failure("writeRenameDestination", request.new_path.as_str(), &error)
        })?;
        destination_file.sync_all().map_err(|error| {
            io_failure("syncRenameDestination", request.new_path.as_str(), &error)
        })?;
        drop(destination_file);
        let (destination_bytes, _) = read_bounded(&destination, &request.new_path)?;
        if destination_bytes != source_bytes {
            return Err(WorkspaceFailure::Io {
                operation: "verifyRenameDestination".to_owned(),
                path: request.new_path.to_string(),
                kind: "contentMismatch".to_owned(),
            });
        }
        let (before_remove, _) = read_bounded(&source, &request.path)?;
        let before_remove_revision = revision(&before_remove);
        if before_remove_revision != source_revision {
            return Err(conflict(
                &request.path,
                &source_revision,
                &before_remove_revision,
            ));
        }
        fs::remove_file(&source)
            .map_err(|error| io_failure("removeRenameSource", request.path.as_str(), &error))?;

        let mut identities = IdentityManifest::load(&self.identity_path, MAX_NOTE_COUNT)?;
        let id = identities.move_path(&request.path, &request.new_path, &source_revision)?;
        identities.persist(&self.identity_path)?;
        let raw = self.read_raw_document(&request.new_path)?;
        let document = raw.with_id(id);
        let _ = self.index.update_one(&IndexedDocument::from(&document));
        Ok(document)
    }

    fn search(
        &self,
        request: &SearchNotesRequest,
    ) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
        self.index.search(request)
    }

    fn rebuild_index(&self) -> Result<RebuildIndexResult, WorkspaceFailure> {
        let raw_documents = self
            .collect_markdown_paths()?
            .iter()
            .map(|path| self.read_raw_document(path))
            .collect::<Result<Vec<_>, _>>()?;
        let sources = raw_documents
            .iter()
            .map(|document| (document.path.clone(), document.revision.clone()))
            .collect::<Vec<_>>();
        let mut identities = IdentityManifest::load(&self.identity_path, MAX_NOTE_COUNT)?;
        if identities.reconcile(&sources) {
            identities.persist(&self.identity_path)?;
        }
        let documents = raw_documents
            .into_iter()
            .map(|document| {
                let id = identities.id_for(&document.path).ok_or_else(|| {
                    WorkspaceFailure::MetadataCorrupt {
                        kind: "missingReconciledIdentity".to_owned(),
                    }
                })?;
                Ok(document.with_id(id))
            })
            .collect::<Result<Vec<_>, WorkspaceFailure>>()?;
        let indexed = documents
            .iter()
            .map(IndexedDocument::from)
            .collect::<Vec<_>>();
        let preserved_previous_database = self.index.rebuild(&indexed)?;
        Ok(RebuildIndexResult {
            indexed_notes: indexed.len(),
            schema_version: INDEX_SCHEMA_VERSION,
            preserved_previous_database,
        })
    }
}

impl VersionHistoryPort for FileWorkspace {
    fn version_history(
        &self,
        request: &VersionHistoryRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        self.history.history(request)
    }

    fn save_version(
        &self,
        request: &SaveVersionRequest,
    ) -> Result<SaveVersionResult, WorkspaceFailure> {
        self.history.save(request)
    }

    fn read_version(
        &self,
        request: &ReadVersionRequest,
    ) -> Result<VersionContent, WorkspaceFailure> {
        self.history.read(request)
    }

    fn checkout_version(
        &self,
        request: &CheckoutVersionRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        self.history.checkout(request)
    }

    fn delete_version(
        &self,
        request: &DeleteVersionRequest,
    ) -> Result<DeleteVersionResult, WorkspaceFailure> {
        self.history.delete(request)
    }

    fn set_version_checkpoint(
        &self,
        request: &SetVersionCheckpointRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        self.history.set_checkpoint(request)
    }

    fn preview_version_retention(
        &self,
        request: &PreviewVersionRetentionRequest,
    ) -> Result<VersionRetentionPreview, WorkspaceFailure> {
        self.history.preview_retention(request)
    }

    fn apply_version_retention(
        &self,
        request: &ApplyVersionRetentionRequest,
    ) -> Result<ApplyVersionRetentionResult, WorkspaceFailure> {
        self.history.apply_retention(request)
    }
}

impl WorkspaceBackupPort for FileWorkspace {
    fn list_workspace_backups(&self) -> Result<Vec<WorkspaceBackupSummary>, WorkspaceFailure> {
        self.backups.list()
    }

    fn create_workspace_backup(
        &self,
        request: &CreateWorkspaceBackupRequest,
    ) -> Result<CreateWorkspaceBackupResult, WorkspaceFailure> {
        self.backups.create(&self.history, request)
    }

    fn verify_workspace_backup(
        &self,
        request: &VerifyWorkspaceBackupRequest,
    ) -> Result<VerifyWorkspaceBackupResult, WorkspaceFailure> {
        self.backups.verify(request)
    }

    fn prepare_workspace_restore(
        &self,
        request: &PrepareWorkspaceRestoreRequest,
    ) -> Result<PrepareWorkspaceRestoreResult, WorkspaceFailure> {
        self.backups.prepare_restore(&self.history, request)
    }
}

fn read_bounded(absolute: &Path, path: &PortablePath) -> Result<(Vec<u8>, u64), WorkspaceFailure> {
    let metadata = absolute
        .metadata()
        .map_err(|error| io_failure("inspectFile", path.as_str(), &error))?;
    check_size(path, metadata.len())?;
    let modified_at_millis = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        });
    let mut file =
        File::open(absolute).map_err(|error| io_failure("openFile", path.as_str(), &error))?;
    let mut bytes = Vec::with_capacity(
        usize::try_from(metadata.len())
            .unwrap_or(0)
            .min(usize::try_from(MAX_NOTE_BYTES).unwrap_or(usize::MAX)),
    );
    Read::by_ref(&mut file)
        .take(MAX_NOTE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_failure("readFile", path.as_str(), &error))?;
    check_size(path, bytes.len() as u64)?;
    Ok((bytes, modified_at_millis))
}

fn decode_document(
    path: &PortablePath,
    bytes: &[u8],
    modified_at_millis: u64,
) -> Result<RawDocument, WorkspaceFailure> {
    let has_utf8_bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content = if has_utf8_bom { &bytes[3..] } else { bytes };
    let text = std::str::from_utf8(content).map_err(|_| WorkspaceFailure::InvalidUtf8 {
        path: path.to_string(),
    })?;
    let line_ending = detect_line_ending(content);
    let markdown = text.replace("\r\n", "\n").replace('\r', "\n");
    let title = first_level_one_heading(&markdown).unwrap_or_else(|| fallback_title(path));
    Ok(RawDocument {
        title,
        path: path.clone(),
        kind: infer_kind(path),
        markdown,
        revision: revision(bytes),
        line_ending,
        has_utf8_bom,
        modified_at_millis,
    })
}

fn validate_editor_text(
    path: &PortablePath,
    markdown: &str,
    line_ending: LineEnding,
) -> Result<(), WorkspaceFailure> {
    if markdown.contains('\r') {
        return Err(WorkspaceFailure::NonNormalizedEditorText {
            path: path.to_string(),
        });
    }
    if line_ending == LineEnding::Mixed {
        return Err(WorkspaceFailure::MixedLineEndings {
            path: path.to_string(),
        });
    }
    Ok(())
}

fn encode_editor_text(markdown: &str, line_ending: LineEnding, has_utf8_bom: bool) -> Vec<u8> {
    let converted = match line_ending {
        LineEnding::None | LineEnding::Lf | LineEnding::Mixed => markdown.to_owned(),
        LineEnding::Crlf => markdown.replace('\n', "\r\n"),
        LineEnding::Cr => markdown.replace('\n', "\r"),
    };
    let mut bytes = Vec::with_capacity(converted.len() + usize::from(has_utf8_bom) * 3);
    if has_utf8_bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(converted.as_bytes());
    bytes
}

fn detect_line_ending(bytes: &[u8]) -> LineEnding {
    let mut lf = false;
    let mut crlf = false;
    let mut cr = false;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                crlf = true;
                index += 2;
            }
            b'\r' => {
                cr = true;
                index += 1;
            }
            b'\n' => {
                lf = true;
                index += 1;
            }
            _ => index += 1,
        }
    }
    match (lf, crlf, cr) {
        (false, false, false) => LineEnding::None,
        (true, false, false) => LineEnding::Lf,
        (false, true, false) => LineEnding::Crlf,
        (false, false, true) => LineEnding::Cr,
        _ => LineEnding::Mixed,
    }
}

fn revision(bytes: &[u8]) -> FileRevision {
    let digest = Sha256::digest(bytes);
    FileRevision::new(format!("{digest:x}"))
}

fn infer_kind(path: &PortablePath) -> NoteKind {
    match path.as_str().split('/').next().unwrap_or_default() {
        "daily" | "today" | "journal" => NoteKind::Daily,
        "topics" => NoteKind::Topic,
        "nodes" | "learning" => NoteKind::Node,
        "sources" | "inbox" => NoteKind::Source,
        "papers" => NoteKind::Paper,
        "experiments" | "labs" => NoteKind::Experiment,
        "english" => NoteKind::EnglishTerm,
        "review" | "cards" => NoteKind::ReviewCard,
        _ => NoteKind::Note,
    }
}

fn fallback_title(path: &PortablePath) -> String {
    Path::new(path.as_str())
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Untitled")
        .replace(['-', '_'], " ")
}

fn check_size(path: &PortablePath, size: u64) -> Result<(), WorkspaceFailure> {
    if size > MAX_NOTE_BYTES {
        Err(WorkspaceFailure::TooLarge {
            path: path.to_string(),
            limit_bytes: MAX_NOTE_BYTES,
        })
    } else {
        Ok(())
    }
}

fn conflict(
    path: &PortablePath,
    expected: &FileRevision,
    actual: &FileRevision,
) -> WorkspaceFailure {
    WorkspaceFailure::Conflict {
        path: path.to_string(),
        expected: expected.as_str().to_owned(),
        actual: actual.as_str().to_owned(),
    }
}

fn io_failure(operation: &str, path: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::Io {
        operation: operation.to_owned(),
        path: path.to_owned(),
        kind: match error.kind() {
            std::io::ErrorKind::NotFound => "notFound",
            std::io::ErrorKind::PermissionDenied => "permissionDenied",
            std::io::ErrorKind::AlreadyExists => "alreadyExists",
            std::io::ErrorKind::InvalidData | std::io::ErrorKind::InvalidInput => "invalidData",
            std::io::ErrorKind::WriteZero => "writeZero",
            std::io::ErrorKind::StorageFull => "storageFull",
            _ => "other",
        }
        .to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        path::{Path, PathBuf},
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    use zhiweave_application::{
        CreateNoteRequest, IndexState, LineEnding, RenameNoteRequest, SaveNoteRequest,
        SearchNotesRequest, WorkspaceFailure, WorkspacePort,
    };
    use zhiweave_domain::PortablePath;

    use atomic_write_file::AtomicWriteFile;

    use super::{FileWorkspace, MAX_NOTE_BYTES};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zhiweave-storage-{name}-{}-{nonce}", process::id()));
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
                    .is_some_and(|name| name.starts_with("zhiweave-storage-"))
            );
            let _ = fs::remove_dir_all(target);
        }
    }

    fn path(value: &str) -> PortablePath {
        PortablePath::new_markdown(value).unwrap()
    }

    #[test]
    fn create_snapshot_and_idempotent_save_are_consistent() {
        let directory = TestDirectory::new("roundtrip");
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let created = workspace
            .create(&CreateNoteRequest {
                path: path("topics/ownership.md"),
                markdown: "# Ownership\n\nEvidence.\n".to_owned(),
            })
            .unwrap();

        let snapshot = workspace.snapshot().unwrap();
        assert_eq!(
            snapshot.documents.as_slice(),
            std::slice::from_ref(&created)
        );
        let saved = workspace
            .save(&SaveNoteRequest {
                path: created.path.clone(),
                markdown: created.markdown.clone(),
                expected_revision: created.revision,
                line_ending: created.line_ending,
                has_utf8_bom: created.has_utf8_bom,
            })
            .unwrap();
        assert!(!saved.changed);
    }

    #[test]
    fn crlf_and_utf8_bom_survive_an_atomic_edit() {
        let directory = TestDirectory::new("crlf-bom");
        let source = directory.path().join("windows.md");
        fs::write(&source, b"\xef\xbb\xbf# Windows\r\n\r\nBefore\r\n").unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let document = workspace.snapshot().unwrap().documents.remove(0);
        assert_eq!(document.line_ending, LineEnding::Crlf);
        assert!(document.has_utf8_bom);

        workspace
            .save(&SaveNoteRequest {
                path: document.path,
                markdown: "# Windows\n\nAfter\n".to_owned(),
                expected_revision: document.revision,
                line_ending: document.line_ending,
                has_utf8_bom: document.has_utf8_bom,
            })
            .unwrap();

        assert_eq!(
            fs::read(source).unwrap(),
            b"\xef\xbb\xbf# Windows\r\n\r\nAfter\r\n"
        );
    }

    #[test]
    fn external_modification_causes_conflict_without_data_loss() {
        let directory = TestDirectory::new("conflict");
        let source = directory.path().join("conflict.md");
        fs::write(&source, "# Initial\n").unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let document = workspace.snapshot().unwrap().documents.remove(0);
        fs::write(&source, "# External change\n").unwrap();

        let failure = workspace
            .save(&SaveNoteRequest {
                path: document.path,
                markdown: "# Editor change\n".to_owned(),
                expected_revision: document.revision,
                line_ending: LineEnding::Lf,
                has_utf8_bom: false,
            })
            .unwrap_err();

        assert!(matches!(failure, WorkspaceFailure::Conflict { .. }));
        assert_eq!(fs::read_to_string(source).unwrap(), "# External change\n");
    }

    #[test]
    fn duplicate_create_and_invalid_parent_never_overwrite_sources() {
        let directory = TestDirectory::new("safe-create");
        let source = directory.path().join("existing.md");
        fs::write(&source, "# Existing\n").unwrap();
        fs::write(directory.path().join("not-a-directory"), "content").unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();

        assert!(matches!(
            workspace
                .create(&CreateNoteRequest {
                    path: path("existing.md"),
                    markdown: "# Replacement\n".to_owned(),
                })
                .unwrap_err(),
            WorkspaceFailure::AlreadyExists { .. }
        ));
        assert_eq!(fs::read_to_string(&source).unwrap(), "# Existing\n");

        assert!(matches!(
            workspace
                .create(&CreateNoteRequest {
                    path: path("not-a-directory/child.md"),
                    markdown: "# Child\n".to_owned(),
                })
                .unwrap_err(),
            WorkspaceFailure::Io { .. }
        ));
        assert!(!directory.path().join("not-a-directory/child.md").exists());
    }

    #[test]
    fn interrupted_atomic_write_keeps_the_previous_markdown_readable() {
        let directory = TestDirectory::new("interrupted-write");
        let source = directory.path().join("durable.md");
        fs::write(&source, "# Durable\n").unwrap();
        let mut interrupted = AtomicWriteFile::open(&source).unwrap();
        interrupted.write_all(b"# Partial replacement\n").unwrap();
        drop(interrupted);

        assert_eq!(fs::read_to_string(&source).unwrap(), "# Durable\n");
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        assert_eq!(
            workspace.snapshot().unwrap().documents[0].markdown,
            "# Durable\n"
        );
    }

    #[test]
    fn read_only_source_rejects_save_and_preserves_content() {
        let directory = TestDirectory::new("read-only");
        let source = directory.path().join("read-only.md");
        fs::write(&source, "# Read only\n").unwrap();
        let original_permissions = source.metadata().unwrap().permissions();
        let mut read_only_permissions = original_permissions.clone();
        read_only_permissions.set_readonly(true);
        fs::set_permissions(&source, read_only_permissions).unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let document = workspace.snapshot().unwrap().documents.remove(0);

        let failure = workspace
            .save(&SaveNoteRequest {
                path: document.path,
                markdown: "# Replacement\n".to_owned(),
                expected_revision: document.revision,
                line_ending: document.line_ending,
                has_utf8_bom: document.has_utf8_bom,
            })
            .unwrap_err();

        fs::set_permissions(&source, original_permissions).unwrap();
        assert!(matches!(
            failure,
            WorkspaceFailure::Io { kind, .. } if kind == "permissionDenied"
        ));
        assert_eq!(fs::read_to_string(source).unwrap(), "# Read only\n");
    }

    #[test]
    fn invalid_utf8_oversized_and_mixed_sources_fail_closed() {
        let directory = TestDirectory::new("invalid");
        fs::write(directory.path().join("invalid.md"), [0xff, 0xfe]).unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        assert!(matches!(
            workspace.snapshot().unwrap_err(),
            WorkspaceFailure::InvalidUtf8 { .. }
        ));

        fs::remove_file(directory.path().join("invalid.md")).unwrap();
        fs::write(
            directory.path().join("large.md"),
            vec![b'a'; usize::try_from(MAX_NOTE_BYTES).unwrap() + 1],
        )
        .unwrap();
        assert!(matches!(
            workspace.snapshot().unwrap_err(),
            WorkspaceFailure::TooLarge { .. }
        ));

        fs::remove_file(directory.path().join("large.md")).unwrap();
        fs::write(directory.path().join("mixed.md"), "# Mixed\r\none\ntwo\r").unwrap();
        let document = workspace.snapshot().unwrap().documents.remove(0);
        assert_eq!(document.line_ending, LineEnding::Mixed);
        assert!(matches!(
            workspace
                .save(&SaveNoteRequest {
                    path: document.path,
                    markdown: document.markdown,
                    expected_revision: document.revision,
                    line_ending: document.line_ending,
                    has_utf8_bom: false,
                })
                .unwrap_err(),
            WorkspaceFailure::MixedLineEndings { .. }
        ));
    }

    #[test]
    fn hidden_identity_survives_an_unambiguous_external_rename() {
        let directory = TestDirectory::new("rename-identity");
        fs::create_dir(directory.path().join("topics")).unwrap();
        fs::write(
            directory.path().join("topics/before.md"),
            "# Stable node\n\nEvidence.\n",
        )
        .unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let before = workspace.snapshot().unwrap().documents.remove(0);

        fs::rename(
            directory.path().join("topics/before.md"),
            directory.path().join("topics/after.md"),
        )
        .unwrap();
        let after = workspace.snapshot().unwrap().documents.remove(0);

        assert_eq!(after.id, before.id);
        assert_eq!(after.path, path("topics/after.md"));
        assert_eq!(
            fs::read_to_string(directory.path().join("topics/after.md")).unwrap(),
            "# Stable node\n\nEvidence.\n"
        );
        assert!(directory.path().join(".zhiweave/identity.json").is_file());
    }

    #[test]
    fn explicit_rename_preserves_identity_and_never_overwrites_a_destination() {
        let directory = TestDirectory::new("explicit-rename");
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let created = workspace
            .create(&CreateNoteRequest {
                path: path("learning/question.md"),
                markdown: "# Question\n\nEvidence.\n".to_owned(),
            })
            .unwrap();
        let renamed = workspace
            .rename(&RenameNoteRequest {
                path: created.path.clone(),
                new_path: path("topics/answer.md"),
                expected_revision: created.revision.clone(),
            })
            .unwrap();
        assert_eq!(renamed.id, created.id);
        assert_eq!(renamed.path, path("topics/answer.md"));
        assert!(!directory.path().join("learning/question.md").exists());
        assert_eq!(
            fs::read_to_string(directory.path().join("topics/answer.md")).unwrap(),
            created.markdown
        );
        assert_eq!(
            workspace
                .search(&SearchNotesRequest {
                    query: "Evidence".to_owned(),
                    limit: 20,
                })
                .unwrap()[0]
                .path,
            renamed.path
        );

        fs::write(directory.path().join("occupied.md"), "# Existing\n").unwrap();
        assert!(matches!(
            workspace
                .rename(&RenameNoteRequest {
                    path: renamed.path,
                    new_path: path("occupied.md"),
                    expected_revision: renamed.revision,
                })
                .unwrap_err(),
            WorkspaceFailure::AlreadyExists { .. }
        ));
        assert_eq!(
            fs::read_to_string(directory.path().join("occupied.md")).unwrap(),
            "# Existing\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("topics/answer.md")).unwrap(),
            "# Question\n\nEvidence.\n"
        );
    }

    #[test]
    fn ambiguous_identical_sources_never_share_an_identity() {
        let directory = TestDirectory::new("duplicate-identities");
        fs::write(directory.path().join("one.md"), "# Same\n").unwrap();
        fs::write(directory.path().join("two.md"), "# Same\n").unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let snapshot = workspace.snapshot().unwrap();

        assert_eq!(snapshot.documents.len(), 2);
        assert_ne!(snapshot.documents[0].id, snapshot.documents[1].id);
    }

    #[test]
    fn sqlite_search_handles_chinese_short_queries_and_incremental_saves() {
        let directory = TestDirectory::new("search");
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let created = workspace
            .create(&CreateNoteRequest {
                path: path("topics/ownership.md"),
                markdown: "# Rust 所有权\n\n借用让引用保持有效。\n".to_owned(),
            })
            .unwrap();
        let snapshot = workspace.snapshot().unwrap();
        assert_eq!(snapshot.index.state, IndexState::Ready);
        assert_eq!(snapshot.index.note_count, 1);

        let results = workspace
            .search(&SearchNotesRequest {
                query: "所有权".to_owned(),
                limit: 20,
            })
            .unwrap();
        assert_eq!(results[0].id, created.id);
        assert_eq!(results[0].path, created.path);
        assert_eq!(
            workspace
                .search(&SearchNotesRequest {
                    query: "权".to_owned(),
                    limit: 20,
                })
                .unwrap()[0]
                .id,
            created.id
        );

        let saved = workspace
            .save(&SaveNoteRequest {
                path: created.path,
                markdown: "# Rust 所有权\n\n生命周期证明引用有效。\n".to_owned(),
                expected_revision: created.revision,
                line_ending: created.line_ending,
                has_utf8_bom: created.has_utf8_bom,
            })
            .unwrap();
        assert!(saved.index_updated);
        assert!(
            workspace
                .search(&SearchNotesRequest {
                    query: "生命周期".to_owned(),
                    limit: 20,
                })
                .unwrap()
                .iter()
                .any(|result| result.id == saved.document.id)
        );
        assert!(
            workspace
                .search(&SearchNotesRequest {
                    query: "借用让引用".to_owned(),
                    limit: 20,
                })
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn deleting_only_sqlite_rebuilds_derived_data_without_changing_identity() {
        let directory = TestDirectory::new("delete-index");
        fs::write(directory.path().join("durable.md"), "# Durable identity\n").unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let before = workspace.snapshot().unwrap().documents.remove(0);
        remove_index_artifacts(directory.path());

        let after = workspace.snapshot().unwrap();
        assert_eq!(after.index.state, IndexState::Ready);
        assert_eq!(after.documents[0].id, before.id);
        assert_eq!(
            fs::read_to_string(directory.path().join("durable.md")).unwrap(),
            "# Durable identity\n"
        );
    }

    #[test]
    fn corrupt_index_is_not_silently_replaced_and_explicit_rebuild_recovers_search() {
        let directory = TestDirectory::new("corrupt-index");
        fs::write(
            directory.path().join("source.md"),
            "# Recovery\n\n可重建索引。\n",
        )
        .unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        workspace.snapshot().unwrap();
        remove_index_artifacts(directory.path());
        fs::write(
            directory.path().join(".zhiweave/index.sqlite3"),
            b"not a sqlite database",
        )
        .unwrap();

        let degraded = workspace.snapshot().unwrap();
        assert_eq!(degraded.documents.len(), 1);
        assert_eq!(degraded.index.state, IndexState::NeedsRebuild);
        assert!(matches!(
            workspace
                .search(&SearchNotesRequest {
                    query: "可重建".to_owned(),
                    limit: 20,
                })
                .unwrap_err(),
            WorkspaceFailure::IndexCorrupt { .. }
        ));
        assert_eq!(
            fs::read(directory.path().join(".zhiweave/index.sqlite3")).unwrap(),
            b"not a sqlite database"
        );

        let rebuilt = workspace.rebuild_index().unwrap();
        assert_eq!(rebuilt.indexed_notes, 1);
        assert!(rebuilt.preserved_previous_database);
        assert!(
            workspace
                .search(&SearchNotesRequest {
                    query: "可重建".to_owned(),
                    limit: 20,
                })
                .unwrap()
                .iter()
                .any(|result| result.title == "Recovery")
        );
        assert_eq!(
            fs::read(
                directory
                    .path()
                    .join(".zhiweave/recovery/index-before-rebuild-0001.sqlite3")
            )
            .unwrap(),
            b"not a sqlite database"
        );
    }

    #[test]
    fn newer_schema_and_corrupt_identity_fail_closed() {
        let directory = TestDirectory::new("migration-guards");
        fs::write(directory.path().join("note.md"), "# Guarded\n").unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        let guarded = workspace.snapshot().unwrap().documents.remove(0);

        {
            let connection =
                rusqlite::Connection::open(directory.path().join(".zhiweave/index.sqlite3"))
                    .unwrap();
            connection.pragma_update(None, "user_version", 999).unwrap();
        }
        let snapshot = workspace.snapshot().unwrap();
        assert_eq!(snapshot.index.state, IndexState::Unavailable);
        assert_eq!(snapshot.index.schema_version, 999);

        fs::write(
            directory.path().join(".zhiweave/identity.json"),
            br#"{"formatVersion":1,"notes":[{"id":"not-a-uuid"}]}"#,
        )
        .unwrap();
        assert!(matches!(
            workspace.snapshot().unwrap_err(),
            WorkspaceFailure::MetadataCorrupt { .. }
        ));
        assert!(matches!(
            workspace
                .save(&SaveNoteRequest {
                    path: guarded.path,
                    markdown: "# Replacement\n".to_owned(),
                    expected_revision: guarded.revision,
                    line_ending: guarded.line_ending,
                    has_utf8_bom: guarded.has_utf8_bom,
                })
                .unwrap_err(),
            WorkspaceFailure::MetadataCorrupt { .. }
        ));
        assert_eq!(
            fs::read_to_string(directory.path().join("note.md")).unwrap(),
            "# Guarded\n"
        );
        assert!(matches!(
            workspace
                .create(&CreateNoteRequest {
                    path: path("new.md"),
                    markdown: "# New\n".to_owned(),
                })
                .unwrap_err(),
            WorkspaceFailure::MetadataCorrupt { .. }
        ));
        assert!(!directory.path().join("new.md").exists());
        assert!(matches!(
            workspace.rebuild_index().unwrap_err(),
            WorkspaceFailure::MetadataCorrupt { .. }
        ));
    }

    #[test]
    fn search_boundary_rejects_unbounded_or_empty_queries() {
        let directory = TestDirectory::new("search-boundary");
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        workspace.snapshot().unwrap();
        for request in [
            SearchNotesRequest {
                query: " ".to_owned(),
                limit: 20,
            },
            SearchNotesRequest {
                query: "a".repeat(257),
                limit: 20,
            },
            SearchNotesRequest {
                query: "valid".to_owned(),
                limit: 0,
            },
        ] {
            assert!(matches!(
                workspace.search(&request).unwrap_err(),
                WorkspaceFailure::InvalidSearch { .. }
            ));
        }
    }

    fn remove_index_artifacts(root: &Path) {
        for suffix in ["", "-wal", "-shm"] {
            let mut path = root.join(".zhiweave/index.sqlite3").into_os_string();
            path.push(suffix);
            match fs::remove_file(PathBuf::from(path)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => panic!("failed to remove index artifact: {error}"),
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_are_rejected() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("symlink");
        let outside = TestDirectory::new("outside");
        fs::write(outside.path().join("outside.md"), "# Outside\n").unwrap();
        symlink(
            outside.path().join("outside.md"),
            directory.path().join("linked.md"),
        )
        .unwrap();
        let workspace = FileWorkspace::new(directory.path()).unwrap();
        assert!(matches!(
            workspace.snapshot().unwrap_err(),
            WorkspaceFailure::SymbolicLink { .. }
        ));
    }
}
