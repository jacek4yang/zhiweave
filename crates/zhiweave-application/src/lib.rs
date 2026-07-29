//! Application use cases shared by every `ZhiWeave` client.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zhiweave_domain::{NoteId, NoteKind, PortablePath};
use zhiweave_protocol::{PROTOCOL_ID, PROTOCOL_VERSION};

/// Read-only status returned to the cross-platform shell.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    /// Product display name.
    pub product: &'static str,
    /// New standalone protocol identity.
    pub protocol: &'static str,
    /// Numeric protocol version.
    pub protocol_version: u16,
    /// Honest maturity label.
    pub stage: &'static str,
    /// Whether any Obsidian runtime is involved.
    pub obsidian_dependency: bool,
}

/// The exact line-ending convention observed in a Markdown file.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    /// The document has no line endings.
    None,
    /// Unix-style line feeds.
    Lf,
    /// Windows-style carriage-return plus line-feed pairs.
    Crlf,
    /// Legacy carriage returns.
    Cr,
    /// Multiple conventions occur in the same file.
    Mixed,
}

/// A content-derived revision used for optimistic concurrency control.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct FileRevision(String);

impl FileRevision {
    /// Creates a revision from the storage adapter's stable digest.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Returns the digest representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A Markdown document ready for editing.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    /// Stable identity derived by the active workspace index.
    pub id: NoteId,
    /// First level-one heading, or a readable filename fallback.
    pub title: String,
    /// Validated path relative to the workspace root.
    pub path: PortablePath,
    /// Learning-system role inferred from the workspace structure.
    pub kind: NoteKind,
    /// UTF-8 Markdown normalized to LF while in memory.
    pub markdown: String,
    /// Digest of the exact on-disk bytes.
    pub revision: FileRevision,
    /// On-disk line-ending convention.
    pub line_ending: LineEnding,
    /// Whether the original file begins with a UTF-8 BOM.
    pub has_utf8_bom: bool,
    /// Last modification time in Unix milliseconds when available.
    pub modified_at_millis: u64,
}

/// A bounded, deterministic view of the local Markdown workspace.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    /// User-facing root location. Commands never accept an arbitrary root.
    pub root_display: String,
    /// Documents sorted by their portable path.
    pub documents: Vec<NoteDocument>,
    /// Health and coverage of the rebuildable local search index.
    pub index: IndexStatus,
}

/// Read-only health of the derived `SQLite` index.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    /// Whether indexed search is ready, requires rebuild, or is unavailable.
    pub state: IndexState,
    /// Current application-owned schema version.
    pub schema_version: u32,
    /// Number of indexed Markdown documents.
    pub note_count: usize,
    /// Stable non-sensitive reason when search is not ready.
    pub issue: Option<String>,
}

/// User-visible state of the rebuildable index.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IndexState {
    /// Index is healthy and covers the current snapshot.
    Ready,
    /// Index is damaged and may be replaced only by an explicit rebuild.
    NeedsRebuild,
    /// Index cannot currently be opened, for example because storage is read-only.
    Unavailable,
}

/// A bounded plain-text full-text-search request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchNotesRequest {
    /// User-entered literal text. Storage adapters must not treat it as SQL.
    pub query: String,
    /// Requested maximum number of results.
    pub limit: usize,
}

/// One ranked result from the rebuildable local index.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchNoteResult {
    /// Stable hidden note identity.
    pub id: NoteId,
    /// Current level-one heading or filename fallback.
    pub title: String,
    /// Current portable path.
    pub path: PortablePath,
    /// Learning role used by navigation and filtering.
    pub kind: NoteKind,
    /// Plain-text context around the match.
    pub snippet: String,
    /// `SQLite` FTS rank; lower values are more relevant.
    pub rank: f64,
}

/// Outcome of an explicit derived-index rebuild.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildIndexResult {
    /// Number of Markdown documents written to the fresh index.
    pub indexed_notes: usize,
    /// Schema version of the fresh index.
    pub schema_version: u32,
    /// Whether a previous database was preserved in hidden recovery storage.
    pub preserved_previous_database: bool,
}

