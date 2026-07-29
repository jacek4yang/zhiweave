use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zhiweave_application::{
    CreateWorkspaceBackupRequest, CreateWorkspaceBackupResult, PrepareWorkspaceRestoreRequest,
    PrepareWorkspaceRestoreResult, VerifyWorkspaceBackupRequest, VerifyWorkspaceBackupResult,
    WorkspaceBackupSummary, WorkspaceFailure,
};

use crate::{
    MAX_NOTE_COUNT,
    history::{SqliteHistory, verify_exported_history},
    identity::IdentityManifest,
};

const BACKUP_FORMAT_VERSION: u32 = 1;
const RESTORE_PLAN_FORMAT_VERSION: u32 = 1;
const BACKUP_DIRECTORY_NAME: &str = "backups";
const BACKUP_SUFFIX: &str = ".zhiweave-backup";
const BACKUP_MANIFEST_NAME: &str = "manifest.json";
const BACKUP_PAYLOAD_NAME: &str = "payload";
const MAX_BACKUP_FILES: usize = 100_000;
const MAX_BACKUP_TOTAL_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_BACKUP_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_BACKUP_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;
const MAX_BACKUP_LABEL_CHARS: usize = 80;
const MAX_BACKUP_DEPTH: usize = 32;
const COPY_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupManifest {
    format_version: u32,
    id: String,
    label: Option<String>,
    created_at_millis: u64,
    total_bytes: u64,
    history_version_count: usize,
    files: Vec<BackupEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupEntry {
    path: String,
    length: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingRestorePlan {
    format_version: u32,
    backup_id: String,
    restore_id: String,
    root_name: String,
    stage_name: String,
    previous_name: String,
}

pub(crate) struct WorkspaceBackups {
    root: PathBuf,
    metadata_directory: PathBuf,
    backups_directory: PathBuf,
}

impl WorkspaceBackups {
    pub(crate) fn new(root: &Path, metadata_directory: &Path) -> Result<Self, WorkspaceFailure> {
        let backups_directory = metadata_directory.join(BACKUP_DIRECTORY_NAME);
        prepare_directory(&backups_directory, "prepareBackupDirectory")?;
        Ok(Self {
            root: root.to_path_buf(),
            metadata_directory: metadata_directory.to_path_buf(),
            backups_directory,
        })
    }

    pub(crate) fn list(&self) -> Result<Vec<WorkspaceBackupSummary>, WorkspaceFailure> {
        let mut backups = Vec::new();
        let entries = fs::read_dir(&self.backups_directory)
            .map_err(|error| backup_io("listBackups", &error))?;
        for entry in entries {
            let entry = entry.map_err(|error| backup_io("readBackupEntry", &error))?;
            let metadata = entry
                .metadata()
                .map_err(|error| backup_io("inspectBackupEntry", &error))?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !name.ends_with(BACKUP_SUFFIX) {
                continue;
            }
            let manifest = read_manifest(&entry.path())?;
            validate_package_directory_name(&name, &manifest.id)?;
            backups.push(summary(&manifest));
        }
        backups.sort_by(|left, right| {
            right
                .created_at_millis
                .cmp(&left.created_at_millis)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(backups)
    }

    pub(crate) fn create(
        &self,
        history: &SqliteHistory,
        request: &CreateWorkspaceBackupRequest,
    ) -> Result<CreateWorkspaceBackupResult, WorkspaceFailure> {
        let label = validate_label(request.label.as_deref())?;
        let id = Uuid::now_v7().to_string();
        let created_at_millis = now_millis()?;
        let staging = self.backups_directory.join(format!(".pending-{id}"));
        let final_directory = self.backup_path(&id)?;
        if staging.exists() || final_directory.exists() {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupIdentityCollision".to_owned(),
            });
        }
        fs::create_dir(&staging).map_err(|error| backup_io("createBackupStaging", &error))?;
        let result =
            self.create_in_staging(history, &staging, id.clone(), label, created_at_millis);
        let manifest = match result {
            Ok(manifest) => manifest,
            Err(failure) => {
                remove_owned_directory(&self.backups_directory, &staging);
                return Err(failure);
            }
        };
        fs::rename(&staging, &final_directory)
            .map_err(|error| backup_io("commitBackupDirectory", &error))?;
        sync_directory(&self.backups_directory, "syncBackupDirectory")?;
        Ok(CreateWorkspaceBackupResult {
            backup: summary(&manifest),
        })
    }

    fn create_in_staging(
        &self,
        history: &SqliteHistory,
        staging: &Path,
        id: String,
        label: Option<String>,
        created_at_millis: u64,
    ) -> Result<BackupManifest, WorkspaceFailure> {
        let identity_path = self.metadata_directory.join("identity.json");
        let identities = IdentityManifest::load(&identity_path, MAX_NOTE_COUNT)?;
        if !identity_path.exists() {
            identities.persist(&identity_path)?;
        }
        let payload = staging.join(BACKUP_PAYLOAD_NAME);
        fs::create_dir(&payload).map_err(|error| backup_io("createBackupPayload", &error))?;
        let sources = collect_workspace_sources(&self.root, &self.metadata_directory)?;
        let mut files = Vec::new();
        let mut total_bytes = 0_u64;
        for source in sources {
            let relative = relative_backup_path(&self.root, &source)?;
            let destination = safe_join(&payload, &relative)?;
            let entry = copy_stable_file(&source, &destination, &relative)?;
            total_bytes = checked_backup_total(total_bytes, entry.length)?;
            files.push(entry);
        }

        let history_relative = ".zhiweave/history.sqlite3".to_owned();
        let history_destination = safe_join(&payload, &history_relative)?;
        create_parent_directories(&history_destination)?;
        let history_version_count = history.export_snapshot(&history_destination)?;
        let history_entry = hash_existing_file(&history_destination, &history_relative)?;
        total_bytes = checked_backup_total(total_bytes, history_entry.length)?;
        files.push(history_entry);
        files.sort();
        if files.len() > MAX_BACKUP_FILES {
            return Err(invalid_backup("tooManyBackupFiles"));
        }
        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            id,
            label,
            created_at_millis,
            total_bytes,
            history_version_count,
            files,
        };
        write_manifest(staging, &manifest)?;
        verify_package(staging, Some(&manifest))?;
        sync_directory(staging, "syncBackupStaging")?;
        Ok(manifest)
    }

    pub(crate) fn verify(
        &self,
        request: &VerifyWorkspaceBackupRequest,
    ) -> Result<VerifyWorkspaceBackupResult, WorkspaceFailure> {
        let directory = self.backup_path(&request.backup_id)?;
        if !directory.exists() {
            return Err(WorkspaceFailure::BackupNotFound {
                backup_id: request.backup_id.clone(),
            });
        }
        let manifest = verify_package(&directory, None)?;
        Ok(VerifyWorkspaceBackupResult {
            verified_files: manifest.files.len(),
            verified_bytes: manifest.total_bytes,
            backup: summary(&manifest),
        })
    }

    pub(crate) fn prepare_restore(
        &self,
        history: &SqliteHistory,
        request: &PrepareWorkspaceRestoreRequest,
    ) -> Result<PrepareWorkspaceRestoreResult, WorkspaceFailure> {
        let selected = self.verify(&VerifyWorkspaceBackupRequest {
            backup_id: request.backup_id.clone(),
        })?;
        let plan_path = restore_plan_path(&self.root)?;
        if plan_path.exists() {
            return Err(invalid_backup("restoreAlreadyPending"));
        }
        let safety = self.create(
            history,
            &CreateWorkspaceBackupRequest {
                label: Some(restore_safety_label(selected.backup.label.as_deref())),
            },
        )?;
        let restore_id = Uuid::now_v7().to_string();
        let parent = self
            .root
            .parent()
            .ok_or_else(|| invalid_backup("workspaceHasNoParent"))?;
        let root_name = self
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| invalid_backup("invalidWorkspaceName"))?
            .to_owned();
        let stage_name = format!(".zhiweave-restore-{restore_id}");
        let previous_name = format!(".zhiweave-previous-{restore_id}");
        let stage = parent.join(&stage_name);
        let previous = parent.join(&previous_name);
        if stage.exists() || previous.exists() {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "restoreIdentityCollision".to_owned(),
            });
        }
        fs::create_dir(&stage).map_err(|error| backup_io("createRestoreStaging", &error))?;
        let prepare_result =
            self.populate_restore_stage(&stage, &request.backup_id, &safety.backup.id);
        if let Err(failure) = prepare_result {
            remove_owned_directory(parent, &stage);
            return Err(failure);
        }
        let plan = PendingRestorePlan {
            format_version: RESTORE_PLAN_FORMAT_VERSION,
            backup_id: request.backup_id.clone(),
            restore_id,
            root_name,
            stage_name,
            previous_name,
        };
        if let Err(failure) = write_restore_plan(&plan_path, &plan) {
            remove_owned_directory(parent, &stage);
            return Err(failure);
        }
        sync_directory(parent, "syncRestorePlanParent")?;
        Ok(PrepareWorkspaceRestoreResult {
            backup: selected.backup,
            safety_backup: safety.backup,
            restart_required: true,
        })
    }

    fn populate_restore_stage(
        &self,
        stage: &Path,
        backup_id: &str,
        safety_backup_id: &str,
    ) -> Result<(), WorkspaceFailure> {
        let selected_directory = self.backup_path(backup_id)?;
        let selected_manifest = verify_package(&selected_directory, None)?;
        let payload = selected_directory.join(BACKUP_PAYLOAD_NAME);
        for entry in &selected_manifest.files {
            let source = safe_join(&payload, &entry.path)?;
            let destination = safe_join(stage, &entry.path)?;
            copy_verified_file(&source, &destination, entry)?;
        }
        verify_restored_workspace(stage, &selected_manifest)?;

        let staged_backups = stage.join(".zhiweave").join(BACKUP_DIRECTORY_NAME);
        prepare_directory(&staged_backups, "prepareRestoredBackups")?;
        for id in [backup_id, safety_backup_id] {
            let source = self.backup_path(id)?;
            let destination = staged_backups.join(format!("{id}{BACKUP_SUFFIX}"));
            copy_directory(&source, &destination, 0)?;
        }
        sync_directory(stage, "syncRestoreStaging")?;
        Ok(())
    }

    fn backup_path(&self, backup_id: &str) -> Result<PathBuf, WorkspaceFailure> {
        validate_uuid(backup_id).map_err(|_| invalid_backup("invalidBackupId"))?;
        Ok(self
            .backups_directory
            .join(format!("{backup_id}{BACKUP_SUFFIX}")))
    }
}

