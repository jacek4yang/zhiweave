//! Application use cases shared by every `ZhiWeave` client.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zhiweave_domain::{NoteId, NoteKind, PortablePath, PortableResourcePath};
use zhiweave_protocol::{PROTOCOL_ID, PROTOCOL_VERSION};

const MAX_CHANGE_BASELINE_NOTES: usize = 10_000;

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

/// One note state already known by a client before a disk rescan.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownNoteState {
    /// Stable note identity, independent of its current path.
    pub id: NoteId,
    /// Last path accepted by the client.
    pub path: PortablePath,
    /// Last exact on-disk revision accepted by the client.
    pub revision: FileRevision,
}

/// Bounded baseline used to classify external filesystem changes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectWorkspaceChangesRequest {
    /// Notes known by the caller. Duplicate identities or paths are rejected.
    pub notes: Vec<KnownNoteState>,
}

/// User-facing class of a verified external workspace change.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceChangeKind {
    /// A previously unknown stable identity appeared.
    Created,
    /// A known identity kept its path but changed exact bytes.
    Modified,
    /// A known identity no longer exists in the current Markdown snapshot.
    Deleted,
    /// A known identity moved to a different portable path.
    Moved,
}

/// One change verified by comparing a trusted snapshot with a client baseline.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChange {
    /// Verified change classification.
    pub kind: WorkspaceChangeKind,
    /// Stable identity affected by the change.
    pub id: NoteId,
    /// Path previously accepted by the client, when one existed.
    pub previous_path: Option<PortablePath>,
    /// Current path in the verified disk snapshot, when one exists.
    pub current_path: Option<PortablePath>,
    /// Current display title, when the note still exists.
    pub current_title: Option<String>,
    /// Whether exact Markdown bytes changed in addition to any path change.
    pub content_changed: bool,
}

/// Verified workspace changes plus the snapshot used to classify them.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangesResult {
    /// Complete current Markdown snapshot.
    pub snapshot: WorkspaceSnapshot,
    /// Deterministically ordered changes relative to the supplied baseline.
    pub changes: Vec<WorkspaceChange>,
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

/// Request for resolved incoming Wiki references to one knowledge node.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinksRequest {
    /// Stable target note identity.
    pub note_id: NoteId,
    /// Requested maximum number of reference occurrences.
    pub limit: usize,
}

/// Semantic source syntax for one incoming Wiki relationship.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BacklinkReferenceKind {
    /// A normal `[[target]]` relationship.
    Link,
    /// An embedded `![[target]]` relationship.
    Embed,
}

/// One resolved incoming Wiki reference from the rebuildable index.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkReference {
    /// Stable source note identity.
    pub source_note_id: NoteId,
    /// Current source title.
    pub source_title: String,
    /// Current source path.
    pub source_path: PortablePath,
    /// Learning role of the source note.
    pub source_kind: NoteKind,
    /// Link or embed syntax.
    pub reference_kind: BacklinkReferenceKind,
    /// Authored target without display alias.
    pub raw_target: String,
    /// Byte offset of the opening marker in the source Markdown.
    pub source_byte_start: usize,
    /// Byte offset immediately after the closing marker.
    pub source_byte_end: usize,
    /// One-based source line.
    pub line: usize,
    /// One-based Unicode scalar column.
    pub column: usize,
    /// Bounded single-line source context.
    pub context: String,
}

/// Request to resolve one authored Wiki target from a stable source note.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWikiTargetRequest {
    /// Stable identity of the note containing the authored target.
    pub source_note_id: NoteId,
    /// Authored target without the surrounding `[[` and `]]` markers.
    pub raw_target: String,
}

/// Exact Markdown source proposed for one unresolved Wiki target.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiTargetCreationProposal {
    /// User-visible H1 for the new knowledge node.
    pub title: String,
    /// Exact portable path that will be created without replacement.
    pub path: PortablePath,
    /// Optional authored heading that will be materialized as an H2.
    pub heading: Option<String>,
}

/// Explicit confirmation to create one still-missing Wiki target.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWikiTargetRequest {
    /// Stable identity of the note containing the unresolved target.
    pub source_note_id: NoteId,
    /// Authored target without the surrounding `[[` and `]]` markers.
    pub raw_target: String,
    /// Proposal path shown to and confirmed by the user.
    pub expected_path: PortablePath,
}

/// Result state for an authored Wiki target.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WikiTargetResolutionState {
    /// Exactly one target matched the authoritative index.
    Resolved,
    /// No indexed note matched.
    Missing,
    /// Multiple indexed notes matched and the application refused to guess.
    Ambiguous,
}

/// Minimal stable identity returned for a resolved Wiki target.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWikiTargetNote {
    /// Stable hidden note identity.
    pub id: NoteId,
    /// Current level-one heading or filename fallback.
    pub title: String,
    /// Current portable path.
    pub path: PortablePath,
    /// Learning role used by navigation and filtering.
    pub kind: NoteKind,
}