/// Data required to create a new Markdown source file.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    /// New, validated workspace-relative path.
    pub path: PortablePath,
    /// Editor Markdown, always LF-normalized.
    pub markdown: String,
}

/// Data required for a conflict-safe save.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteRequest {
    /// Existing, validated workspace-relative path.
    pub path: PortablePath,
    /// Editor Markdown, always LF-normalized.
    pub markdown: String,
    /// Revision returned by the last successful open or save.
    pub expected_revision: FileRevision,
    /// Convention to restore when writing the Markdown source.
    pub line_ending: LineEnding,
    /// Whether to restore the source's UTF-8 BOM.
    pub has_utf8_bom: bool,
}

/// Data required for a conflict-safe, non-overwriting note move.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNoteRequest {
    /// Current validated workspace-relative path.
    pub path: PortablePath,
    /// New validated path; an existing destination is never replaced.
    pub new_path: PortablePath,
    /// Revision returned by the last successful open or save.
    pub expected_revision: FileRevision,
}

/// Result of a successful save.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteResult {
    /// Fresh document and revision after the save.
    pub document: NoteDocument,
    /// False when the requested bytes already matched the source.
    pub changed: bool,
    /// False when the Markdown save succeeded but derived indexing must catch up.
    pub index_updated: bool,
}

/// Stable failure contract between application, native shell, and frontend.
#[derive(Clone, Debug, Error, Eq, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum WorkspaceFailure {
    /// The requested Markdown file does not exist.
    #[error("workspace Markdown file was not found: {path}")]
    NotFound {
        /// Portable workspace path.
        path: String,
    },
    /// A create operation would overwrite an existing source.
    #[error("workspace Markdown file already exists: {path}")]
    AlreadyExists {
        /// Portable workspace path.
        path: String,
    },
    /// The source changed since it was opened.
    #[error("workspace Markdown file changed outside this editor: {path}")]
    Conflict {
        /// Portable workspace path.
        path: String,
        /// Revision supplied by the editor.
        expected: String,
        /// Current source revision.
        actual: String,
    },
    /// The file is not valid UTF-8 Markdown.
    #[error("workspace Markdown file is not valid UTF-8: {path}")]
    InvalidUtf8 {
        /// Portable workspace path.
        path: String,
    },
    /// The file exceeds the storage adapter's safety limit.
    #[error("workspace Markdown file exceeds the {limit_bytes}-byte limit: {path}")]
    TooLarge {
        /// Portable workspace path.
        path: String,
        /// Enforced byte limit.
        limit_bytes: u64,
    },
    /// A symbolic link crossed the fixed workspace boundary.
    #[error("symbolic links are not supported inside the workspace: {path}")]
    SymbolicLink {
        /// Portable workspace path.
        path: String,
    },
    /// Mixed line endings require an explicit normalization choice.
    #[error("mixed line endings must be normalized before saving: {path}")]
    MixedLineEndings {
        /// Portable workspace path.
        path: String,
    },
    /// The editor supplied non-normalized content.
    #[error("editor Markdown must use LF line endings: {path}")]
    NonNormalizedEditorText {
        /// Portable workspace path.
        path: String,
    },
    /// Hidden stable-identity metadata is malformed or internally inconsistent.
    #[error("workspace identity metadata is invalid: {kind}")]
    MetadataCorrupt {
        /// Stable, non-sensitive reason category.
        kind: String,
    },
    /// The derived `SQLite` database failed integrity or format checks.
    #[error("workspace search index is damaged and requires an explicit rebuild: {kind}")]
    IndexCorrupt {
        /// Stable, non-sensitive reason category.
        kind: String,
    },
    /// The index was created by a newer incompatible application schema.
    #[error("workspace search index schema {found} is newer than supported schema {supported}")]
    IndexSchemaTooNew {
        /// Schema found in the database.
        found: u32,
        /// Maximum schema supported by this build.
        supported: u32,
    },
    /// A non-corruption `SQLite` operation failed.
    #[error("workspace search index operation {operation} failed: {kind}")]
    IndexUnavailable {
        /// Stable operation name.
        operation: String,
        /// Coarse error category suitable for UI decisions.
        kind: String,
    },
    /// A search query exceeds the public boundary or is empty.
    #[error("workspace search query is invalid: {kind}")]
    InvalidSearch {
        /// Stable validation category.
        kind: String,
    },
    /// A bounded workspace limit was reached.
    #[error("workspace limit exceeded: {limit}")]
    LimitExceeded {
        /// Human-readable, non-sensitive limit.
        limit: String,
    },
    /// A filesystem operation failed without exposing sensitive platform details.
    #[error("workspace operation {operation} failed for {path}")]
    Io {
        /// Stable operation name.
        operation: String,
        /// Portable path, or `workspace` for the fixed root.
        path: String,
        /// Coarse error category suitable for UI decisions.
        kind: String,
    },
    /// The application service lock was poisoned.
    #[error("workspace service is temporarily unavailable")]
    Unavailable,
}