pub(crate) fn apply_pending_restore(root: &Path) -> Result<(), WorkspaceFailure> {
    let plan_path = restore_plan_path(root)?;
    if !plan_path.exists() {
        return Ok(());
    }
    let plan = read_restore_plan(&plan_path)?;
    validate_restore_plan(root, &plan)?;
    let parent = root
        .parent()
        .ok_or_else(|| invalid_backup("workspaceHasNoParent"))?;
    let stage = parent.join(&plan.stage_name);
    let previous = parent.join(&plan.previous_name);

    if !stage.exists() {
        if root.exists() && previous.exists() {
            let manifest_directory = root
                .join(".zhiweave")
                .join(BACKUP_DIRECTORY_NAME)
                .join(format!("{}{BACKUP_SUFFIX}", plan.backup_id));
            let manifest = verify_package(&manifest_directory, None)?;
            verify_restored_workspace(root, &manifest)?;
            fs::remove_file(&plan_path)
                .map_err(|error| backup_io("clearCommittedRestorePlan", &error))?;
            sync_directory(parent, "syncCommittedRestorePlan")?;
            return Ok(());
        }
        if !root.exists() && previous.exists() {
            fs::rename(&previous, root)
                .map_err(|error| backup_io("rollbackIncompleteRestore", &error))?;
            sync_directory(parent, "syncRestoreRollback")?;
        }
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "restoreStageMissing".to_owned(),
        });
    }
    let manifest_directory = stage
        .join(".zhiweave")
        .join(BACKUP_DIRECTORY_NAME)
        .join(format!("{}{BACKUP_SUFFIX}", plan.backup_id));
    let manifest = verify_package(&manifest_directory, None)?;
    verify_restored_workspace(&stage, &manifest)?;

    if root.exists() {
        if previous.exists() {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "ambiguousRestoreDirectories".to_owned(),
            });
        }
        fs::rename(root, &previous)
            .map_err(|error| backup_io("preserveWorkspaceBeforeRestore", &error))?;
        sync_directory(parent, "syncPreservedWorkspace")?;
    }
    fs::rename(&stage, root).map_err(|error| backup_io("activateRestoredWorkspace", &error))?;
    sync_directory(parent, "syncActivatedWorkspace")?;
    verify_restored_workspace(root, &manifest)?;
    fs::remove_file(&plan_path).map_err(|error| backup_io("clearRestorePlan", &error))?;
    sync_directory(parent, "syncClearedRestorePlan")?;
    Ok(())
}