/// Authoritative forward-resolution result for one Wiki target.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiTargetResolution {
    /// Trimmed authored target used for the lookup.
    pub raw_target: String,
    /// Resolved, missing, or ambiguous without a best-effort guess.
    pub state: WikiTargetResolutionState,
    /// Stable target metadata only when `state` is `resolved`.
    pub target: Option<ResolvedWikiTargetNote>,
    /// Optional authored heading fragment without the leading `#`.
    pub heading: Option<String>,
    /// Exact creation proposal only when the target is safely creatable and missing.
    pub creation: Option<WikiTargetCreationProposal>,
}

/// Syntax family that authored one attachment reference.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentReferenceKind {
    /// Standard Markdown image syntax such as `![alt](image.png)`.
    MarkdownImage,
    /// Wiki embed syntax such as `![[attachments/image.png]]`.
    WikiEmbed,
}

/// Request to resolve one attachment relative to a stable source note.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAttachmentRequest {
    /// Stable identity of the Markdown note containing the reference.
    pub source_note_id: NoteId,
    /// Authored resource target without Markdown delimiters.
    pub raw_target: String,
    /// Syntax family used to derive deterministic relative-path semantics.
    pub reference_kind: AttachmentReferenceKind,
}

/// Stable result state for a bounded attachment preview request.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentResolutionState {
    /// One supported local image passed every validation and was read.
    Resolved,
    /// No matching local resource exists.
    Missing,
    /// Multiple deterministic candidates exist and none was guessed.
    Ambiguous,
    /// The resource exists but its format is not safe for inline preview.
    Unsupported,
    /// The local resource exceeds the byte or decoded-pixel budget.
    TooLarge,
    /// The authored target uses a remote or active URL scheme.
    RemoteBlocked,
}

/// Supported inert raster formats exposed to the `WebView` as data URLs.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentMediaType {
    /// Portable Network Graphics.
    Png,
    /// JPEG/JFIF/Exif raster.
    Jpeg,
    /// Static WebP raster.
    Webp,
}

impl AttachmentMediaType {
    /// Returns the exact MIME type used by the native shell data URL.
    #[must_use]
    pub const fn mime_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

/// One validated local image and its bounded original bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttachmentContent {
    /// Canonical portable resource path inside the fixed workspace.
    pub path: PortableResourcePath,
    /// Media type established from file signature, not only extension.
    pub media_type: AttachmentMediaType,
    /// Original file length before base64 transport.
    pub byte_length: u64,
    /// SHA-256 of the original attachment bytes.
    pub content_sha256: String,
    /// Intrinsic pixel width from the bounded image header.
    pub width: u32,
    /// Intrinsic pixel height from the bounded image header.
    pub height: u32,
    /// Original attachment bytes, never executable source.
    pub bytes: Vec<u8>,
}

/// Authoritative result for one attachment preview request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttachmentResolution {
    /// Trimmed authored target used for the lookup.
    pub raw_target: String,
    /// Whether the syntax/extension denotes an attachment rather than a note.
    pub recognized_attachment: bool,
    /// Bounded resolution result.
    pub state: AttachmentResolutionState,
    /// Validated content only when `state` is `resolved`.
    pub content: Option<AttachmentContent>,
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

/// Request for the durable version graph of one stable knowledge node.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionHistoryRequest {
    /// Stable note identity whose complete local graph should be returned.
    pub note_id: NoteId,
}

/// One independently recoverable node in the local version DAG.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionNode {
    /// Backend-generated immutable version identity.
    pub id: String,
    /// Stable knowledge-node identity.
    pub note_id: NoteId,
    /// Human-readable title captured with this version.
    pub note_title: String,
    /// Parent selected when the version was created.
    pub parent_id: Option<String>,
    /// SHA-256 of the complete normalized Markdown.
    pub content_hash: String,
    /// Complete UTF-8 Markdown size before compression.
    pub content_length: u64,
    /// Creation time as Unix milliseconds.
    pub created_at_millis: u64,
    /// Optional bounded user explanation.
    pub message: Option<String>,
    /// Optional user-visible name that protects this node from retention cleanup.
    pub checkpoint_name: Option<String>,
}

/// Storage summary for one note's reachable and branched local history.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionHistoryStats {
    /// Number of version nodes for the note.
    pub version_count: usize,
    /// Number of distinct content chunks referenced by those nodes.
    pub chunk_count: usize,
    /// Sum of complete Markdown sizes across all nodes.
    pub logical_bytes: u64,
    /// Compressed bytes occupied by distinct referenced chunks.
    pub stored_bytes: u64,
}

/// Complete bounded graph and current branch head for one note.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionHistory {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Current parent for the next manual version.
    pub head: Option<String>,
    /// Nodes ordered newest first.
    pub nodes: Vec<VersionNode>,
    /// Deduplicated storage summary.
    pub stats: VersionHistoryStats,
}

/// Request to create an incremental, independently recoverable version.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersionRequest {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Current H1-driven display title.
    pub note_title: String,
    /// LF-normalized editor Markdown.
    pub markdown: String,
    /// Head observed by the caller; mismatch is a conflict.
    pub expected_head: Option<String>,
    /// Optional user explanation.
    pub message: Option<String>,
}

/// Result of a manual version save.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersionResult {
    /// Existing head for a no-op, or the newly created node.
    pub node: VersionNode,
    /// False when the current head already has identical complete content.
    pub created: bool,
    /// Updated graph and storage summary.
    pub history: VersionHistory,
}

