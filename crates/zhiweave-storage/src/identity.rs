use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use zhiweave_application::{FileRevision, WorkspaceFailure};
use zhiweave_domain::{NoteId, PortablePath};

const IDENTITY_FORMAT_VERSION: u32 = 1;
const MAX_IDENTITY_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityEntry {
    id: NoteId,
    path: PortablePath,
    revision: FileRevision,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityManifest {
    format_version: u32,
    notes: Vec<IdentityEntry>,
}

impl Default for IdentityManifest {
    fn default() -> Self {
        Self {
            format_version: IDENTITY_FORMAT_VERSION,
            notes: Vec::new(),
        }
    }
}

impl IdentityManifest {
    pub(crate) fn load(path: &Path, max_notes: usize) -> Result<Self, WorkspaceFailure> {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(metadata_corrupt("identityFileType"));
                }
                if metadata.len() > MAX_IDENTITY_BYTES {
                    return Err(metadata_corrupt("identityFileTooLarge"));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(metadata_io("inspectIdentity", &error)),
        }

        let bytes = fs::read(path).map_err(|error| metadata_io("readIdentity", &error))?;
        let manifest: Self =
            serde_json::from_slice(&bytes).map_err(|_| metadata_corrupt("invalidJson"))?;
        manifest.validate(max_notes)?;
        Ok(manifest)
    }

    fn validate(&self, max_notes: usize) -> Result<(), WorkspaceFailure> {
        if self.format_version != IDENTITY_FORMAT_VERSION {
            return Err(metadata_corrupt("unsupportedFormatVersion"));
        }
        if self.notes.len() > max_notes {
            return Err(metadata_corrupt("tooManyEntries"));
        }

        let mut ids = BTreeSet::new();
        let mut paths = BTreeSet::new();
        for entry in &self.notes {
            if !ids.insert(entry.id) {
                return Err(metadata_corrupt("duplicateId"));
            }
            if !paths.insert(entry.path.clone()) {
                return Err(metadata_corrupt("duplicatePath"));
            }
            let revision = entry.revision.as_str().as_bytes();
            if revision.len() != 64
                || revision
                    .iter()
                    .any(|byte| !byte.is_ascii_digit() && !(b'a'..=b'f').contains(byte))
            {
                return Err(metadata_corrupt("invalidRevision"));
            }
        }
        Ok(())
    }

    pub(crate) fn reconcile(&mut self, sources: &[(PortablePath, FileRevision)]) -> bool {
        let previous = self.notes.clone();
        let previous_by_path = previous
            .iter()
            .map(|entry| (entry.path.clone(), entry))
            .collect::<BTreeMap<_, _>>();
        let current_paths = sources
            .iter()
            .map(|(path, _)| path)
            .collect::<BTreeSet<_>>();

        let mut missing_by_revision: BTreeMap<&str, Vec<&IdentityEntry>> = BTreeMap::new();
        for entry in &previous {
            if !current_paths.contains(&entry.path) {
                missing_by_revision
                    .entry(entry.revision.as_str())
                    .or_default()
                    .push(entry);
            }
        }

        let mut new_counts = BTreeMap::<&str, usize>::new();
        for (path, revision) in sources {
            if !previous_by_path.contains_key(path) {
                *new_counts.entry(revision.as_str()).or_default() += 1;
            }
        }

        let mut next = Vec::with_capacity(sources.len());
        for (path, revision) in sources {
            let id = previous_by_path.get(path).map_or_else(
                || {
                    let candidates = missing_by_revision
                        .get(revision.as_str())
                        .map_or(&[][..], Vec::as_slice);
                    if new_counts.get(revision.as_str()) == Some(&1) && candidates.len() == 1 {
                        candidates[0].id
                    } else {
                        NoteId::new()
                    }
                },
                |entry| entry.id,
            );
            next.push(IdentityEntry {
                id,
                path: path.clone(),
                revision: revision.clone(),
            });
        }
        next.sort_by(|left, right| left.path.cmp(&right.path));
        self.notes = next;
        self.notes != previous
    }

    pub(crate) fn ensure(
        &mut self,
        path: &PortablePath,
        revision: &FileRevision,
    ) -> (NoteId, bool) {
        if let Some(entry) = self.notes.iter_mut().find(|entry| entry.path == *path) {
            let changed = entry.revision != *revision;
            entry.revision = revision.clone();
            return (entry.id, changed);
        }
        let id = NoteId::new();
        self.notes.push(IdentityEntry {
            id,
            path: path.clone(),
            revision: revision.clone(),
        });
        self.notes.sort_by(|left, right| left.path.cmp(&right.path));
        (id, true)
    }

    pub(crate) fn id_for(&self, path: &PortablePath) -> Option<NoteId> {
        self.notes
            .iter()
            .find(|entry| entry.path == *path)
            .map(|entry| entry.id)
    }

    pub(crate) fn move_path(
        &mut self,
        path: &PortablePath,
        new_path: &PortablePath,
        revision: &FileRevision,
    ) -> Result<NoteId, WorkspaceFailure> {
        if self.notes.iter().any(|entry| entry.path == *new_path) {
            return Err(metadata_corrupt("destinationIdentityExists"));
        }
        let entry = self
            .notes
            .iter_mut()
            .find(|entry| entry.path == *path)
            .ok_or_else(|| metadata_corrupt("renameSourceIdentityMissing"))?;
        entry.path = new_path.clone();
        entry.revision = revision.clone();
        let id = entry.id;
        self.notes.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(id)
    }

    pub(crate) fn persist(&self, path: &Path) -> Result<(), WorkspaceFailure> {
        let bytes =
            serde_json::to_vec_pretty(self).map_err(|_| metadata_corrupt("serializeFailed"))?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_IDENTITY_BYTES {
            return Err(metadata_corrupt("identityFileTooLarge"));
        }
        if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err(metadata_corrupt("identityFileType"));
        }

        let mut writer =
            AtomicWriteFile::open(path).map_err(|error| metadata_io("beginIdentity", &error))?;
        writer
            .write_all(&bytes)
            .map_err(|error| metadata_io("writeIdentity", &error))?;
        writer
            .commit()
            .map_err(|error| metadata_io("commitIdentity", &error))?;
        let verified = fs::read(path).map_err(|error| metadata_io("verifyIdentity", &error))?;
        if verified != bytes {
            return Err(metadata_corrupt("contentMismatch"));
        }
        Ok(())
    }
}