fn collect_workspace_sources(
    root: &Path,
    metadata_directory: &Path,
) -> Result<Vec<PathBuf>, WorkspaceFailure> {
    let mut files = Vec::new();
    collect_regular_files(root, root, metadata_directory, 0, false, &mut files)?;
    files.sort();
    if files.len() > MAX_BACKUP_FILES {
        return Err(invalid_backup("tooManyBackupFiles"));
    }
    Ok(files)
}

fn collect_regular_files(
    root: &Path,
    directory: &Path,
    metadata_directory: &Path,
    depth: usize,
    inside_recovery: bool,
    files: &mut Vec<PathBuf>,
) -> Result<(), WorkspaceFailure> {
    if depth > MAX_BACKUP_DEPTH {
        return Err(invalid_backup("backupDirectoryTooDeep"));
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| backup_io("readBackupSourceDirectory", &error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| backup_io("readBackupSourceEntry", &error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| backup_io("inspectBackupSource", &error))?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceFailure::SymbolicLink {
                path: relative_backup_path(root, &path).unwrap_or_else(|_| "workspace".to_owned()),
            });
        }
        if directory == root && path == metadata_directory {
            collect_regular_files(root, &path, metadata_directory, depth + 1, false, files)?;
            continue;
        }
        if directory == metadata_directory {
            let name = entry.file_name();
            if name == "identity.json" && metadata.is_file() {
                files.push(path);
            } else if name == "recovery" && metadata.is_dir() {
                collect_regular_files(root, &path, metadata_directory, depth + 1, true, files)?;
            }
            continue;
        }
        if metadata.is_dir() {
            collect_regular_files(
                root,
                &path,
                metadata_directory,
                depth + 1,
                inside_recovery,
                files,
            )?;
        } else if metadata.is_file() {
            if inside_recovery || !path.starts_with(metadata_directory) {
                files.push(path);
            }
        } else {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "unsupportedWorkspaceFileType".to_owned(),
            });
        }
        if files.len() > MAX_BACKUP_FILES {
            return Err(invalid_backup("tooManyBackupFiles"));
        }
    }
    Ok(())
}

fn copy_stable_file(
    source: &Path,
    destination: &Path,
    relative: &str,
) -> Result<BackupEntry, WorkspaceFailure> {
    let entry = copy_and_hash(source, destination, relative)?;
    let source_after = hash_existing_file(source, relative)?;
    if source_after.length != entry.length || source_after.sha256 != entry.sha256 {
        return Err(WorkspaceFailure::BackupUnavailable {
            operation: "copyStableWorkspaceFile".to_owned(),
            kind: "sourceChanged".to_owned(),
        });
    }
    Ok(entry)
}