/// Request to reconstruct one exact version.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadVersionRequest {
    /// Immutable backend-generated version identity.
    pub version_id: String,
}

/// Verified Markdown reconstructed from content-addressed chunks.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionContent {
    /// Metadata for the reconstructed node.
    pub node: VersionNode,
    /// Complete verified LF-normalized Markdown.
    pub markdown: String,
}

/// Request to select an existing version as the next branch parent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutVersionRequest {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Existing version that becomes the current head.
    pub version_id: String,
    /// Head observed by the caller; mismatch is a conflict.
    pub expected_head: Option<String>,
}

/// Request to remove one exact node while preserving its descendants.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteVersionRequest {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Exact version to remove.
    pub version_id: String,
    /// Head observed by the caller; mismatch is a conflict.
    pub expected_head: Option<String>,
}

/// Result of deleting a node and collecting unreferenced chunks.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteVersionResult {
    /// Graph after child reparenting and head adjustment.
    pub history: VersionHistory,
    /// Compressed chunk bytes reclaimed by this transaction.
    pub released_bytes: u64,
}

/// Request to name or remove a protected checkpoint on one version node.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVersionCheckpointRequest {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Existing immutable version identity.
    pub version_id: String,
    /// Head observed by the caller; mismatch is a conflict.
    pub expected_head: Option<String>,
    /// Trimmed checkpoint name, or `None` to remove the checkpoint.
    pub checkpoint_name: Option<String>,
}

/// Bounded retention policy for one note's local history.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRetentionPolicy {
    /// Always retain at least this many newest nodes.
    pub keep_latest: u16,
    /// Retain every node created within this many whole days.
    pub keep_days: u16,
}

/// Request for a non-mutating retention preview.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewVersionRetentionRequest {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Head observed by the caller; mismatch is a conflict.
    pub expected_head: Option<String>,
    /// User-selected bounded retention policy.
    pub policy: VersionRetentionPolicy,
}

/// Exact retention plan generated from one verified history state.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRetentionPreview {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Head that was current while the preview was generated.
    pub expected_head: Option<String>,
    /// Validated policy used to select candidates.
    pub policy: VersionRetentionPolicy,
    /// Fixed age boundary reused during apply so time cannot change the plan.
    pub cutoff_at_millis: u64,
    /// Digest binding the policy, graph state, and exact candidate set.
    pub preview_token: String,
    /// Exact nodes proposed for deletion, newest first.
    pub candidates: Vec<VersionNode>,
    /// Number of nodes that will remain.
    pub remaining_version_count: usize,
    /// Exact compressed bytes expected to become globally unreferenced.
    pub released_bytes: u64,
}

/// Request to apply one previously reviewed retention preview.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyVersionRetentionRequest {
    /// Stable note identity.
    pub note_id: NoteId,
    /// Head observed in the preview.
    pub expected_head: Option<String>,
    /// Policy shown in the preview.
    pub policy: VersionRetentionPolicy,
    /// Fixed cutoff returned by the preview.
    pub cutoff_at_millis: u64,
    /// Digest returned by the preview.
    pub preview_token: String,
}

/// Result of one atomic retention cleanup.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyVersionRetentionResult {
    /// Verified graph after cleanup and child reparenting.
    pub history: VersionHistory,
    /// Number of exact nodes removed by the transaction.
    pub deleted_versions: usize,
    /// Compressed chunk bytes reclaimed by the transaction.
    pub released_bytes: u64,
}

/// User-visible summary of one verified portable workspace backup directory.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupSummary {
    /// Backend-generated immutable backup identity.
    pub id: String,
    /// Optional bounded user label.
    pub label: Option<String>,
    /// Creation time as Unix milliseconds.
    pub created_at_millis: u64,
    /// Number of payload files covered by the checksum manifest.
    pub file_count: usize,
    /// Sum of payload bytes.
    pub total_bytes: u64,
    /// Number of durable version nodes in the consistent history snapshot.
    pub history_version_count: usize,
    /// Workspace-relative directory that can be copied as one backup package.
    pub path_display: String,
}

/// Request to create a complete portable workspace backup.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceBackupRequest {
    /// Optional user-visible label.
    pub label: Option<String>,
}

/// Result of a complete, checksum-verified backup export.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceBackupResult {
    /// Newly committed backup package.
    pub backup: WorkspaceBackupSummary,
}

/// Request to verify one existing backup package.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyWorkspaceBackupRequest {
    /// Immutable backend-generated backup identity.
    pub backup_id: String,
}

/// Result of re-reading every payload file and checksum.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyWorkspaceBackupResult {
    /// Verified package summary.
    pub backup: WorkspaceBackupSummary,
    /// Number of payload files re-read.
    pub verified_files: usize,
    /// Number of payload bytes re-read.
    pub verified_bytes: u64,
}

/// Request to stage a complete restore for the next application start.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareWorkspaceRestoreRequest {
    /// Exact verified backup to stage.
    pub backup_id: String,
}