/// Filesystem-independent workspace boundary owned by the application layer.
pub trait WorkspacePort {
    /// Returns a deterministic snapshot of all bounded Markdown sources.
    ///
    /// # Errors
    ///
    /// Returns a structured failure when the workspace cannot be inspected.
    fn snapshot(&self) -> Result<WorkspaceSnapshot, WorkspaceFailure>;

    /// Creates a Markdown source without replacing an existing file.
    ///
    /// # Errors
    ///
    /// Returns a structured failure when validation or durable creation fails.
    fn create(&self, request: &CreateNoteRequest) -> Result<NoteDocument, WorkspaceFailure>;

    /// Saves only when the expected revision still matches the source.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceFailure::Conflict`] instead of silently overwriting.
    fn save(&self, request: &SaveNoteRequest) -> Result<SaveNoteResult, WorkspaceFailure>;

    /// Moves a Markdown source without replacing another file.
    ///
    /// # Errors
    ///
    /// Returns a conflict for a changed source and `AlreadyExists` for an
    /// occupied destination.
    fn rename(&self, request: &RenameNoteRequest) -> Result<NoteDocument, WorkspaceFailure>;

    /// Searches the rebuildable local index without exposing SQL syntax.
    ///
    /// # Errors
    ///
    /// Returns a structured index or query failure.
    fn search(
        &self,
        request: &SearchNotesRequest,
    ) -> Result<Vec<SearchNoteResult>, WorkspaceFailure>;

    /// Rebuilds the derived index from Markdown and hidden stable identities.
    ///
    /// # Errors
    ///
    /// Returns without replacing the existing database when the fresh index
    /// cannot be built and verified.
    fn rebuild_index(&self) -> Result<RebuildIndexResult, WorkspaceFailure>;
}

/// Thin application service that keeps native adapters behind one audited port.
pub struct WorkspaceApplication<P> {
    port: P,
}

impl<P> WorkspaceApplication<P>
where
    P: WorkspacePort,
{
    /// Creates an application service around one fixed workspace adapter.
    #[must_use]
    pub const fn new(port: P) -> Self {
        Self { port }
    }

    /// Returns the current workspace snapshot.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured workspace failure.
    pub fn snapshot(&self) -> Result<WorkspaceSnapshot, WorkspaceFailure> {
        self.port.snapshot()
    }

    /// Creates one Markdown source.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured workspace failure.
    pub fn create(&self, request: &CreateNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
        self.port.create(request)
    }

    /// Saves one Markdown source with optimistic concurrency control.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured workspace failure.
    pub fn save(&self, request: &SaveNoteRequest) -> Result<SaveNoteResult, WorkspaceFailure> {
        self.port.save(request)
    }

    /// Moves a note while preserving its hidden identity.
    ///
    /// # Errors
    ///
    /// Propagates structured conflict, path, and storage failures.
    pub fn rename(&self, request: &RenameNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
        self.port.rename(request)
    }

    /// Searches indexed Markdown with a bounded literal query.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured search or index failure.
    pub fn search(
        &self,
        request: &SearchNotesRequest,
    ) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
        self.port.search(request)
    }

    /// Explicitly rebuilds derived index data from portable sources.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured rebuild failure.
    pub fn rebuild_index(&self) -> Result<RebuildIndexResult, WorkspaceFailure> {
        self.port.rebuild_index()
    }
}