fn copy_verified_file(
    source: &Path,
    destination: &Path,
    expected: &BackupEntry,
) -> Result<(), WorkspaceFailure> {
    let copied = copy_and_hash(source, destination, &expected.path)?;
    if &copied != expected {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupChecksumMismatch".to_owned(),
        });
    }
    Ok(())
}

fn copy_and_hash(
    source: &Path,
    destination: &Path,
    relative: &str,
) -> Result<BackupEntry, WorkspaceFailure> {
    let metadata =
        fs::symlink_metadata(source).map_err(|error| backup_io("inspectBackupFile", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPayloadFileType".to_owned(),
        });
    }
    check_file_size(metadata.len())?;
    create_parent_directories(destination)?;
    let mut reader = File::open(source).map_err(|error| backup_io("openBackupSource", &error))?;
    let mut writer = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| backup_io("createBackupFile", &error))?;
    let mut digest = Sha256::new();
    let mut length = 0_u64;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| backup_io("readBackupFile", &error))?;
        if read == 0 {
            break;
        }
        length = checked_backup_total(
            length,
            u64::try_from(read).map_err(|_| invalid_backup("backupFileTooLarge"))?,
        )?;
        check_file_size(length)?;
        digest.update(&buffer[..read]);
        writer
            .write_all(&buffer[..read])
            .map_err(|error| backup_io("writeBackupFile", &error))?;
    }
    writer
        .sync_all()
        .map_err(|error| backup_io("syncBackupFile", &error))?;
    Ok(BackupEntry {
        path: relative.to_owned(),
        length,
        sha256: hex_digest(digest.finalize()),
    })
}

fn hash_existing_file(path: &Path, relative: &str) -> Result<BackupEntry, WorkspaceFailure> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| backup_io("inspectBackupPayload", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPayloadFileType".to_owned(),
        });
    }
    check_file_size(metadata.len())?;
    let mut file = File::open(path).map_err(|error| backup_io("openBackupPayload", &error))?;
    let mut digest = Sha256::new();
    let mut length = 0_u64;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| backup_io("readBackupPayload", &error))?;
        if read == 0 {
            break;
        }
        length = length
            .checked_add(u64::try_from(read).map_err(|_| invalid_backup("backupFileTooLarge"))?)
            .ok_or_else(|| invalid_backup("backupFileTooLarge"))?;
        check_file_size(length)?;
        digest.update(&buffer[..read]);
    }
    Ok(BackupEntry {
        path: relative.to_owned(),
        length,
        sha256: hex_digest(digest.finalize()),
    })
}

fn verify_package(
    directory: &Path,
    known_manifest: Option<&BackupManifest>,
) -> Result<BackupManifest, WorkspaceFailure> {
    let metadata = fs::symlink_metadata(directory)
        .map_err(|error| backup_io("inspectBackupPackage", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPackageFileType".to_owned(),
        });
    }
    let manifest = match known_manifest {
        Some(manifest) => manifest.clone(),
        None => read_manifest(directory)?,
    };
    validate_manifest(&manifest)?;
    let payload = directory.join(BACKUP_PAYLOAD_NAME);
    let mut actual_paths = Vec::new();
    collect_payload_paths(&payload, &payload, 0, &mut actual_paths)?;
    let expected_paths = manifest
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<BTreeSet<_>>();
    let actual_paths = actual_paths
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if expected_paths != actual_paths {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPayloadSetMismatch".to_owned(),
        });
    }
    let mut total = 0_u64;
    for entry in &manifest.files {
        let path = safe_join(&payload, &entry.path)?;
        let actual = hash_existing_file(&path, &entry.path)?;
        if actual != *entry {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupChecksumMismatch".to_owned(),
            });
        }
        total = checked_backup_total(total, actual.length)?;
    }
    if total != manifest.total_bytes {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupTotalBytesMismatch".to_owned(),
        });
    }
    let history_path = safe_join(&payload, ".zhiweave/history.sqlite3")?;
    let history_versions = verify_exported_history(&history_path)?;
    if history_versions != manifest.history_version_count {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupHistoryCountMismatch".to_owned(),
        });
    }
    Ok(manifest)
}

fn verify_restored_workspace(
    root: &Path,
    manifest: &BackupManifest,
) -> Result<(), WorkspaceFailure> {
    for entry in &manifest.files {
        let path = safe_join(root, &entry.path)?;
        let actual = hash_existing_file(&path, &entry.path)?;
        if actual != *entry {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "restoredWorkspaceChecksumMismatch".to_owned(),
            });
        }
    }
    let history_path = safe_join(root, ".zhiweave/history.sqlite3")?;
    let history_versions = verify_exported_history(&history_path)?;
    if history_versions != manifest.history_version_count {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "restoredHistoryCountMismatch".to_owned(),
        });
    }
    Ok(())
}