/// Result of staging a crash-recoverable workspace replacement.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareWorkspaceRestoreResult {
    /// Backup selected for restore.
    pub backup: WorkspaceBackupSummary,
    /// Fresh backup of the current workspace made before staging.
    pub safety_backup: WorkspaceBackupSummary,
    /// Always true: the directory swap occurs before storage opens next launch.
    pub restart_required: bool,
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
    /// The durable version store failed integrity or format checks.
    #[error("workspace version history is damaged: {kind}")]
    HistoryCorrupt {
        /// Stable, non-sensitive reason category.
        kind: String,
    },
    /// The version store was created by a newer incompatible schema.
    #[error("workspace version history schema {found} is newer than supported schema {supported}")]
    HistorySchemaTooNew {
        /// Schema found in the database.
        found: u32,
        /// Maximum schema supported by this build.
        supported: u32,
    },
    /// A non-corruption history operation failed.
    #[error("workspace version history operation {operation} failed: {kind}")]
    HistoryUnavailable {
        /// Stable operation name.
        operation: String,
        /// Coarse error category suitable for UI decisions.
        kind: String,
    },
    /// The requested immutable version does not exist.
    #[error("workspace version was not found: {version_id}")]
    VersionNotFound {
        /// Backend-generated immutable version identity.
        version_id: String,
    },
    /// The history head changed since the caller observed it.
    #[error("workspace version head changed for note {note_id}")]
    VersionConflict {
        /// Stable note identity.
        note_id: NoteId,
        /// Head supplied by the caller.
        expected: Option<String>,
        /// Current durable head.
        actual: Option<String>,
    },
    /// A public history request exceeded a bound or was malformed.
    #[error("workspace version request is invalid: {kind}")]
    InvalidVersionRequest {
        /// Stable validation category.
        kind: String,
    },
    /// A requested backup package does not exist.
    #[error("workspace backup was not found: {backup_id}")]
    BackupNotFound {
        /// Backend-generated backup identity.
        backup_id: String,
    },
    /// A backup package, checksum manifest, or staged restore is damaged.
    #[error("workspace backup is damaged: {kind}")]
    BackupCorrupt {
        /// Stable, non-sensitive reason category.
        kind: String,
    },
    /// A non-corruption backup or restore operation failed.
    #[error("workspace backup operation {operation} failed: {kind}")]
    BackupUnavailable {
        /// Stable operation name.
        operation: String,
        /// Coarse error category suitable for UI decisions.
        kind: String,
    },
    /// A public backup request exceeded a bound or was malformed.
    #[error("workspace backup request is invalid: {kind}")]
    InvalidBackupRequest {
        /// Stable validation category.
        kind: String,
    },
    /// A search query exceeds the public boundary or is empty.
    #[error("workspace search query is invalid: {kind}")]
    InvalidSearch {
        /// Stable validation category.
        kind: String,
    },
    /// A Wiki target lookup exceeded the public boundary or was malformed.
    #[error("workspace Wiki target is invalid: {kind}")]
    InvalidWikiTarget {
        /// Stable validation category.
        kind: String,
    },
    /// An attachment request exceeded the public boundary or was malformed.
    #[error("workspace attachment target is invalid: {kind}")]
    InvalidAttachmentTarget {
        /// Stable validation category.
        kind: String,
    },
    /// The caller supplied an ambiguous or excessive change baseline.
    #[error("workspace change baseline is invalid: {kind}")]
    InvalidChangeBaseline {
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

    /// Returns resolved incoming Wiki references from the rebuildable index.
    ///
    /// # Errors
    ///
    /// Returns a structured index, identity, or limit failure.
    fn backlinks(
        &self,
        request: &BacklinksRequest,
    ) -> Result<Vec<BacklinkReference>, WorkspaceFailure>;

    /// Resolves one authored Wiki target through the rebuildable index.
    ///
    /// # Errors
    ///
    /// Returns a structured index, source-identity, or target-boundary failure.
    fn resolve_wiki_target(
        &self,
        request: &ResolveWikiTargetRequest,
    ) -> Result<WikiTargetResolution, WorkspaceFailure>;

    /// Creates one Wiki target only after the user confirms the exact proposal.
    ///
    /// # Errors
    ///
    /// Revalidates the current workspace and fails without replacement when the
    /// target is no longer missing or the confirmed path is stale.
    fn create_wiki_target(
        &self,
        request: &CreateWikiTargetRequest,
    ) -> Result<NoteDocument, WorkspaceFailure>;

    /// Resolves and reads one bounded local attachment preview.
    ///
    /// # Errors
    ///
    /// Returns a structured source-identity, path, symlink, or I/O failure.
    fn resolve_attachment(
        &self,
        request: &ResolveAttachmentRequest,
    ) -> Result<AttachmentResolution, WorkspaceFailure>;

    /// Rebuilds the derived index from Markdown and hidden stable identities.
    ///
    /// # Errors
    ///
    /// Returns without replacing the existing database when the fresh index
    /// cannot be built and verified.
    fn rebuild_index(&self) -> Result<RebuildIndexResult, WorkspaceFailure>;
}

/// Durable local version boundary, separate from the rebuildable search index.
pub trait VersionHistoryPort {
    /// Returns one note's complete bounded local version graph.
    ///
    /// # Errors
    ///
    /// Returns a structured integrity, schema, concurrency, or storage failure.
    fn version_history(
        &self,
        request: &VersionHistoryRequest,
    ) -> Result<VersionHistory, WorkspaceFailure>;

