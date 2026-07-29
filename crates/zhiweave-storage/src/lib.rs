//! Recoverable local Markdown workspace adapter.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use atomic_write_file::AtomicWriteFile;
use sha2::{Digest, Sha256};
use zhiweave_application::{
    CreateNoteRequest, FileRevision, LineEnding, NoteDocument, SaveNoteRequest, SaveNoteResult,
    WorkspaceFailure, WorkspacePort, WorkspaceSnapshot,
};
use zhiweave_domain::{NoteId, NoteKind, PortablePath};
use zhiweave_markdown::first_level_one_heading;

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
        Ok(Self {
            root_display: root.display().to_string(),
            root,
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

    fn read_document(&self, path: &PortablePath) -> Result<NoteDocument, WorkspaceFailure> {
        let absolute = self.resolve_existing(path)?;
        let (bytes, modified_at_millis) = read_bounded(&absolute, path)?;
        decode_document(path, &bytes, modified_at_millis)
    }
}

impl WorkspacePort for FileWorkspace {
    fn snapshot(&self) -> Result<WorkspaceSnapshot, WorkspaceFailure> {
        let documents = self
            .collect_markdown_paths()?
            .iter()
            .map(|path| self.read_document(path))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(WorkspaceSnapshot {
            root_display: self.root_display.clone(),
            documents,
        })
    }

    fn create(&self, request: &CreateNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
        validate_editor_text(&request.path, &request.markdown, LineEnding::Lf)?;
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
        self.read_document(&request.path)
    }

    fn save(&self, request: &SaveNoteRequest) -> Result<SaveNoteResult, WorkspaceFailure> {
        validate_editor_text(&request.path, &request.markdown, request.line_ending)?;
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
            return Ok(SaveNoteResult {
                document: self.read_document(&request.path)?,
                changed: false,
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

        let document = self.read_document(&request.path)?;
        let desired_revision = revision(&desired_bytes);
        if document.revision != desired_revision {
            return Err(WorkspaceFailure::Io {
                operation: "verifySave".to_owned(),
                path: request.path.to_string(),
                kind: "contentMismatch".to_owned(),
            });
        }
        Ok(SaveNoteResult {
            document,
            changed: true,
        })
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
) -> Result<NoteDocument, WorkspaceFailure> {
    let has_utf8_bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content = if has_utf8_bom { &bytes[3..] } else { bytes };
    let text = std::str::from_utf8(content).map_err(|_| WorkspaceFailure::InvalidUtf8 {
        path: path.to_string(),
    })?;
    let line_ending = detect_line_ending(content);
    let markdown = text.replace("\r\n", "\n").replace('\r', "\n");
    let title = first_level_one_heading(&markdown).unwrap_or_else(|| fallback_title(path));
    Ok(NoteDocument {
        id: stable_note_id(path),
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

fn stable_note_id(path: &PortablePath) -> NoteId {
    let digest =
        Sha256::digest([b"zhiweave-note-id\0".as_slice(), path.as_str().as_bytes()].concat());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    NoteId::from_bytes(bytes)
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
        CreateNoteRequest, LineEnding, SaveNoteRequest, WorkspaceFailure, WorkspacePort,
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