fn collect_payload_paths(
    root: &Path,
    directory: &Path,
    depth: usize,
    paths: &mut Vec<String>,
) -> Result<(), WorkspaceFailure> {
    if depth > MAX_BACKUP_DEPTH {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPayloadTooDeep".to_owned(),
        });
    }
    let metadata = fs::symlink_metadata(directory)
        .map_err(|error| backup_io("inspectBackupPayload", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPayloadDirectoryType".to_owned(),
        });
    }
    for entry in fs::read_dir(directory).map_err(|error| backup_io("readBackupPayload", &error))? {
        let entry = entry.map_err(|error| backup_io("readBackupPayloadEntry", &error))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| backup_io("inspectBackupPayloadEntry", &error))?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupPayloadSymlink".to_owned(),
            });
        }
        if metadata.is_dir() {
            collect_payload_paths(root, &path, depth + 1, paths)?;
        } else if metadata.is_file() {
            paths.push(relative_backup_path(root, &path)?);
        } else {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupPayloadFileType".to_owned(),
            });
        }
        if paths.len() > MAX_BACKUP_FILES {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "tooManyBackupPayloadFiles".to_owned(),
            });
        }
    }
    paths.sort();
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path, depth: usize) -> Result<(), WorkspaceFailure> {
    if depth > MAX_BACKUP_DEPTH {
        return Err(invalid_backup("backupDirectoryTooDeep"));
    }
    let metadata =
        fs::symlink_metadata(source).map_err(|error| backup_io("inspectBackupCopy", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupPackageFileType".to_owned(),
        });
    }
    fs::create_dir(destination).map_err(|error| backup_io("createBackupCopyDirectory", &error))?;
    for entry in fs::read_dir(source).map_err(|error| backup_io("readBackupCopy", &error))? {
        let entry = entry.map_err(|error| backup_io("readBackupCopyEntry", &error))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| backup_io("inspectBackupCopyEntry", &error))?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupPackageSymlink".to_owned(),
            });
        }
        if metadata.is_dir() {
            copy_directory(&source_path, &destination_path, depth + 1)?;
        } else if metadata.is_file() {
            let relative = entry.file_name().to_string_lossy().into_owned();
            copy_and_hash(&source_path, &destination_path, &relative)?;
        } else {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupPackageFileType".to_owned(),
            });
        }
    }
    sync_directory(destination, "syncBackupCopyDirectory")
}

fn read_manifest(directory: &Path) -> Result<BackupManifest, WorkspaceFailure> {
    let path = directory.join(BACKUP_MANIFEST_NAME);
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| backup_io("inspectBackupManifest", &error))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_BACKUP_MANIFEST_BYTES
    {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupManifestFileTypeOrSize".to_owned(),
        });
    }
    let bytes = fs::read(path).map_err(|error| backup_io("readBackupManifest", &error))?;
    let manifest = serde_json::from_slice::<BackupManifest>(&bytes).map_err(|_| {
        WorkspaceFailure::BackupCorrupt {
            kind: "invalidBackupManifestJson".to_owned(),
        }
    })?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn write_manifest(directory: &Path, manifest: &BackupManifest) -> Result<(), WorkspaceFailure> {
    let bytes =
        serde_json::to_vec_pretty(manifest).map_err(|_| WorkspaceFailure::BackupCorrupt {
            kind: "serializeBackupManifest".to_owned(),
        })?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_BACKUP_MANIFEST_BYTES {
        return Err(invalid_backup("backupManifestTooLarge"));
    }
    let path = directory.join(BACKUP_MANIFEST_NAME);
    let mut writer =
        AtomicWriteFile::open(&path).map_err(|error| backup_io("beginBackupManifest", &error))?;
    writer
        .write_all(&bytes)
        .map_err(|error| backup_io("writeBackupManifest", &error))?;
    writer
        .commit()
        .map_err(|error| backup_io("commitBackupManifest", &error))
}

fn validate_manifest(manifest: &BackupManifest) -> Result<(), WorkspaceFailure> {
    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "unsupportedBackupFormat".to_owned(),
        });
    }
    validate_uuid(&manifest.id).map_err(|_| WorkspaceFailure::BackupCorrupt {
        kind: "invalidBackupId".to_owned(),
    })?;
    validate_label(manifest.label.as_deref()).map_err(|_| WorkspaceFailure::BackupCorrupt {
        kind: "invalidBackupLabel".to_owned(),
    })?;
    if manifest.created_at_millis == 0
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_BACKUP_FILES
        || manifest.total_bytes > MAX_BACKUP_TOTAL_BYTES
    {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupManifestBounds".to_owned(),
        });
    }
    let mut paths = BTreeSet::new();
    let mut total = 0_u64;
    for entry in &manifest.files {
        validate_relative_backup_path(&entry.path)?;
        if !paths.insert(entry.path.as_str())
            || entry.length > MAX_BACKUP_FILE_BYTES
            || !is_digest(&entry.sha256)
        {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "invalidBackupEntry".to_owned(),
            });
        }
        total = checked_backup_total(total, entry.length)?;
    }
    if total != manifest.total_bytes
        || !paths.contains(".zhiweave/history.sqlite3")
        || !paths.contains(".zhiweave/identity.json")
    {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "incompleteBackupManifest".to_owned(),
        });
    }
    Ok(())
}

fn summary(manifest: &BackupManifest) -> WorkspaceBackupSummary {
    WorkspaceBackupSummary {
        id: manifest.id.clone(),
        label: manifest.label.clone(),
        created_at_millis: manifest.created_at_millis,
        file_count: manifest.files.len(),
        total_bytes: manifest.total_bytes,
        history_version_count: manifest.history_version_count,
        path_display: format!(
            ".zhiweave/{BACKUP_DIRECTORY_NAME}/{}{BACKUP_SUFFIX}",
            manifest.id
        ),
    }
}