    /// Saves a content-addressed version using optimistic head concurrency.
    ///
    /// # Errors
    ///
    /// Returns a structured validation, conflict, integrity, or storage failure.
    fn save_version(
        &self,
        request: &SaveVersionRequest,
    ) -> Result<SaveVersionResult, WorkspaceFailure>;

    /// Reconstructs and verifies one immutable version.
    ///
    /// # Errors
    ///
    /// Returns without content when the node, manifest, or chunk is invalid.
    fn read_version(
        &self,
        request: &ReadVersionRequest,
    ) -> Result<VersionContent, WorkspaceFailure>;

    /// Selects an existing node as the parent for the next version.
    ///
    /// # Errors
    ///
    /// Returns a conflict when the durable head differs from the expected head.
    fn checkout_version(
        &self,
        request: &CheckoutVersionRequest,
    ) -> Result<VersionHistory, WorkspaceFailure>;

    /// Deletes one exact node, reparents children, and collects orphan chunks.
    ///
    /// # Errors
    ///
    /// Returns without mutation on validation, concurrency, or integrity failure.
    fn delete_version(
        &self,
        request: &DeleteVersionRequest,
    ) -> Result<DeleteVersionResult, WorkspaceFailure>;

    /// Names or removes a retention-protected checkpoint.
    ///
    /// # Errors
    ///
    /// Returns without mutation on validation, concurrency, or integrity failure.
    fn set_version_checkpoint(
        &self,
        request: &SetVersionCheckpointRequest,
    ) -> Result<VersionHistory, WorkspaceFailure>;

    /// Builds an exact, non-mutating cleanup preview.
    ///
    /// # Errors
    ///
    /// Returns a structured failure when the graph, policy, or head is invalid.
    fn preview_version_retention(
        &self,
        request: &PreviewVersionRetentionRequest,
    ) -> Result<VersionRetentionPreview, WorkspaceFailure>;

    /// Applies a still-current preview in one transaction.
    ///
    /// # Errors
    ///
    /// Returns without mutation when the preview or graph changed.
    fn apply_version_retention(
        &self,
        request: &ApplyVersionRetentionRequest,
    ) -> Result<ApplyVersionRetentionResult, WorkspaceFailure>;
}

/// Complete workspace backup and crash-recoverable restore boundary.
pub trait WorkspaceBackupPort {
    /// Lists committed local backup packages without reading payload contents.
    ///
    /// # Errors
    ///
    /// Returns a structured package or storage failure.
    fn list_workspace_backups(&self) -> Result<Vec<WorkspaceBackupSummary>, WorkspaceFailure>;

    /// Creates and verifies one complete portable backup package.
    ///
    /// # Errors
    ///
    /// Returns without publishing a partial package.
    fn create_workspace_backup(
        &self,
        request: &CreateWorkspaceBackupRequest,
    ) -> Result<CreateWorkspaceBackupResult, WorkspaceFailure>;

    /// Re-reads one package's complete checksum manifest.
    ///
    /// # Errors
    ///
    /// Returns a corruption failure without changing the package.
    fn verify_workspace_backup(
        &self,
        request: &VerifyWorkspaceBackupRequest,
    ) -> Result<VerifyWorkspaceBackupResult, WorkspaceFailure>;

    /// Stages a verified restore plus a safety backup for next launch.
    ///
    /// # Errors
    ///
    /// Returns without modifying the live workspace when preparation fails.
    fn prepare_workspace_restore(
        &self,
        request: &PrepareWorkspaceRestoreRequest,
    ) -> Result<PrepareWorkspaceRestoreResult, WorkspaceFailure>;
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