/// Returns immutable build identity for the local Markdown workspace slice.
#[must_use]
pub const fn system_status() -> SystemStatus {
    SystemStatus {
        product: "知织 / ZhiWeave",
        protocol: PROTOCOL_ID,
        protocol_version: PROTOCOL_VERSION,
        stage: "local indexed Markdown workspace alpha",
        obsidian_dependency: false,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use zhiweave_domain::{NoteId, NoteKind, PortablePath};

    use super::{
        CreateNoteRequest, FileRevision, LineEnding, NoteDocument, RenameNoteRequest,
        SaveNoteRequest, SaveNoteResult, WorkspaceApplication, WorkspaceFailure, WorkspacePort,
        WorkspaceSnapshot,
    };

    struct RecordingPort {
        calls: RefCell<Vec<&'static str>>,
        document: NoteDocument,
    }

    impl WorkspacePort for RecordingPort {
        fn snapshot(&self) -> Result<WorkspaceSnapshot, WorkspaceFailure> {
            self.calls.borrow_mut().push("snapshot");
            Ok(WorkspaceSnapshot {
                root_display: "test-workspace".to_owned(),
                documents: vec![self.document.clone()],
                index: super::IndexStatus {
                    state: super::IndexState::Ready,
                    schema_version: 1,
                    note_count: 1,
                    issue: None,
                },
            })
        }

        fn create(&self, _: &CreateNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
            self.calls.borrow_mut().push("create");
            Ok(self.document.clone())
        }

        fn save(&self, _: &SaveNoteRequest) -> Result<SaveNoteResult, WorkspaceFailure> {
            self.calls.borrow_mut().push("save");
            Ok(SaveNoteResult {
                document: self.document.clone(),
                changed: true,
                index_updated: true,
            })
        }

        fn rename(&self, _: &RenameNoteRequest) -> Result<NoteDocument, WorkspaceFailure> {
            self.calls.borrow_mut().push("rename");
            Ok(self.document.clone())
        }

        fn search(
            &self,
            _: &super::SearchNotesRequest,
        ) -> Result<Vec<super::SearchNoteResult>, WorkspaceFailure> {
            self.calls.borrow_mut().push("search");
            Ok(Vec::new())
        }

        fn rebuild_index(&self) -> Result<super::RebuildIndexResult, WorkspaceFailure> {
            self.calls.borrow_mut().push("rebuild_index");
            Ok(super::RebuildIndexResult {
                indexed_notes: 1,
                schema_version: 1,
                preserved_previous_database: false,
            })
        }
    }

    fn document() -> NoteDocument {
        NoteDocument {
            id: NoteId::new(),
            title: "Ownership".to_owned(),
            path: PortablePath::new_markdown("topics/ownership.md").unwrap(),
            kind: NoteKind::Topic,
            markdown: "# Ownership\n".to_owned(),
            revision: FileRevision::new("revision"),
            line_ending: LineEnding::Lf,
            has_utf8_bom: false,
            modified_at_millis: 0,
        }
    }

    #[test]
    fn standalone_product_has_no_obsidian_dependency() {
        let status = super::system_status();
        assert_eq!(status.protocol, "ZHIWEAVE/1");
        assert!(!status.obsidian_dependency);
    }

    #[test]
    fn application_routes_workspace_use_cases_through_the_port() {
        let document = document();
        let application = WorkspaceApplication::new(RecordingPort {
            calls: RefCell::new(Vec::new()),
            document: document.clone(),
        });
        let create = CreateNoteRequest {
            path: document.path.clone(),
            markdown: document.markdown.clone(),
        };
        let save = SaveNoteRequest {
            path: document.path.clone(),
            markdown: document.markdown.clone(),
            expected_revision: document.revision.clone(),
            line_ending: LineEnding::Lf,
            has_utf8_bom: false,
        };

        assert_eq!(
            application.snapshot().unwrap().documents.as_slice(),
            std::slice::from_ref(&document)
        );
        assert_eq!(application.create(&create).unwrap(), document);
        assert!(application.save(&save).unwrap().changed);
        assert_eq!(
            application.port.calls.into_inner(),
            ["snapshot", "create", "save"]
        );
    }
}