fn write_restore_plan(path: &Path, plan: &PendingRestorePlan) -> Result<(), WorkspaceFailure> {
    let bytes = serde_json::to_vec_pretty(plan).map_err(|_| WorkspaceFailure::BackupCorrupt {
        kind: "serializeRestorePlan".to_owned(),
    })?;
    let mut writer =
        AtomicWriteFile::open(path).map_err(|error| backup_io("beginRestorePlan", &error))?;
    writer
        .write_all(&bytes)
        .map_err(|error| backup_io("writeRestorePlan", &error))?;
    writer
        .commit()
        .map_err(|error| backup_io("commitRestorePlan", &error))
}

fn read_restore_plan(path: &Path) -> Result<PendingRestorePlan, WorkspaceFailure> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| backup_io("inspectRestorePlan", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 64 * 1024 {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "restorePlanFileTypeOrSize".to_owned(),
        });
    }
    let bytes = fs::read(path).map_err(|error| backup_io("readRestorePlan", &error))?;
    serde_json::from_slice(&bytes).map_err(|_| WorkspaceFailure::BackupCorrupt {
        kind: "invalidRestorePlanJson".to_owned(),
    })
}

fn validate_restore_plan(root: &Path, plan: &PendingRestorePlan) -> Result<(), WorkspaceFailure> {
    if plan.format_version != RESTORE_PLAN_FORMAT_VERSION {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "unsupportedRestorePlan".to_owned(),
        });
    }
    validate_uuid(&plan.backup_id).map_err(|_| invalid_backup("invalidBackupId"))?;
    validate_uuid(&plan.restore_id).map_err(|_| invalid_backup("invalidRestoreId"))?;
    let root_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_backup("invalidWorkspaceName"))?;
    if plan.root_name != root_name
        || plan.stage_name != format!(".zhiweave-restore-{}", plan.restore_id)
        || plan.previous_name != format!(".zhiweave-previous-{}", plan.restore_id)
    {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "restorePlanPathMismatch".to_owned(),
        });
    }
    Ok(())
}

fn restore_plan_path(root: &Path) -> Result<PathBuf, WorkspaceFailure> {
    let parent = root
        .parent()
        .ok_or_else(|| invalid_backup("workspaceHasNoParent"))?;
    let root_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_backup("invalidWorkspaceName"))?;
    Ok(parent.join(format!(".{root_name}.zhiweave-restore-plan.json")))
}

fn relative_backup_path(root: &Path, path: &Path) -> Result<String, WorkspaceFailure> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| WorkspaceFailure::BackupCorrupt {
            kind: "backupPathOutsideWorkspace".to_owned(),
        })?;
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "invalidBackupPath".to_owned(),
            });
        };
        let value = value
            .to_str()
            .ok_or_else(|| WorkspaceFailure::BackupCorrupt {
                kind: "nonUnicodeBackupPath".to_owned(),
            })?;
        validate_backup_segment(value)?;
        parts.push(value);
    }
    if parts.is_empty() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "emptyBackupPath".to_owned(),
        });
    }
    Ok(parts.join("/"))
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceFailure> {
    validate_relative_backup_path(relative)?;
    let mut path = root.to_path_buf();
    for segment in relative.split('/') {
        path.push(segment);
    }
    Ok(path)
}

fn validate_relative_backup_path(path: &str) -> Result<(), WorkspaceFailure> {
    if path.is_empty() || path.len() > 4096 || path.starts_with('/') || path.ends_with('/') {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "invalidBackupPath".to_owned(),
        });
    }
    for segment in path.split('/') {
        validate_backup_segment(segment)?;
    }
    Ok(())
}

fn validate_backup_segment(segment: &str) -> Result<(), WorkspaceFailure> {
    if segment.is_empty()
        || matches!(segment, "." | "..")
        || segment.contains(['\\', ':', '\0'])
        || segment.chars().any(char::is_control)
    {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "invalidBackupPath".to_owned(),
        });
    }
    Ok(())
}

fn validate_package_directory_name(name: &str, id: &str) -> Result<(), WorkspaceFailure> {
    if name != format!("{id}{BACKUP_SUFFIX}") {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "backupDirectoryNameMismatch".to_owned(),
        });
    }
    Ok(())
}

fn validate_label(label: Option<&str>) -> Result<Option<String>, WorkspaceFailure> {
    let Some(label) = label else {
        return Ok(None);
    };
    let label = label.trim();
    if label.is_empty()
        || label.chars().count() > MAX_BACKUP_LABEL_CHARS
        || label.chars().any(char::is_control)
    {
        return Err(invalid_backup("invalidBackupLabel"));
    }
    Ok(Some(label.to_owned()))
}

fn restore_safety_label(label: Option<&str>) -> String {
    let subject = label
        .unwrap_or("工作区")
        .chars()
        .take(52)
        .collect::<String>();
    format!("恢复“{subject}”前的自动保护")
}

fn validate_uuid(value: &str) -> Result<(), uuid::Error> {
    Uuid::parse_str(value).map(|_| ())
}

fn prepare_directory(path: &Path, operation: &str) -> Result<(), WorkspaceFailure> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "backupDirectoryFileType".to_owned(),
            });
        }
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(backup_io(operation, &error)),
    }
    fs::create_dir_all(path).map_err(|error| backup_io(operation, &error))
}