pub(crate) fn prepare_metadata_directory(root: &Path) -> Result<PathBuf, WorkspaceFailure> {
    let directory = root.join(".zhiweave");
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(metadata_corrupt("metadataDirectorySymlink"));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(metadata_corrupt("metadataDirectoryType"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&directory)
                .map_err(|error| metadata_io("createMetadataDirectory", &error))?;
        }
        Err(error) => return Err(metadata_io("inspectMetadataDirectory", &error)),
    }
    let canonical = directory
        .canonicalize()
        .map_err(|error| metadata_io("canonicalizeMetadataDirectory", &error))?;
    if !canonical.starts_with(root) {
        return Err(metadata_corrupt("metadataDirectoryOutsideRoot"));
    }
    Ok(canonical)
}

fn metadata_corrupt(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::MetadataCorrupt {
        kind: kind.to_owned(),
    }
}

fn metadata_io(operation: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::Io {
        operation: operation.to_owned(),
        path: ".zhiweave/identity.json".to_owned(),
        kind: match error.kind() {
            std::io::ErrorKind::PermissionDenied => "permissionDenied",
            std::io::ErrorKind::WriteZero => "writeZero",
            std::io::ErrorKind::StorageFull => "storageFull",
            std::io::ErrorKind::InvalidData | std::io::ErrorKind::InvalidInput => "invalidData",
            _ => "other",
        }
        .to_owned(),
    }
}