    /// Rescans Markdown and classifies changes against a bounded client baseline.
    ///
    /// Raw platform watcher events are intentionally not accepted here. They
    /// are only wake-up hints; this verified snapshot is the source of truth.
    ///
    /// # Errors
    ///
    /// Rejects duplicate identities, duplicate paths, excessive baselines, and
    /// propagates the adapter's structured snapshot failure.
    pub fn detect_changes(
        &self,
        request: &DetectWorkspaceChangesRequest,
    ) -> Result<WorkspaceChangesResult, WorkspaceFailure> {
        let snapshot = self.port.snapshot()?;
        let changes = compare_workspace(request, &snapshot)?;
        Ok(WorkspaceChangesResult { snapshot, changes })
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

    /// Returns resolved incoming Wiki references for one stable note.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured index, identity, or limit failure.
    pub fn backlinks(
        &self,
        request: &BacklinksRequest,
    ) -> Result<Vec<BacklinkReference>, WorkspaceFailure> {
        self.port.backlinks(request)
    }

    /// Resolves one authored Wiki target without guessing between duplicates.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured index, identity, or boundary failure.
    pub fn resolve_wiki_target(
        &self,
        request: &ResolveWikiTargetRequest,
    ) -> Result<WikiTargetResolution, WorkspaceFailure> {
        self.port.resolve_wiki_target(request)
    }

    /// Creates a still-missing Wiki target after confirming its exact path.
    ///
    /// # Errors
    ///
    /// Propagates structured revalidation, conflict, path, and storage failures.
    pub fn create_wiki_target(
        &self,
        request: &CreateWikiTargetRequest,
    ) -> Result<NoteDocument, WorkspaceFailure> {
        self.port.create_wiki_target(request)
    }

    /// Resolves one local attachment through the fixed workspace boundary.
    ///
    /// # Errors
    ///
    /// Propagates structured source, path, symlink, resource-budget, or I/O failures.
    pub fn resolve_attachment(
        &self,
        request: &ResolveAttachmentRequest,
    ) -> Result<AttachmentResolution, WorkspaceFailure> {
        self.port.resolve_attachment(request)
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

impl<P> WorkspaceApplication<P>
where
    P: VersionHistoryPort,
{
    /// Returns one note's durable local version graph.
    ///
    /// # Errors
    ///
    /// Propagates the adapter's structured history failure.
    pub fn version_history(
        &self,
        request: &VersionHistoryRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        self.port.version_history(request)
    }

    /// Creates a durable manual version or returns the identical current head.
    ///
    /// # Errors
    ///
    /// Propagates validation, concurrency, integrity, and storage failures.
    pub fn save_version(
        &self,
        request: &SaveVersionRequest,
    ) -> Result<SaveVersionResult, WorkspaceFailure> {
        self.port.save_version(request)
    }

    /// Reconstructs a version only after complete content verification.
    ///
    /// # Errors
    ///
    /// Propagates missing-node, manifest, decompression, and hash failures.
    pub fn read_version(
        &self,
        request: &ReadVersionRequest,
    ) -> Result<VersionContent, WorkspaceFailure> {
        self.port.read_version(request)
    }

    /// Changes the branch head with optimistic concurrency control.
    ///
    /// # Errors
    ///
    /// Propagates missing-node, note-identity, and head-conflict failures.
    pub fn checkout_version(
        &self,
        request: &CheckoutVersionRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        self.port.checkout_version(request)
    }

    /// Removes one exact node while keeping every surviving node recoverable.
    ///
    /// # Errors
    ///
    /// Propagates validation, concurrency, integrity, and storage failures.
    pub fn delete_version(
        &self,
        request: &DeleteVersionRequest,
    ) -> Result<DeleteVersionResult, WorkspaceFailure> {
        self.port.delete_version(request)
    }

    /// Names or removes one protected checkpoint.
    ///
    /// # Errors
    ///
    /// Propagates validation, concurrency, integrity, and storage failures.
    pub fn set_version_checkpoint(
        &self,
        request: &SetVersionCheckpointRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        self.port.set_version_checkpoint(request)
    }

    /// Builds an exact non-mutating cleanup preview.
    ///
    /// # Errors
    ///
    /// Propagates validation, concurrency, integrity, and storage failures.
    pub fn preview_version_retention(
        &self,
        request: &PreviewVersionRetentionRequest,
    ) -> Result<VersionRetentionPreview, WorkspaceFailure> {
        self.port.preview_version_retention(request)
    }

    /// Applies one still-current cleanup preview atomically.
    ///
    /// # Errors
    ///
    /// Propagates stale-preview, concurrency, integrity, and storage failures.
    pub fn apply_version_retention(
        &self,
        request: &ApplyVersionRetentionRequest,
    ) -> Result<ApplyVersionRetentionResult, WorkspaceFailure> {
        self.port.apply_version_retention(request)
    }
}

impl<P> WorkspaceApplication<P>
where
    P: WorkspaceBackupPort,
{
    /// Lists committed local backup packages.
    ///
    /// # Errors
    ///
    /// Propagates structured package and storage failures.
    pub fn list_workspace_backups(&self) -> Result<Vec<WorkspaceBackupSummary>, WorkspaceFailure> {
        self.port.list_workspace_backups()
    }

    /// Creates and verifies one complete workspace backup.
    ///
    /// # Errors
    ///
    /// Propagates structured validation, integrity, and storage failures.
    pub fn create_workspace_backup(
        &self,
        request: &CreateWorkspaceBackupRequest,
    ) -> Result<CreateWorkspaceBackupResult, WorkspaceFailure> {
        self.port.create_workspace_backup(request)
    }

    /// Re-reads every file in one backup package.
    ///
    /// # Errors
    ///
    /// Propagates structured integrity and storage failures.
    pub fn verify_workspace_backup(
        &self,
        request: &VerifyWorkspaceBackupRequest,
    ) -> Result<VerifyWorkspaceBackupResult, WorkspaceFailure> {
        self.port.verify_workspace_backup(request)
    }

    /// Stages a verified, restart-applied restore after a safety backup.
    ///
    /// # Errors
    ///
    /// Propagates structured integrity, pending-restore, and storage failures.
    pub fn prepare_workspace_restore(
        &self,
        request: &PrepareWorkspaceRestoreRequest,
    ) -> Result<PrepareWorkspaceRestoreResult, WorkspaceFailure> {
        self.port.prepare_workspace_restore(request)
    }
}

fn compare_workspace(
    request: &DetectWorkspaceChangesRequest,
    snapshot: &WorkspaceSnapshot,
) -> Result<Vec<WorkspaceChange>, WorkspaceFailure> {
    if request.notes.len() > MAX_CHANGE_BASELINE_NOTES {
        return Err(WorkspaceFailure::InvalidChangeBaseline {
            kind: "too_many_notes".to_owned(),
        });
    }

    let mut known_by_id = BTreeMap::new();
    let mut known_paths = BTreeSet::new();
    for note in &request.notes {
        if known_by_id.insert(note.id, note).is_some() {
            return Err(WorkspaceFailure::InvalidChangeBaseline {
                kind: "duplicate_id".to_owned(),
            });
        }
        if !known_paths.insert(note.path.clone()) {
            return Err(WorkspaceFailure::InvalidChangeBaseline {
                kind: "duplicate_path".to_owned(),
            });
        }
    }

    let mut current_ids = BTreeSet::new();
    let mut changes = Vec::new();
    for document in &snapshot.documents {
        current_ids.insert(document.id);
        let Some(known) = known_by_id.get(&document.id) else {
            changes.push(WorkspaceChange {
                kind: WorkspaceChangeKind::Created,
                id: document.id,
                previous_path: None,
                current_path: Some(document.path.clone()),
                current_title: Some(document.title.clone()),
                content_changed: true,
            });
            continue;
        };

        let moved = known.path != document.path;
        let content_changed = known.revision != document.revision;
        if moved {
            changes.push(WorkspaceChange {
                kind: WorkspaceChangeKind::Moved,
                id: document.id,
                previous_path: Some(known.path.clone()),
                current_path: Some(document.path.clone()),
                current_title: Some(document.title.clone()),
                content_changed,
            });
        } else if content_changed {
            changes.push(WorkspaceChange {
                kind: WorkspaceChangeKind::Modified,
                id: document.id,
                previous_path: Some(known.path.clone()),
                current_path: Some(document.path.clone()),
                current_title: Some(document.title.clone()),
                content_changed: true,
            });
        }
    }

    for known in &request.notes {
        if !current_ids.contains(&known.id) {
            changes.push(WorkspaceChange {
                kind: WorkspaceChangeKind::Deleted,
                id: known.id,
                previous_path: Some(known.path.clone()),
                current_path: None,
                current_title: None,
                content_changed: false,
            });
        }
    }

    changes.sort_by(|left, right| {
        let left_path = left
            .current_path
            .as_ref()
            .or(left.previous_path.as_ref())
            .map_or("", PortablePath::as_str);
        let right_path = right
            .current_path
            .as_ref()
            .or(right.previous_path.as_ref())
            .map_or("", PortablePath::as_str);
        left_path.cmp(right_path).then(left.id.cmp(&right.id))
    });
    Ok(changes)
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
        AttachmentReferenceKind, AttachmentResolution, AttachmentResolutionState, BacklinksRequest,
        CreateNoteRequest, CreateWikiTargetRequest, DetectWorkspaceChangesRequest, FileRevision,
        KnownNoteState, LineEnding, NoteDocument, RenameNoteRequest, ResolveAttachmentRequest,
        ResolveWikiTargetRequest, SaveNoteRequest, SaveNoteResult, WikiTargetResolution,
        WikiTargetResolutionState, WorkspaceApplication, WorkspaceChangeKind, WorkspaceFailure,
        WorkspacePort, WorkspaceSnapshot,
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

        fn backlinks(
            &self,
            _: &BacklinksRequest,
        ) -> Result<Vec<super::BacklinkReference>, WorkspaceFailure> {
            self.calls.borrow_mut().push("backlinks");
            Ok(Vec::new())
        }

        fn resolve_wiki_target(
            &self,
            request: &ResolveWikiTargetRequest,
        ) -> Result<WikiTargetResolution, WorkspaceFailure> {
            self.calls.borrow_mut().push("resolve_wiki_target");
            Ok(WikiTargetResolution {
                raw_target: request.raw_target.trim().to_owned(),
                state: WikiTargetResolutionState::Resolved,
                target: Some(super::ResolvedWikiTargetNote {
                    id: self.document.id,
                    title: self.document.title.clone(),
                    path: self.document.path.clone(),
                    kind: self.document.kind,
                }),
                heading: Some("规则".to_owned()),
                creation: None,
            })
        }

        fn create_wiki_target(
            &self,
            _: &CreateWikiTargetRequest,
        ) -> Result<NoteDocument, WorkspaceFailure> {
            self.calls.borrow_mut().push("create_wiki_target");
            Ok(self.document.clone())
        }

        fn resolve_attachment(
            &self,
            request: &ResolveAttachmentRequest,
        ) -> Result<AttachmentResolution, WorkspaceFailure> {
            self.calls.borrow_mut().push("resolve_attachment");
            Ok(AttachmentResolution {
                raw_target: request.raw_target.trim().to_owned(),
                recognized_attachment: true,
                state: AttachmentResolutionState::Missing,
                content: None,
            })
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

    fn document_with(id: NoteId, path: &str, revision: &str) -> NoteDocument {
        NoteDocument {
            id,
            title: path.to_owned(),
            path: PortablePath::new_markdown(path).unwrap(),
            kind: NoteKind::Note,
            markdown: format!("# {path}\n"),
            revision: FileRevision::new(revision),
            line_ending: LineEnding::Lf,
            has_utf8_bom: false,
            modified_at_millis: 0,
        }
    }

    fn known(document: &NoteDocument) -> KnownNoteState {
        KnownNoteState {
            id: document.id,
            path: document.path.clone(),
            revision: document.revision.clone(),
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
        assert!(
            application
                .backlinks(&BacklinksRequest {
                    note_id: document.id,
                    limit: 20,
                })
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            application
                .resolve_wiki_target(&ResolveWikiTargetRequest {
                    source_note_id: document.id,
                    raw_target: " Ownership#规则 ".to_owned(),
                })
                .unwrap()
                .state,
            WikiTargetResolutionState::Resolved
        );
        assert_eq!(
            application
                .create_wiki_target(&CreateWikiTargetRequest {
                    source_note_id: document.id,
                    raw_target: "Ownership".to_owned(),
                    expected_path: document.path.clone(),
                })
                .unwrap(),
            document
        );
        assert_eq!(
            application
                .resolve_attachment(&ResolveAttachmentRequest {
                    source_note_id: document.id,
                    raw_target: "diagram.png".to_owned(),
                    reference_kind: AttachmentReferenceKind::MarkdownImage,
                })
                .unwrap()
                .state,
            AttachmentResolutionState::Missing
        );
        assert_eq!(
            application.port.calls.into_inner(),
            [
                "snapshot",
                "create",
                "save",
                "backlinks",
                "resolve_wiki_target",
                "create_wiki_target",
                "resolve_attachment"
            ]
        );
    }

    #[test]
    fn verified_rescan_classifies_create_modify_delete_and_move_by_stable_identity() {
        let modified_id = NoteId::from_bytes([1; 16]);
        let moved_id = NoteId::from_bytes([2; 16]);
        let deleted_id = NoteId::from_bytes([3; 16]);
        let created_id = NoteId::from_bytes([4; 16]);
        let modified_before = document_with(modified_id, "topics/modified.md", "old");
        let moved_before = document_with(moved_id, "topics/before.md", "same");
        let deleted_before = document_with(deleted_id, "topics/deleted.md", "old");
        let snapshot = WorkspaceSnapshot {
            root_display: "test-workspace".to_owned(),
            documents: vec![
                document_with(moved_id, "topics/after.md", "same"),
                document_with(created_id, "topics/created.md", "new"),
                document_with(modified_id, "topics/modified.md", "new"),
            ],
            index: super::IndexStatus {
                state: super::IndexState::Ready,
                schema_version: 1,
                note_count: 3,
                issue: None,
            },
        };
        let request = DetectWorkspaceChangesRequest {
            notes: vec![
                known(&modified_before),
                known(&moved_before),
                known(&deleted_before),
            ],
        };

        let changes = super::compare_workspace(&request, &snapshot).unwrap();
        assert_eq!(changes.len(), 4);
        assert_eq!(changes[0].kind, WorkspaceChangeKind::Moved);
        assert_eq!(
            changes[0].previous_path.as_ref().unwrap().as_str(),
            "topics/before.md"
        );
        assert_eq!(
            changes[0].current_path.as_ref().unwrap().as_str(),
            "topics/after.md"
        );
        assert!(!changes[0].content_changed);
        assert_eq!(changes[1].kind, WorkspaceChangeKind::Created);
        assert_eq!(changes[2].kind, WorkspaceChangeKind::Deleted);
        assert_eq!(changes[3].kind, WorkspaceChangeKind::Modified);
    }

    #[test]
    fn verified_rescan_rejects_ambiguous_client_baselines() {
        let document = document_with(NoteId::from_bytes([7; 16]), "topics/one.md", "old");
        let duplicate_id = DetectWorkspaceChangesRequest {
            notes: vec![known(&document), known(&document)],
        };
        let snapshot = WorkspaceSnapshot {
            root_display: "test-workspace".to_owned(),
            documents: vec![document.clone()],
            index: super::IndexStatus {
                state: super::IndexState::Ready,
                schema_version: 1,
                note_count: 1,
                issue: None,
            },
        };

        assert_eq!(
            super::compare_workspace(&duplicate_id, &snapshot),
            Err(WorkspaceFailure::InvalidChangeBaseline {
                kind: "duplicate_id".to_owned(),
            })
        );

        let duplicate_path = DetectWorkspaceChangesRequest {
            notes: vec![
                known(&document),
                KnownNoteState {
                    id: NoteId::from_bytes([8; 16]),
                    path: document.path.clone(),
                    revision: document.revision.clone(),
                },
            ],
        };
        assert_eq!(
            super::compare_workspace(&duplicate_path, &snapshot),
            Err(WorkspaceFailure::InvalidChangeBaseline {
                kind: "duplicate_path".to_owned(),
            })
        );

        let too_many = DetectWorkspaceChangesRequest {
            notes: vec![known(&document); super::MAX_CHANGE_BASELINE_NOTES + 1],
        };
        assert_eq!(
            super::compare_workspace(&too_many, &snapshot),
            Err(WorkspaceFailure::InvalidChangeBaseline {
                kind: "too_many_notes".to_owned(),
            })
        );
    }
}