fn create_parent_directories(path: &Path) -> Result<(), WorkspaceFailure> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid_backup("backupFileHasNoParent"))?;
    fs::create_dir_all(parent).map_err(|error| backup_io("createBackupParent", &error))
}

fn sync_directory(path: &Path, operation: &str) -> Result<(), WorkspaceFailure> {
    match File::open(path).and_then(|directory| directory.sync_all()) {
        Ok(()) => Ok(()),
        // Windows std::fs does not open directories with
        // FILE_FLAG_BACKUP_SEMANTICS. Every payload and manifest file is still
        // individually flushed before the same-volume directory rename.
        Err(error) if cfg!(windows) && error.kind() == std::io::ErrorKind::PermissionDenied => {
            Ok(())
        }
        Err(error) => Err(backup_io(operation, &error)),
    }
}

fn check_file_size(length: u64) -> Result<(), WorkspaceFailure> {
    if length > MAX_BACKUP_FILE_BYTES {
        return Err(invalid_backup("backupFileTooLarge"));
    }
    Ok(())
}

fn checked_backup_total(total: u64, next: u64) -> Result<u64, WorkspaceFailure> {
    let total = total
        .checked_add(next)
        .ok_or_else(|| invalid_backup("backupTooLarge"))?;
    if total > MAX_BACKUP_TOTAL_BYTES {
        return Err(invalid_backup("backupTooLarge"));
    }
    Ok(total)
}

fn now_millis() -> Result<u64, WorkspaceFailure> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid_backup("systemClockBeforeEpoch"))?;
    u64::try_from(duration.as_millis()).map_err(|_| invalid_backup("timestampOutOfRange"))
}

fn hex_digest(digest: impl AsRef<[u8]>) -> String {
    let digest = digest.as_ref();
    let mut value = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(value, "{byte:02x}");
    }
    value
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn remove_owned_directory(parent: &Path, target: &Path) {
    if target.parent() == Some(parent)
        && target
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with(".pending-") || name.starts_with(".zhiweave-restore-")
            })
    {
        let _ = fs::remove_dir_all(target);
    }
}

fn invalid_backup(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::InvalidBackupRequest {
        kind: kind.to_owned(),
    }
}

fn backup_io(operation: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::BackupUnavailable {
        operation: operation.to_owned(),
        kind: match error.kind() {
            std::io::ErrorKind::NotFound => "notFound",
            std::io::ErrorKind::AlreadyExists => "alreadyExists",
            std::io::ErrorKind::PermissionDenied => "permissionDenied",
            std::io::ErrorKind::WriteZero => "diskFull",
            _ => "io",
        }
        .to_owned(),
    }
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
        CreateNoteRequest, CreateWorkspaceBackupRequest, PrepareWorkspaceRestoreRequest,
        SaveNoteRequest, SaveVersionRequest, VerifyWorkspaceBackupRequest, VersionHistoryRequest,
        WorkspaceApplication, WorkspaceFailure,
    };
    use zhiweave_domain::PortablePath;

    use crate::FileWorkspace;

    use super::{BACKUP_SUFFIX, PendingRestorePlan, read_restore_plan, restore_plan_path};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zhiweave-backup-test-{}-{nonce}", process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn root(&self) -> PathBuf {
            self.0.join("workspace")
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
                    .is_some_and(|name| name.starts_with("zhiweave-backup-test-"))
            );
            let _ = fs::remove_dir_all(target);
        }
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn complete_backup_verifies_and_restores_on_next_start_with_safety_copy() {
        let directory = TestDirectory::new();
        let root = directory.root();
        let application =
            WorkspaceApplication::new(FileWorkspace::new(&root).expect("open workspace"));
        let path = PortablePath::new_markdown("learning/evidence.md").unwrap();
        let original = application
            .create(&CreateNoteRequest {
                path: path.clone(),
                markdown: "# Evidence\n\nOriginal source.\n".to_owned(),
            })
            .unwrap();
        fs::create_dir_all(root.join("attachments")).unwrap();
        fs::write(
            root.join("attachments").join("proof.txt"),
            b"portable evidence",
        )
        .unwrap();
        application
            .save_version(&SaveVersionRequest {
                note_id: original.id,
                note_title: original.title.clone(),
                markdown: original.markdown.clone(),
                expected_head: None,
                message: Some("verified baseline".to_owned()),
            })
            .unwrap();
        let backup = application
            .create_workspace_backup(&CreateWorkspaceBackupRequest {
                label: Some("原始工作区".to_owned()),
            })
            .unwrap()
            .backup;
        let verified = application
            .verify_workspace_backup(&VerifyWorkspaceBackupRequest {
                backup_id: backup.id.clone(),
            })
            .unwrap();
        assert_eq!(verified.backup, backup);
        assert_eq!(verified.verified_files, backup.file_count);
        assert_eq!(verified.verified_bytes, backup.total_bytes);
        assert_eq!(backup.history_version_count, 1);

        let changed = application
            .save(&SaveNoteRequest {
                path,
                markdown: "# Evidence\n\nChanged after backup.\n".to_owned(),
                expected_revision: original.revision,
                line_ending: original.line_ending,
                has_utf8_bom: original.has_utf8_bom,
            })
            .unwrap();
        assert!(changed.changed);
        fs::write(
            root.join("attachments").join("proof.txt"),
            b"changed evidence",
        )
        .unwrap();
        let prepared = application
            .prepare_workspace_restore(&PrepareWorkspaceRestoreRequest {
                backup_id: backup.id.clone(),
            })
            .unwrap();
        assert!(prepared.restart_required);
        assert_ne!(prepared.safety_backup.id, backup.id);
        let plan_path = restore_plan_path(&root).unwrap();
        let plan = read_restore_plan(&plan_path).unwrap();
        drop(application);

        let reopened =
            WorkspaceApplication::new(FileWorkspace::new(&root).expect("apply pending restore"));
        let snapshot = reopened.snapshot().unwrap();
        assert_eq!(snapshot.documents.len(), 1);
        assert_eq!(
            snapshot.documents[0].markdown,
            "# Evidence\n\nOriginal source.\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("attachments").join("proof.txt")).unwrap(),
            "portable evidence"
        );
        assert_eq!(
            reopened
                .version_history(&VersionHistoryRequest {
                    note_id: original.id,
                })
                .unwrap()
                .nodes
                .len(),
            1
        );
        let backups = reopened.list_workspace_backups().unwrap();
        assert!(backups.iter().any(|item| item.id == backup.id));
        assert!(
            backups
                .iter()
                .any(|item| item.id == prepared.safety_backup.id)
        );
        assert!(!plan_path.exists());
        let previous = directory.path().join(plan.previous_name);
        assert!(previous.exists());
        assert_eq!(
            fs::read_to_string(previous.join("learning").join("evidence.md")).unwrap(),
            "# Evidence\n\nChanged after backup.\n"
        );
    }

    #[test]
    fn tampered_backup_cannot_be_verified_or_staged_for_restore() {
        let directory = TestDirectory::new();
        let root = directory.root();
        let application =
            WorkspaceApplication::new(FileWorkspace::new(&root).expect("open workspace"));
        application
            .create(&CreateNoteRequest {
                path: PortablePath::new_markdown("note.md").unwrap(),
                markdown: "# Trusted\n".to_owned(),
            })
            .unwrap();
        let backup = application
            .create_workspace_backup(&CreateWorkspaceBackupRequest { label: None })
            .unwrap()
            .backup;
        let package = root
            .join(".zhiweave")
            .join("backups")
            .join(format!("{}{BACKUP_SUFFIX}", backup.id));
        fs::write(
            package.join("payload").join("note.md"),
            b"# Tampered after export\n",
        )
        .unwrap();

        assert!(matches!(
            application.verify_workspace_backup(&VerifyWorkspaceBackupRequest {
                backup_id: backup.id.clone(),
            }),
            Err(WorkspaceFailure::BackupCorrupt { .. })
        ));
        assert!(matches!(
            application.prepare_workspace_restore(&PrepareWorkspaceRestoreRequest {
                backup_id: backup.id,
            }),
            Err(WorkspaceFailure::BackupCorrupt { .. })
        ));
        assert!(!restore_plan_path(&root).unwrap().exists());
    }

    #[test]
    fn interrupted_directory_swap_finishes_from_the_external_restore_plan() {
        let directory = TestDirectory::new();
        let root = directory.root();
        let application =
            WorkspaceApplication::new(FileWorkspace::new(&root).expect("open workspace"));
        application
            .create(&CreateNoteRequest {
                path: PortablePath::new_markdown("note.md").unwrap(),
                markdown: "# Before\n".to_owned(),
            })
            .unwrap();
        let backup = application
            .create_workspace_backup(&CreateWorkspaceBackupRequest { label: None })
            .unwrap()
            .backup;
        application
            .prepare_workspace_restore(&PrepareWorkspaceRestoreRequest {
                backup_id: backup.id,
            })
            .unwrap();
        let plan = read_restore_plan(&restore_plan_path(&root).unwrap()).unwrap();
        drop(application);

        let previous = directory.path().join(&plan.previous_name);
        fs::rename(&root, &previous).unwrap();
        assert!(!root.exists());
        let reopened =
            WorkspaceApplication::new(FileWorkspace::new(&root).expect("finish interrupted swap"));
        assert_eq!(reopened.snapshot().unwrap().documents.len(), 1);
        assert!(!restore_plan_path(&root).unwrap().exists());
        assert!(previous.exists());
    }

    #[test]
    fn restore_plan_paths_are_bound_to_the_exact_workspace_name() {
        let directory = TestDirectory::new();
        let root = directory.root();
        fs::create_dir(&root).unwrap();
        let plan = PendingRestorePlan {
            format_version: 1,
            backup_id: uuid::Uuid::now_v7().to_string(),
            restore_id: uuid::Uuid::now_v7().to_string(),
            root_name: "another-workspace".to_owned(),
            stage_name: ".zhiweave-restore-invalid".to_owned(),
            previous_name: ".zhiweave-previous-invalid".to_owned(),
        };
        let plan_path = restore_plan_path(&root).unwrap();
        fs::write(&plan_path, serde_json::to_vec(&plan).unwrap()).unwrap();
        assert!(matches!(
            FileWorkspace::new(&root),
            Err(WorkspaceFailure::BackupCorrupt { .. }
                | WorkspaceFailure::InvalidBackupRequest { .. })
        ));
        assert!(root.exists());
    }
}
