use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    str::FromStr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use fastcdc::v2020::FastCDC;
use rusqlite::{
    Connection, Error as SqliteError, ErrorCode, OpenFlags, OptionalExtension, Transaction,
    TransactionBehavior, params,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zhiweave_application::{
    ApplyVersionRetentionRequest, ApplyVersionRetentionResult, CheckoutVersionRequest,
    DeleteVersionRequest, DeleteVersionResult, PreviewVersionRetentionRequest, ReadVersionRequest,
    SaveVersionRequest, SaveVersionResult, SetVersionCheckpointRequest, VersionContent,
    VersionHistory, VersionHistoryRequest, VersionHistoryStats, VersionNode,
    VersionRetentionPolicy, VersionRetentionPreview, WorkspaceFailure,
};
use zhiweave_domain::NoteId;

use crate::MAX_NOTE_BYTES;

const HISTORY_FILE_NAME: &str = "history.sqlite3";
const HISTORY_APPLICATION_ID: i32 = 0x5a48_4856;
const HISTORY_SCHEMA_VERSION: u32 = 2;
const MAX_VERSIONS_PER_NOTE: usize = 10_000;
const MAX_TITLE_CHARS: usize = 200;
const MAX_MESSAGE_CHARS: usize = 200;
const MAX_CHECKPOINT_NAME_CHARS: usize = 80;
const MAX_RETENTION_KEEP_LATEST: u16 = 1_000;
const MAX_RETENTION_KEEP_DAYS: u16 = 3_650;
const MILLIS_PER_DAY: u64 = 86_400_000;
const MAX_TIMESTAMP_MILLIS: u64 = 8_640_000_000_000_000;
const CHUNK_MIN_BYTES: usize = 256;
const CHUNK_AVERAGE_BYTES: usize = 1_024;
const CHUNK_MAX_BYTES: usize = 4_096;
const CHUNK_MAX_COMPRESSED_BYTES: usize = 8_192;
const ZSTD_LEVEL: i32 = 3;

pub(crate) struct SqliteHistory {
    path: PathBuf,
}

#[derive(Debug)]
struct PreparedChunk {
    hash: String,
    raw_length: usize,
    compressed: Vec<u8>,
}

#[derive(Debug)]
struct RawVersionNode {
    id: String,
    note_id: String,
    note_title: String,
    parent_id: Option<String>,
    content_hash: String,
    content_length: i64,
    created_at_millis: i64,
    message: Option<String>,
    checkpoint_name: Option<String>,
}

impl SqliteHistory {
    pub(crate) fn new(metadata_directory: &Path) -> Self {
        Self {
            path: metadata_directory.join(HISTORY_FILE_NAME),
        }
    }

    pub(crate) fn history(
        &self,
        request: &VersionHistoryRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        let connection = open_history(&self.path)?;
        build_history(&connection, request.note_id)
    }

    pub(crate) fn export_snapshot(&self, destination: &Path) -> Result<usize, WorkspaceFailure> {
        if destination.exists() {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "historySnapshotDestinationExists".to_owned(),
            });
        }
        let connection = open_history(&self.path)?;
        checkpoint(&connection)?;
        connection
            .execute(
                "VACUUM main INTO ?1",
                [destination.to_string_lossy().as_ref()],
            )
            .map_err(|error| history_sqlite_failure("exportHistorySnapshot", &error))?;
        verify_exported_history(destination)
    }

    pub(crate) fn save(
        &self,
        request: &SaveVersionRequest,
    ) -> Result<SaveVersionResult, WorkspaceFailure> {
        let (title, message, bytes) = validate_save_request(request)?;
        let content_hash = digest_hex(bytes);
        let chunks = prepare_chunks(bytes)?;
        let mut connection = open_history(&self.path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| history_sqlite_failure("beginVersionSave", &error))?;
        let actual_head = current_head(&transaction, request.note_id)?;
        require_expected_head(
            request.note_id,
            request.expected_head.as_deref(),
            actual_head.as_deref(),
        )?;
        build_history(&transaction, request.note_id)?;

        if let Some(head) = actual_head.as_deref() {
            let node = load_version_node(&transaction, head)?;
            if node.content_hash == content_hash && node.content_length == bytes.len() as u64 {
                drop(transaction);
                self.read(&ReadVersionRequest {
                    version_id: head.to_owned(),
                })?;
                let history = build_history(&connection, request.note_id)?;
                return Ok(SaveVersionResult {
                    node,
                    created: false,
                    history,
                });
            }
        }

        let version_count = note_version_count(&transaction, request.note_id)?;
        if version_count >= MAX_VERSIONS_PER_NOTE {
            return Err(WorkspaceFailure::LimitExceeded {
                limit: format!("{MAX_VERSIONS_PER_NOTE} versions per note"),
            });
        }

        let id = Uuid::now_v7().to_string();
        let created_at_millis = now_millis()?;
        transaction
            .execute(
                "INSERT INTO version_node(
                    version_id, note_id, note_title, parent_id, content_hash,
                    content_length, created_at_millis, message
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    request.note_id.to_string(),
                    title,
                    actual_head,
                    content_hash,
                    i64::try_from(bytes.len()).map_err(|_| invalid("contentTooLarge"))?,
                    i64::try_from(created_at_millis)
                        .map_err(|_| history_corrupt("timestampOutOfRange"))?,
                    message,
                ],
            )
            .map_err(|error| history_sqlite_failure("insertVersionNode", &error))?;

        for (ordinal, chunk) in chunks.iter().enumerate() {
            insert_or_verify_chunk(&transaction, chunk)?;
            transaction
                .execute(
                    "INSERT INTO version_manifest(version_id, ordinal, chunk_hash)
                     VALUES (?1, ?2, ?3)",
                    params![
                        id,
                        i64::try_from(ordinal)
                            .map_err(|_| history_corrupt("chunkOrdinalOutOfRange"))?,
                        chunk.hash,
                    ],
                )
                .map_err(|error| history_sqlite_failure("insertVersionManifest", &error))?;
        }
        transaction
            .execute(
                "INSERT INTO version_head(note_id, version_id) VALUES (?1, ?2)
                 ON CONFLICT(note_id) DO UPDATE SET version_id = excluded.version_id",
                params![request.note_id.to_string(), id],
            )
            .map_err(|error| history_sqlite_failure("updateVersionHead", &error))?;
        transaction
            .commit()
            .map_err(|error| history_sqlite_failure("commitVersionSave", &error))?;
        checkpoint(&connection)?;

        let node = load_version_node(&connection, &id)?;
        let history = build_history(&connection, request.note_id)?;
        Ok(SaveVersionResult {
            node,
            created: true,
            history,
        })
    }

    pub(crate) fn read(
        &self,
        request: &ReadVersionRequest,
    ) -> Result<VersionContent, WorkspaceFailure> {
        validate_version_id(&request.version_id)?;
        let connection = open_history(&self.path)?;
        read_version_from_connection(&connection, &request.version_id)
    }

    pub(crate) fn checkout(
        &self,
        request: &CheckoutVersionRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        validate_version_id(&request.version_id)?;
        if let Some(expected_head) = request.expected_head.as_deref() {
            validate_version_id(expected_head)?;
        }
        self.read(&ReadVersionRequest {
            version_id: request.version_id.clone(),
        })?;
        let mut connection = open_history(&self.path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| history_sqlite_failure("beginVersionCheckout", &error))?;
        let actual_head = current_head(&transaction, request.note_id)?;
        require_expected_head(
            request.note_id,
            request.expected_head.as_deref(),
            actual_head.as_deref(),
        )?;
        build_history(&transaction, request.note_id)?;
        let node = load_version_node(&transaction, &request.version_id)?;
        if node.note_id != request.note_id {
            return Err(invalid("versionBelongsToAnotherNote"));
        }
        transaction
            .execute(
                "INSERT INTO version_head(note_id, version_id) VALUES (?1, ?2)
                 ON CONFLICT(note_id) DO UPDATE SET version_id = excluded.version_id",
                params![request.note_id.to_string(), request.version_id],
            )
            .map_err(|error| history_sqlite_failure("checkoutVersionHead", &error))?;
        transaction
            .commit()
            .map_err(|error| history_sqlite_failure("commitVersionCheckout", &error))?;
        checkpoint(&connection)?;
        build_history(&connection, request.note_id)
    }

    pub(crate) fn delete(
        &self,
        request: &DeleteVersionRequest,
    ) -> Result<DeleteVersionResult, WorkspaceFailure> {
        validate_version_id(&request.version_id)?;
        if let Some(expected_head) = request.expected_head.as_deref() {
            validate_version_id(expected_head)?;
        }
        let mut connection = open_history(&self.path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| history_sqlite_failure("beginVersionDelete", &error))?;
        let actual_head = current_head(&transaction, request.note_id)?;
        require_expected_head(
            request.note_id,
            request.expected_head.as_deref(),
            actual_head.as_deref(),
        )?;
        build_history(&transaction, request.note_id)?;
        let target = load_version_node(&transaction, &request.version_id)?;
        if target.note_id != request.note_id {
            return Err(invalid("versionBelongsToAnotherNote"));
        }

        transaction
            .execute(
                "UPDATE version_node SET parent_id = ?1 WHERE parent_id = ?2",
                params![target.parent_id, request.version_id],
            )
            .map_err(|error| history_sqlite_failure("reparentVersionChildren", &error))?;
        if actual_head.as_deref() == Some(request.version_id.as_str()) {
            if let Some(parent_id) = target.parent_id.as_deref() {
                transaction
                    .execute(
                        "UPDATE version_head SET version_id = ?1 WHERE note_id = ?2",
                        params![parent_id, request.note_id.to_string()],
                    )
                    .map_err(|error| history_sqlite_failure("rewindDeletedHead", &error))?;
            } else {
                transaction
                    .execute(
                        "DELETE FROM version_head WHERE note_id = ?1",
                        [request.note_id.to_string()],
                    )
                    .map_err(|error| history_sqlite_failure("clearDeletedHead", &error))?;
            }
        }
        transaction
            .execute(
                "DELETE FROM version_node WHERE version_id = ?1",
                [&request.version_id],
            )
            .map_err(|error| history_sqlite_failure("deleteVersionNode", &error))?;

        let released_bytes = orphan_chunk_bytes(&transaction)?;
        transaction
            .execute(
                "DELETE FROM version_chunk
                 WHERE NOT EXISTS (
                    SELECT 1 FROM version_manifest
                    WHERE version_manifest.chunk_hash = version_chunk.chunk_hash
                 )",
                [],
            )
            .map_err(|error| history_sqlite_failure("collectVersionChunks", &error))?;
        transaction
            .commit()
            .map_err(|error| history_sqlite_failure("commitVersionDelete", &error))?;
        checkpoint(&connection)?;
        let history = build_history(&connection, request.note_id)?;
        Ok(DeleteVersionResult {
            history,
            released_bytes,
        })
    }

    pub(crate) fn set_checkpoint(
        &self,
        request: &SetVersionCheckpointRequest,
    ) -> Result<VersionHistory, WorkspaceFailure> {
        validate_version_id(&request.version_id)?;
        if let Some(expected_head) = request.expected_head.as_deref() {
            validate_version_id(expected_head)?;
        }
        let checkpoint_name = validate_checkpoint_name(request.checkpoint_name.as_deref())?;
        self.read(&ReadVersionRequest {
            version_id: request.version_id.clone(),
        })?;

        let mut connection = open_history(&self.path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| history_sqlite_failure("beginSetVersionCheckpoint", &error))?;
        let actual_head = current_head(&transaction, request.note_id)?;
        require_expected_head(
            request.note_id,
            request.expected_head.as_deref(),
            actual_head.as_deref(),
        )?;
        build_history(&transaction, request.note_id)?;
        let node = load_version_node(&transaction, &request.version_id)?;
        if node.note_id != request.note_id {
            return Err(invalid("versionBelongsToAnotherNote"));
        }
        if let Some(name) = checkpoint_name.as_deref() {
            let duplicate = transaction
                .query_row(
                    "SELECT 1 FROM version_node
                     WHERE note_id = ?1 AND checkpoint_name = ?2 AND version_id <> ?3
                     LIMIT 1",
                    params![request.note_id.to_string(), name, request.version_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| history_sqlite_failure("checkVersionCheckpointName", &error))?
                .is_some();
            if duplicate {
                return Err(invalid("checkpointNameAlreadyExists"));
            }
        }
        transaction
            .execute(
                "UPDATE version_node SET checkpoint_name = ?1 WHERE version_id = ?2",
                params![checkpoint_name, request.version_id],
            )
            .map_err(|error| history_sqlite_failure("setVersionCheckpoint", &error))?;
        transaction
            .commit()
            .map_err(|error| history_sqlite_failure("commitVersionCheckpoint", &error))?;
        checkpoint(&connection)?;
        build_history(&connection, request.note_id)
    }

    pub(crate) fn preview_retention(
        &self,
        request: &PreviewVersionRetentionRequest,
    ) -> Result<VersionRetentionPreview, WorkspaceFailure> {
        validate_retention_policy(request.policy)?;
        if let Some(expected_head) = request.expected_head.as_deref() {
            validate_version_id(expected_head)?;
        }
        let now = now_millis()?;
        let cutoff_at_millis = retention_cutoff(now, request.policy.keep_days);
        let connection = open_history(&self.path)?;
        build_retention_preview(
            &connection,
            request.note_id,
            request.expected_head.as_deref(),
            request.policy,
            cutoff_at_millis,
        )
    }

    pub(crate) fn apply_retention(
        &self,
        request: &ApplyVersionRetentionRequest,
    ) -> Result<ApplyVersionRetentionResult, WorkspaceFailure> {
        validate_retention_policy(request.policy)?;
        if let Some(expected_head) = request.expected_head.as_deref() {
            validate_version_id(expected_head)?;
        }
        if !is_digest(&request.preview_token) {
            return Err(invalid("invalidRetentionPreviewToken"));
        }
        if request.cutoff_at_millis > now_millis()? {
            return Err(invalid("retentionCutoffInFuture"));
        }

        let mut connection = open_history(&self.path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| history_sqlite_failure("beginVersionRetention", &error))?;
        let preview = build_retention_preview(
            &transaction,
            request.note_id,
            request.expected_head.as_deref(),
            request.policy,
            request.cutoff_at_millis,
        )?;
        if preview.preview_token != request.preview_token {
            return Err(invalid("staleRetentionPreview"));
        }
        if preview.candidates.is_empty() {
            transaction
                .commit()
                .map_err(|error| history_sqlite_failure("commitEmptyVersionRetention", &error))?;
            return Ok(ApplyVersionRetentionResult {
                history: build_history(&connection, request.note_id)?,
                deleted_versions: 0,
                released_bytes: 0,
            });
        }

        let (history, released_bytes) =
            delete_retention_candidates(&transaction, request.note_id, &preview)?;
        transaction
            .commit()
            .map_err(|error| history_sqlite_failure("commitVersionRetention", &error))?;
        checkpoint(&connection)?;
        Ok(ApplyVersionRetentionResult {
            history,
            deleted_versions: preview.candidates.len(),
            released_bytes,
        })
    }
}

fn delete_retention_candidates(
    connection: &Connection,
    note_id: NoteId,
    preview: &VersionRetentionPreview,
) -> Result<(VersionHistory, u64), WorkspaceFailure> {
    let history = build_history(connection, note_id)?;
    let candidates = preview
        .candidates
        .iter()
        .map(|node| node.id.as_str())
        .collect::<BTreeSet<_>>();
    let parents = history
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node.parent_id.as_deref()))
        .collect::<BTreeMap<_, _>>();

    for node in history
        .nodes
        .iter()
        .filter(|node| !candidates.contains(node.id.as_str()))
    {
        let Some(parent_id) = node.parent_id.as_deref() else {
            continue;
        };
        if !candidates.contains(parent_id) {
            continue;
        }
        let retained_parent = nearest_retained_parent(parent_id, &parents, &candidates)?;
        connection
            .execute(
                "UPDATE version_node SET parent_id = ?1 WHERE version_id = ?2",
                params![retained_parent, node.id],
            )
            .map_err(|error| history_sqlite_failure("reparentRetainedVersionNode", &error))?;
    }
    for candidate in &preview.candidates {
        connection
            .execute(
                "UPDATE version_node SET parent_id = NULL WHERE version_id = ?1",
                [&candidate.id],
            )
            .map_err(|error| history_sqlite_failure("detachRetentionCandidate", &error))?;
    }
    for candidate in &preview.candidates {
        connection
            .execute(
                "DELETE FROM version_node WHERE version_id = ?1",
                [&candidate.id],
            )
            .map_err(|error| history_sqlite_failure("deleteRetentionCandidate", &error))?;
    }

    let released_bytes = orphan_chunk_bytes(connection)?;
    if released_bytes != preview.released_bytes {
        return Err(history_corrupt("retentionReleasedBytesChanged"));
    }
    connection
        .execute(
            "DELETE FROM version_chunk
             WHERE NOT EXISTS (
                SELECT 1 FROM version_manifest
                WHERE version_manifest.chunk_hash = version_chunk.chunk_hash
             )",
            [],
        )
        .map_err(|error| history_sqlite_failure("collectRetentionChunks", &error))?;
    Ok((build_history(connection, note_id)?, released_bytes))
}

pub(crate) fn verify_exported_history(path: &Path) -> Result<usize, WorkspaceFailure> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| history_io("inspectExportedHistory", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "historySnapshotFileType".to_owned(),
        });
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| history_sqlite_failure("openExportedHistory", &error))?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| history_sqlite_failure("enableExportedHistoryForeignKeys", &error))?;
    let application_id: i32 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|error| history_sqlite_failure("readExportedHistoryApplicationId", &error))?;
    if application_id != HISTORY_APPLICATION_ID {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "foreignHistorySnapshot".to_owned(),
        });
    }
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| history_sqlite_failure("readExportedHistorySchema", &error))?;
    if version != HISTORY_SCHEMA_VERSION {
        return Err(WorkspaceFailure::BackupCorrupt {
            kind: "unsupportedHistorySnapshotSchema".to_owned(),
        });
    }
    verify_integrity(&connection)?;
    verify_schema(&connection)?;
    let mut statement = connection
        .prepare("SELECT version_id FROM version_node ORDER BY version_id")
        .map_err(|error| history_sqlite_failure("prepareExportedHistoryVersions", &error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| history_sqlite_failure("queryExportedHistoryVersions", &error))?;
    let mut count = 0_usize;
    for row in rows {
        let version_id =
            row.map_err(|error| history_sqlite_failure("readExportedHistoryVersion", &error))?;
        validate_version_id(&version_id).map_err(|_| WorkspaceFailure::BackupCorrupt {
            kind: "invalidHistorySnapshotVersionId".to_owned(),
        })?;
        read_version_from_connection(&connection, &version_id)?;
        count = count
            .checked_add(1)
            .ok_or_else(|| history_corrupt("versionCountOutOfRange"))?;
        if count > MAX_VERSIONS_PER_NOTE.saturating_mul(10_000) {
            return Err(WorkspaceFailure::BackupCorrupt {
                kind: "historySnapshotVersionCountOutOfRange".to_owned(),
            });
        }
    }
    Ok(count)
}

fn open_history(path: &Path) -> Result<Connection, WorkspaceFailure> {
    let existed = match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(history_corrupt("historyFileType"));
        }
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(history_io("inspectHistory", &error)),
    };
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| history_sqlite_failure("openHistory", &error))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| history_sqlite_failure("configureHistoryBusyTimeout", &error))?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| history_sqlite_failure("enableHistoryForeignKeys", &error))?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|error| history_sqlite_failure("configureHistoryDurability", &error))?;

    let application_id: i32 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|error| history_sqlite_failure("readHistoryApplicationId", &error))?;
    if existed && application_id != HISTORY_APPLICATION_ID {
        return Err(history_corrupt("foreignHistoryDatabase"));
    }
    if !existed {
        connection
            .pragma_update(None, "application_id", HISTORY_APPLICATION_ID)
            .map_err(|error| history_sqlite_failure("writeHistoryApplicationId", &error))?;
    }

    verify_integrity(&connection)?;
    migrate(&connection)?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| history_sqlite_failure("enableHistoryWal", &error))?;
    connection
        .pragma_update(None, "wal_autocheckpoint", 1_000)
        .map_err(|error| history_sqlite_failure("configureHistoryCheckpoint", &error))?;
    verify_schema(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), WorkspaceFailure> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| history_sqlite_failure("readHistorySchemaVersion", &error))?;
    if version > HISTORY_SCHEMA_VERSION {
        return Err(WorkspaceFailure::HistorySchemaTooNew {
            found: version,
            supported: HISTORY_SCHEMA_VERSION,
        });
    }
    if version == HISTORY_SCHEMA_VERSION {
        return Ok(());
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| history_sqlite_failure("beginHistoryMigration", &error))?;
    if version == 0 {
        transaction
            .execute_batch(
                "CREATE TABLE version_node (
                    version_id TEXT PRIMARY KEY NOT NULL,
                    note_id TEXT NOT NULL,
                    note_title TEXT NOT NULL,
                    parent_id TEXT REFERENCES version_node(version_id)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                    content_hash TEXT NOT NULL,
                    content_length INTEGER NOT NULL CHECK(content_length >= 0),
                    created_at_millis INTEGER NOT NULL CHECK(created_at_millis >= 0),
                    message TEXT,
                    checkpoint_name TEXT
                        CHECK(checkpoint_name IS NULL OR length(checkpoint_name) BETWEEN 1 AND 80)
                ) STRICT;
                CREATE INDEX version_node_note_time
                    ON version_node(note_id, created_at_millis DESC, version_id DESC);
                CREATE INDEX version_node_parent ON version_node(parent_id);
                CREATE UNIQUE INDEX version_node_checkpoint
                    ON version_node(note_id, checkpoint_name)
                    WHERE checkpoint_name IS NOT NULL;
                CREATE TABLE version_chunk (
                    chunk_hash TEXT PRIMARY KEY NOT NULL,
                    raw_length INTEGER NOT NULL CHECK(raw_length > 0 AND raw_length <= 4096),
                    compressed BLOB NOT NULL
                        CHECK(length(compressed) > 0 AND length(compressed) <= 8192)
                ) STRICT;
                CREATE TABLE version_manifest (
                    version_id TEXT NOT NULL REFERENCES version_node(version_id)
                        ON DELETE CASCADE,
                    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
                    chunk_hash TEXT NOT NULL REFERENCES version_chunk(chunk_hash)
                        ON DELETE RESTRICT,
                    PRIMARY KEY(version_id, ordinal)
                ) STRICT, WITHOUT ROWID;
                CREATE INDEX version_manifest_chunk ON version_manifest(chunk_hash);
                CREATE TABLE version_head (
                    note_id TEXT PRIMARY KEY NOT NULL,
                    version_id TEXT NOT NULL REFERENCES version_node(version_id)
                        ON DELETE RESTRICT
                ) STRICT, WITHOUT ROWID;",
            )
            .map_err(|error| history_sqlite_failure("migrateHistorySchemaV2", &error))?;
        transaction
            .pragma_update(None, "user_version", HISTORY_SCHEMA_VERSION)
            .map_err(|error| history_sqlite_failure("recordHistorySchemaVersion", &error))?;
    } else if version == 1 {
        transaction
            .execute_batch(
                "ALTER TABLE version_node ADD COLUMN checkpoint_name TEXT
                    CHECK(checkpoint_name IS NULL OR length(checkpoint_name) BETWEEN 1 AND 80);
                 CREATE UNIQUE INDEX version_node_checkpoint
                    ON version_node(note_id, checkpoint_name)
                    WHERE checkpoint_name IS NOT NULL;",
            )
            .map_err(|error| history_sqlite_failure("migrateHistorySchemaV2", &error))?;
        transaction
            .pragma_update(None, "user_version", HISTORY_SCHEMA_VERSION)
            .map_err(|error| history_sqlite_failure("recordHistorySchemaVersion", &error))?;
    }
    transaction
        .commit()
        .map_err(|error| history_sqlite_failure("commitHistoryMigration", &error))
}

fn verify_schema(connection: &Connection) -> Result<(), WorkspaceFailure> {
    for table in [
        "version_node",
        "version_chunk",
        "version_manifest",
        "version_head",
    ] {
        let exists = connection
            .query_row(
                "SELECT 1 FROM sqlite_schema WHERE name = ?1 AND type = 'table' LIMIT 1",
                [table],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| history_sqlite_failure("verifyHistorySchema", &error))?
            .is_some();
        if !exists {
            return Err(history_corrupt("missingHistorySchemaObject"));
        }
    }
    let invalid_chunk = connection
        .query_row(
            "SELECT 1 FROM version_chunk
             WHERE raw_length <= 0 OR raw_length > 4096
                OR length(compressed) <= 0 OR length(compressed) > 8192
             LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| history_sqlite_failure("verifyHistoryChunkBounds", &error))?
        .is_some();
    if invalid_chunk {
        return Err(history_corrupt("chunkStorageOutOfRange"));
    }
    let missing_checkpoint_column = connection
        .prepare("SELECT checkpoint_name FROM version_node LIMIT 0")
        .is_err();
    if missing_checkpoint_column {
        return Err(history_corrupt("missingHistoryCheckpointColumn"));
    }
    Ok(())
}

fn verify_integrity(connection: &Connection) -> Result<(), WorkspaceFailure> {
    let result: String = connection
        .pragma_query_value(None, "quick_check", |row| row.get(0))
        .map_err(|error| history_sqlite_failure("historyQuickCheck", &error))?;
    if result != "ok" {
        return Err(history_corrupt("historyQuickCheckFailed"));
    }
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| history_sqlite_failure("prepareHistoryForeignKeyCheck", &error))?;
    let mut rows = statement
        .query([])
        .map_err(|error| history_sqlite_failure("runHistoryForeignKeyCheck", &error))?;
    if rows
        .next()
        .map_err(|error| history_sqlite_failure("readHistoryForeignKeyCheck", &error))?
        .is_some()
    {
        return Err(history_corrupt("historyForeignKeyCheckFailed"));
    }
    Ok(())
}

fn checkpoint(connection: &Connection) -> Result<(), WorkspaceFailure> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .map_err(|error| history_sqlite_failure("checkpointHistory", &error))
}

fn validate_save_request(
    request: &SaveVersionRequest,
) -> Result<(&str, Option<String>, &[u8]), WorkspaceFailure> {
    let title = request.note_title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid("invalidTitle"));
    }
    if request.markdown.contains('\r') {
        return Err(invalid("nonNormalizedMarkdown"));
    }
    let bytes = request.markdown.as_bytes();
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_NOTE_BYTES {
        return Err(WorkspaceFailure::TooLarge {
            path: "version".to_owned(),
            limit_bytes: MAX_NOTE_BYTES,
        });
    }
    let message = request
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if message
        .as_deref()
        .is_some_and(|value| value.chars().count() > MAX_MESSAGE_CHARS)
    {
        return Err(invalid("messageTooLong"));
    }
    if let Some(head) = request.expected_head.as_deref() {
        validate_version_id(head)?;
    }
    Ok((title, message, bytes))
}

fn prepare_chunks(content: &[u8]) -> Result<Vec<PreparedChunk>, WorkspaceFailure> {
    FastCDC::new(
        content,
        CHUNK_MIN_BYTES,
        CHUNK_AVERAGE_BYTES,
        CHUNK_MAX_BYTES,
    )
    .map(|chunk| {
        let bytes = &content[chunk.offset..chunk.offset + chunk.length];
        let compressed = zstd::bulk::compress(bytes, ZSTD_LEVEL)
            .map_err(|error| history_io("compressVersionChunk", &error))?;
        if compressed.is_empty() || compressed.len() > CHUNK_MAX_COMPRESSED_BYTES {
            return Err(history_corrupt("compressedChunkLengthOutOfRange"));
        }
        Ok(PreparedChunk {
            hash: digest_hex(bytes),
            raw_length: bytes.len(),
            compressed,
        })
    })
    .collect()
}

fn insert_or_verify_chunk(
    transaction: &Transaction<'_>,
    chunk: &PreparedChunk,
) -> Result<(), WorkspaceFailure> {
    let inserted = transaction
        .execute(
            "INSERT OR IGNORE INTO version_chunk(chunk_hash, raw_length, compressed)
             VALUES (?1, ?2, ?3)",
            params![
                chunk.hash,
                i64::try_from(chunk.raw_length)
                    .map_err(|_| history_corrupt("chunkLengthOutOfRange"))?,
                chunk.compressed,
            ],
        )
        .map_err(|error| history_sqlite_failure("insertVersionChunk", &error))?;
    if inserted == 1 {
        return Ok(());
    }
    let (raw_length, compressed): (i64, Vec<u8>) = transaction
        .query_row(
            "SELECT raw_length, compressed FROM version_chunk WHERE chunk_hash = ?1",
            [&chunk.hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| history_sqlite_failure("readExistingVersionChunk", &error))?;
    let raw_length =
        usize::try_from(raw_length).map_err(|_| history_corrupt("chunkLengthOutOfRange"))?;
    verify_chunk(&chunk.hash, raw_length, &compressed)?;
    Ok(())
}

fn verify_chunk(
    hash: &str,
    raw_length: usize,
    compressed: &[u8],
) -> Result<Vec<u8>, WorkspaceFailure> {
    if raw_length == 0
        || raw_length > CHUNK_MAX_BYTES
        || compressed.is_empty()
        || compressed.len() > CHUNK_MAX_COMPRESSED_BYTES
    {
        return Err(history_corrupt("chunkLengthOutOfRange"));
    }
    let bytes = zstd::bulk::decompress(compressed, raw_length)
        .map_err(|_| history_corrupt("chunkDecompressionFailed"))?;
    if bytes.len() != raw_length || digest_hex(&bytes) != hash {
        return Err(history_corrupt("chunkHashMismatch"));
    }
    Ok(bytes)
}

fn build_history(
    connection: &Connection,
    note_id: NoteId,
) -> Result<VersionHistory, WorkspaceFailure> {
    let head = current_head(connection, note_id)?;
    let mut statement = connection
        .prepare(
            "SELECT version_id, note_id, note_title, parent_id, content_hash,
                    content_length, created_at_millis, message, checkpoint_name
             FROM version_node
             WHERE note_id = ?1
             ORDER BY created_at_millis DESC, version_id DESC",
        )
        .map_err(|error| history_sqlite_failure("prepareVersionHistory", &error))?;
    let rows = statement
        .query_map([note_id.to_string()], raw_node_from_row)
        .map_err(|error| history_sqlite_failure("queryVersionHistory", &error))?;
    let mut nodes = Vec::new();
    for row in rows {
        nodes.push(validate_raw_node(row.map_err(|error| {
            history_sqlite_failure("readVersionHistory", &error)
        })?)?);
    }
    if nodes.len() > MAX_VERSIONS_PER_NOTE {
        return Err(history_corrupt("versionCountOutOfRange"));
    }
    let nodes_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node.parent_id.as_deref()))
        .collect::<std::collections::BTreeMap<_, _>>();
    for node in &nodes {
        if node
            .parent_id
            .as_deref()
            .is_some_and(|parent| !nodes_by_id.contains_key(parent))
        {
            return Err(history_corrupt("parentBelongsToAnotherNote"));
        }
        let mut visited = std::collections::BTreeSet::new();
        let mut current = Some(node.id.as_str());
        while let Some(version_id) = current {
            if !visited.insert(version_id) {
                return Err(history_corrupt("versionGraphCycle"));
            }
            current = nodes_by_id.get(version_id).copied().flatten();
        }
    }
    if let Some(head_id) = head.as_deref()
        && !nodes.iter().any(|node| node.id == head_id)
    {
        return Err(history_corrupt("headBelongsToAnotherNote"));
    }

    let (chunk_count, stored_bytes): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(compressed)), 0)
             FROM version_chunk
             WHERE chunk_hash IN (
                SELECT DISTINCT manifest.chunk_hash
                FROM version_manifest AS manifest
                JOIN version_node AS node ON node.version_id = manifest.version_id
                WHERE node.note_id = ?1
             )",
            [note_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| history_sqlite_failure("readVersionStorageStats", &error))?;
    let logical_bytes = nodes
        .iter()
        .try_fold(0_u64, |total, node| total.checked_add(node.content_length))
        .ok_or_else(|| history_corrupt("logicalBytesOverflow"))?;
    Ok(VersionHistory {
        note_id,
        head,
        stats: VersionHistoryStats {
            version_count: nodes.len(),
            chunk_count: usize::try_from(chunk_count)
                .map_err(|_| history_corrupt("chunkCountOutOfRange"))?,
            logical_bytes,
            stored_bytes: u64::try_from(stored_bytes)
                .map_err(|_| history_corrupt("storedBytesOutOfRange"))?,
        },
        nodes,
    })
}

fn raw_node_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawVersionNode> {
    Ok(RawVersionNode {
        id: row.get(0)?,
        note_id: row.get(1)?,
        note_title: row.get(2)?,
        parent_id: row.get(3)?,
        content_hash: row.get(4)?,
        content_length: row.get(5)?,
        created_at_millis: row.get(6)?,
        message: row.get(7)?,
        checkpoint_name: row.get(8)?,
    })
}

fn validate_raw_node(raw: RawVersionNode) -> Result<VersionNode, WorkspaceFailure> {
    validate_version_id(&raw.id).map_err(|_| history_corrupt("invalidVersionId"))?;
    if let Some(parent_id) = raw.parent_id.as_deref() {
        validate_version_id(parent_id).map_err(|_| history_corrupt("invalidParentId"))?;
    }
    let note_id =
        NoteId::from_str(&raw.note_id).map_err(|_| history_corrupt("invalidVersionNoteId"))?;
    if raw.note_title.trim().is_empty() || raw.note_title.chars().count() > MAX_TITLE_CHARS {
        return Err(history_corrupt("invalidVersionTitle"));
    }
    if !is_digest(&raw.content_hash) {
        return Err(history_corrupt("invalidContentHash"));
    }
    if raw
        .message
        .as_deref()
        .is_some_and(|value| value.chars().count() > MAX_MESSAGE_CHARS)
    {
        return Err(history_corrupt("invalidVersionMessage"));
    }
    if raw.checkpoint_name.as_deref().is_some_and(|value| {
        value.trim() != value
            || value.is_empty()
            || value.chars().count() > MAX_CHECKPOINT_NAME_CHARS
            || value.chars().any(char::is_control)
    }) {
        return Err(history_corrupt("invalidCheckpointName"));
    }
    let content_length = u64::try_from(raw.content_length)
        .map_err(|_| history_corrupt("contentLengthOutOfRange"))?;
    if content_length > MAX_NOTE_BYTES {
        return Err(history_corrupt("contentLengthOutOfRange"));
    }
    let created_at_millis =
        u64::try_from(raw.created_at_millis).map_err(|_| history_corrupt("timestampOutOfRange"))?;
    if created_at_millis > MAX_TIMESTAMP_MILLIS {
        return Err(history_corrupt("timestampOutOfRange"));
    }
    Ok(VersionNode {
        id: raw.id,
        note_id,
        note_title: raw.note_title,
        parent_id: raw.parent_id,
        content_hash: raw.content_hash,
        content_length,
        created_at_millis,
        message: raw.message,
        checkpoint_name: raw.checkpoint_name,
    })
}

fn load_version_node(
    connection: &Connection,
    version_id: &str,
) -> Result<VersionNode, WorkspaceFailure> {
    let raw = connection
        .query_row(
            "SELECT version_id, note_id, note_title, parent_id, content_hash,
                    content_length, created_at_millis, message, checkpoint_name
             FROM version_node WHERE version_id = ?1",
            [version_id],
            raw_node_from_row,
        )
        .optional()
        .map_err(|error| history_sqlite_failure("readVersionNode", &error))?
        .ok_or_else(|| WorkspaceFailure::VersionNotFound {
            version_id: version_id.to_owned(),
        })?;
    validate_raw_node(raw)
}

fn read_version_from_connection(
    connection: &Connection,
    version_id: &str,
) -> Result<VersionContent, WorkspaceFailure> {
    let node = load_version_node(connection, version_id)?;
    let mut statement = connection
        .prepare(
            "SELECT manifest.ordinal, chunk.chunk_hash, chunk.raw_length, chunk.compressed
             FROM version_manifest AS manifest
             JOIN version_chunk AS chunk ON chunk.chunk_hash = manifest.chunk_hash
             WHERE manifest.version_id = ?1
             ORDER BY manifest.ordinal",
        )
        .map_err(|error| history_sqlite_failure("prepareVersionRead", &error))?;
    let rows = statement
        .query_map([version_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Vec<u8>>(3)?,
            ))
        })
        .map_err(|error| history_sqlite_failure("queryVersionChunks", &error))?;

    let capacity = usize::try_from(node.content_length)
        .map_err(|_| history_corrupt("contentLengthOutOfRange"))?;
    let mut content = Vec::with_capacity(capacity);
    for (expected_ordinal, row) in rows.enumerate() {
        let (ordinal, hash, raw_length, compressed) =
            row.map_err(|error| history_sqlite_failure("readVersionChunk", &error))?;
        if usize::try_from(ordinal).ok() != Some(expected_ordinal) {
            return Err(history_corrupt("nonContiguousManifest"));
        }
        let raw_length =
            usize::try_from(raw_length).map_err(|_| history_corrupt("chunkLengthOutOfRange"))?;
        let chunk = verify_chunk(&hash, raw_length, &compressed)?;
        content.extend_from_slice(&chunk);
        if content.len() > capacity {
            return Err(history_corrupt("contentLengthMismatch"));
        }
    }
    if content.len() != capacity || digest_hex(&content) != node.content_hash {
        return Err(history_corrupt("contentHashMismatch"));
    }
    let markdown = String::from_utf8(content).map_err(|_| history_corrupt("versionNotUtf8"))?;
    if markdown.contains('\r') {
        return Err(history_corrupt("versionNotNormalized"));
    }
    Ok(VersionContent { node, markdown })
}

fn current_head(
    connection: &Connection,
    note_id: NoteId,
) -> Result<Option<String>, WorkspaceFailure> {
    connection
        .query_row(
            "SELECT version_id FROM version_head WHERE note_id = ?1",
            [note_id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| history_sqlite_failure("readVersionHead", &error))
}

fn require_expected_head(
    note_id: NoteId,
    expected: Option<&str>,
    actual: Option<&str>,
) -> Result<(), WorkspaceFailure> {
    if expected == actual {
        return Ok(());
    }
    Err(WorkspaceFailure::VersionConflict {
        note_id,
        expected: expected.map(str::to_owned),
        actual: actual.map(str::to_owned),
    })
}

fn note_version_count(connection: &Connection, note_id: NoteId) -> Result<usize, WorkspaceFailure> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM version_node WHERE note_id = ?1",
            [note_id.to_string()],
            |row| row.get(0),
        )
        .map_err(|error| history_sqlite_failure("countVersions", &error))?;
    usize::try_from(count).map_err(|_| history_corrupt("versionCountOutOfRange"))
}

fn orphan_chunk_bytes(connection: &Connection) -> Result<u64, WorkspaceFailure> {
    let bytes: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(compressed)), 0)
             FROM version_chunk
             WHERE NOT EXISTS (
                SELECT 1 FROM version_manifest
                WHERE version_manifest.chunk_hash = version_chunk.chunk_hash
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| history_sqlite_failure("measureOrphanVersionChunks", &error))?;
    u64::try_from(bytes).map_err(|_| history_corrupt("releasedBytesOutOfRange"))
}

fn validate_checkpoint_name(value: Option<&str>) -> Result<Option<String>, WorkspaceFailure> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_CHECKPOINT_NAME_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(invalid("invalidCheckpointName"));
    }
    Ok(Some(value.to_owned()))
}

fn validate_retention_policy(policy: VersionRetentionPolicy) -> Result<(), WorkspaceFailure> {
    if policy.keep_latest == 0 || policy.keep_latest > MAX_RETENTION_KEEP_LATEST {
        return Err(invalid("invalidRetentionKeepLatest"));
    }
    if policy.keep_days > MAX_RETENTION_KEEP_DAYS {
        return Err(invalid("invalidRetentionKeepDays"));
    }
    Ok(())
}

fn retention_cutoff(now_millis: u64, keep_days: u16) -> u64 {
    now_millis.saturating_sub(u64::from(keep_days) * MILLIS_PER_DAY)
}

fn build_retention_preview(
    connection: &Connection,
    note_id: NoteId,
    expected_head: Option<&str>,
    policy: VersionRetentionPolicy,
    cutoff_at_millis: u64,
) -> Result<VersionRetentionPreview, WorkspaceFailure> {
    validate_retention_policy(policy)?;
    if cutoff_at_millis > MAX_TIMESTAMP_MILLIS {
        return Err(invalid("retentionCutoffOutOfRange"));
    }
    let actual_head = current_head(connection, note_id)?;
    require_expected_head(note_id, expected_head, actual_head.as_deref())?;
    let history = build_history(connection, note_id)?;
    let parent_ids = history
        .nodes
        .iter()
        .filter_map(|node| node.parent_id.as_deref())
        .collect::<BTreeSet<_>>();
    let keep_latest = usize::from(policy.keep_latest);
    let candidates = history
        .nodes
        .iter()
        .enumerate()
        .filter(|(index, node)| {
            let is_recent = policy.keep_days > 0 && node.created_at_millis >= cutoff_at_millis;
            let is_root = node.parent_id.is_none();
            let is_branch_tip = !parent_ids.contains(node.id.as_str());
            let is_head = actual_head.as_deref() == Some(node.id.as_str());
            *index >= keep_latest
                && !is_recent
                && !is_root
                && !is_branch_tip
                && !is_head
                && node.checkpoint_name.is_none()
        })
        .map(|(_, node)| node.clone())
        .collect::<Vec<_>>();

    for candidate in &candidates {
        read_version_from_connection(connection, &candidate.id)?;
    }
    let candidate_ids = candidates
        .iter()
        .map(|node| node.id.as_str())
        .collect::<Vec<_>>();
    let released_bytes = candidate_released_bytes(connection, &candidate_ids)?;
    let preview_token = retention_preview_token(&history, policy, cutoff_at_millis, &candidate_ids);
    Ok(VersionRetentionPreview {
        note_id,
        expected_head: actual_head,
        policy,
        cutoff_at_millis,
        preview_token,
        remaining_version_count: history.nodes.len().saturating_sub(candidates.len()),
        candidates,
        released_bytes,
    })
}

fn candidate_released_bytes(
    connection: &Connection,
    candidate_ids: &[&str],
) -> Result<u64, WorkspaceFailure> {
    if candidate_ids.is_empty() {
        return Ok(0);
    }
    connection
        .execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS retention_candidate (
                version_id TEXT PRIMARY KEY NOT NULL
             ) STRICT, WITHOUT ROWID;
             DELETE FROM retention_candidate;",
        )
        .map_err(|error| history_sqlite_failure("prepareRetentionCandidates", &error))?;
    {
        let mut statement = connection
            .prepare("INSERT INTO retention_candidate(version_id) VALUES (?1)")
            .map_err(|error| history_sqlite_failure("prepareRetentionCandidateInsert", &error))?;
        for version_id in candidate_ids {
            statement
                .execute([version_id])
                .map_err(|error| history_sqlite_failure("insertRetentionCandidate", &error))?;
        }
    }
    let bytes: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(length(chunk.compressed)), 0)
             FROM version_chunk AS chunk
             WHERE EXISTS (
                SELECT 1
                FROM version_manifest AS candidate_manifest
                JOIN retention_candidate AS candidate
                    ON candidate.version_id = candidate_manifest.version_id
                WHERE candidate_manifest.chunk_hash = chunk.chunk_hash
             )
             AND NOT EXISTS (
                SELECT 1
                FROM version_manifest AS remaining_manifest
                LEFT JOIN retention_candidate AS candidate
                    ON candidate.version_id = remaining_manifest.version_id
                WHERE remaining_manifest.chunk_hash = chunk.chunk_hash
                  AND candidate.version_id IS NULL
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| history_sqlite_failure("measureRetentionRelease", &error))?;
    connection
        .execute("DELETE FROM retention_candidate", [])
        .map_err(|error| history_sqlite_failure("clearRetentionCandidates", &error))?;
    u64::try_from(bytes).map_err(|_| history_corrupt("releasedBytesOutOfRange"))
}

fn retention_preview_token(
    history: &VersionHistory,
    policy: VersionRetentionPolicy,
    cutoff_at_millis: u64,
    candidate_ids: &[&str],
) -> String {
    let mut digest = Sha256::new();
    update_token_field(&mut digest, b"zhiweave-retention-preview-v1");
    update_token_field(&mut digest, history.note_id.to_string().as_bytes());
    update_token_field(
        &mut digest,
        history.head.as_deref().unwrap_or_default().as_bytes(),
    );
    update_token_field(&mut digest, &policy.keep_latest.to_le_bytes());
    update_token_field(&mut digest, &policy.keep_days.to_le_bytes());
    update_token_field(&mut digest, &cutoff_at_millis.to_le_bytes());
    for node in &history.nodes {
        update_token_field(&mut digest, node.id.as_bytes());
        update_token_field(
            &mut digest,
            node.parent_id.as_deref().unwrap_or_default().as_bytes(),
        );
        update_token_field(&mut digest, &node.created_at_millis.to_le_bytes());
        update_token_field(
            &mut digest,
            node.checkpoint_name
                .as_deref()
                .unwrap_or_default()
                .as_bytes(),
        );
        update_token_field(&mut digest, node.content_hash.as_bytes());
    }
    for version_id in candidate_ids {
        update_token_field(&mut digest, version_id.as_bytes());
    }
    hex_digest(digest.finalize())
}

fn update_token_field(digest: &mut Sha256, value: &[u8]) {
    digest.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_le_bytes());
    digest.update(value);
}

fn nearest_retained_parent<'a>(
    first_parent: &'a str,
    parents: &BTreeMap<&'a str, Option<&'a str>>,
    candidates: &BTreeSet<&str>,
) -> Result<Option<&'a str>, WorkspaceFailure> {
    let mut current = Some(first_parent);
    let mut visited = BTreeSet::new();
    while let Some(version_id) = current {
        if !visited.insert(version_id) {
            return Err(history_corrupt("versionGraphCycle"));
        }
        if !candidates.contains(version_id) {
            return Ok(Some(version_id));
        }
        current = parents
            .get(version_id)
            .copied()
            .ok_or_else(|| history_corrupt("retentionParentMissing"))?;
    }
    Ok(None)
}

fn validate_version_id(value: &str) -> Result<(), WorkspaceFailure> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| invalid("invalidVersionId"))
}

fn digest_hex(bytes: &[u8]) -> String {
    hex_digest(Sha256::digest(bytes))
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

fn now_millis() -> Result<u64, WorkspaceFailure> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| history_corrupt("systemClockBeforeEpoch"))?;
    u64::try_from(duration.as_millis()).map_err(|_| history_corrupt("timestampOutOfRange"))
}

fn invalid(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::InvalidVersionRequest {
        kind: kind.to_owned(),
    }
}

fn history_corrupt(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::HistoryCorrupt {
        kind: kind.to_owned(),
    }
}

fn history_sqlite_failure(operation: &str, error: &SqliteError) -> WorkspaceFailure {
    match error {
        SqliteError::SqliteFailure(details, _)
            if matches!(
                details.code,
                ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase
            ) =>
        {
            history_corrupt("sqliteCorrupt")
        }
        _ => WorkspaceFailure::HistoryUnavailable {
            operation: operation.to_owned(),
            kind: sqlite_error_kind(error).to_owned(),
        },
    }
}

fn sqlite_error_kind(error: &SqliteError) -> &'static str {
    match error {
        SqliteError::SqliteFailure(details, _) => match details.code {
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => "busy",
            ErrorCode::ReadOnly => "readOnly",
            ErrorCode::DiskFull => "diskFull",
            ErrorCode::CannotOpen => "cannotOpen",
            ErrorCode::ConstraintViolation => "constraint",
            _ => "sqlite",
        },
        _ => "sqlite",
    }
}

fn history_io(operation: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::HistoryUnavailable {
        operation: operation.to_owned(),
        kind: match error.kind() {
            std::io::ErrorKind::NotFound => "notFound",
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

    use rusqlite::Connection;
    use zhiweave_application::{
        ApplyVersionRetentionRequest, CheckoutVersionRequest, DeleteVersionRequest,
        PreviewVersionRetentionRequest, ReadVersionRequest, SaveVersionRequest,
        SetVersionCheckpointRequest, VersionHistoryRequest, VersionRetentionPolicy,
        WorkspaceFailure,
    };
    use zhiweave_domain::NoteId;

    use super::{HISTORY_APPLICATION_ID, SqliteHistory};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("zhiweave-history-test-{}-{nonce}", process::id()));
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
                    .is_some_and(|name| name.starts_with("zhiweave-history-test-"))
            );
            let _ = fs::remove_dir_all(target);
        }
    }

    fn save_request(
        note_id: NoteId,
        markdown: &str,
        expected_head: Option<String>,
    ) -> SaveVersionRequest {
        SaveVersionRequest {
            note_id,
            note_title: "内容寻址版本".to_owned(),
            markdown: markdown.to_owned(),
            expected_head,
            message: None,
        }
    }

    #[test]
    fn history_survives_restart_deduplicates_and_noops_identical_head() {
        let directory = TestDirectory::new();
        let note_id = NoteId::new();
        let first_markdown = format!("# 标题\n\n{}\n", "相同的知识正文。".repeat(600));
        let second_markdown = first_markdown.replacen("知识正文", "修订正文", 1);
        let history = SqliteHistory::new(directory.path());

        let first = history
            .save(&save_request(note_id, &first_markdown, None))
            .unwrap();
        assert!(first.created);
        let second = history
            .save(&save_request(
                note_id,
                &second_markdown,
                Some(first.node.id.clone()),
            ))
            .unwrap();
        assert!(second.created);
        assert_eq!(second.history.stats.version_count, 2);
        assert!(
            second.history.stats.stored_bytes < second.history.stats.logical_bytes,
            "content-defined chunks and compression should reduce stored bytes"
        );
        let no_op = history
            .save(&save_request(
                note_id,
                &second_markdown,
                Some(second.node.id.clone()),
            ))
            .unwrap();
        assert!(!no_op.created);
        assert_eq!(no_op.history.stats.version_count, 2);
        drop(history);

        let reopened = SqliteHistory::new(directory.path());
        let graph = reopened
            .history(&VersionHistoryRequest { note_id })
            .unwrap();
        assert_eq!(graph.head.as_deref(), Some(second.node.id.as_str()));
        assert_eq!(graph.nodes.len(), 2);
        let restored = reopened
            .read(&ReadVersionRequest {
                version_id: first.node.id,
            })
            .unwrap();
        assert_eq!(restored.markdown, first_markdown);
    }

    #[test]
    fn checkout_branches_and_deleting_middle_node_keeps_children_recoverable() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let root = history
            .save(&save_request(note_id, "# Root\n", None))
            .unwrap()
            .node;
        let main = history
            .save(&save_request(note_id, "# Main\n", Some(root.id.clone())))
            .unwrap()
            .node;
        history
            .checkout(&CheckoutVersionRequest {
                note_id,
                version_id: root.id.clone(),
                expected_head: Some(main.id.clone()),
            })
            .unwrap();
        let branch = history
            .save(&save_request(note_id, "# Branch\n", Some(root.id.clone())))
            .unwrap()
            .node;
        assert_eq!(branch.parent_id.as_deref(), Some(root.id.as_str()));

        let deleted = history
            .delete(&DeleteVersionRequest {
                note_id,
                version_id: root.id,
                expected_head: Some(branch.id.clone()),
            })
            .unwrap();
        assert!(deleted.released_bytes > 0);
        assert_eq!(deleted.history.nodes.len(), 2);
        assert!(
            deleted
                .history
                .nodes
                .iter()
                .all(|node| node.parent_id.is_none())
        );
        assert_eq!(
            history
                .read(&ReadVersionRequest {
                    version_id: main.id,
                })
                .unwrap()
                .markdown,
            "# Main\n"
        );
        assert_eq!(
            history
                .read(&ReadVersionRequest {
                    version_id: branch.id,
                })
                .unwrap()
                .markdown,
            "# Branch\n"
        );
    }

    #[test]
    fn stale_heads_conflict_without_mutating_the_graph() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let first = history
            .save(&save_request(note_id, "# First\n", None))
            .unwrap()
            .node;
        let failure = history
            .save(&save_request(note_id, "# Lost update\n", None))
            .unwrap_err();
        assert_eq!(
            failure,
            WorkspaceFailure::VersionConflict {
                note_id,
                expected: None,
                actual: Some(first.id.clone()),
            }
        );
        let graph = history.history(&VersionHistoryRequest { note_id }).unwrap();
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.head, Some(first.id));
    }

    #[test]
    fn tampered_chunk_is_never_returned_as_markdown() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let node = history
            .save(&save_request(note_id, "# Trusted\n\nEvidence\n", None))
            .unwrap()
            .node;
        drop(history);

        let path = directory.path().join("history.sqlite3");
        let connection = Connection::open(path).unwrap();
        connection
            .execute(
                "UPDATE version_chunk SET compressed = x'00' WHERE chunk_hash = (
                    SELECT chunk_hash FROM version_manifest WHERE version_id = ?1 LIMIT 1
                 )",
                [&node.id],
            )
            .unwrap();
        drop(connection);

        let reopened = SqliteHistory::new(directory.path());
        assert!(matches!(
            reopened.read(&ReadVersionRequest {
                version_id: node.id.clone()
            }),
            Err(WorkspaceFailure::HistoryCorrupt { .. })
        ));
        assert!(matches!(
            reopened.save(&save_request(
                note_id,
                "# Trusted\n\nEvidence\n",
                Some(node.id),
            )),
            Err(WorkspaceFailure::HistoryCorrupt { .. })
        ));
    }

    #[test]
    fn failed_manifest_write_rolls_back_node_chunks_and_head() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let first = history
            .save(&save_request(note_id, "# First\n", None))
            .unwrap();
        let before = first.history.stats.clone();
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_version_manifest
                 BEFORE INSERT ON version_manifest
                 BEGIN
                    SELECT RAISE(ABORT, 'injected failure');
                 END;",
            )
            .unwrap();
        drop(connection);

        assert!(matches!(
            history.save(&save_request(
                note_id,
                "# A completely different second version\n",
                Some(first.node.id.clone()),
            )),
            Err(WorkspaceFailure::HistoryUnavailable { .. })
        ));
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        connection
            .execute_batch("DROP TRIGGER fail_version_manifest;")
            .unwrap();
        drop(connection);

        let after = history.history(&VersionHistoryRequest { note_id }).unwrap();
        assert_eq!(after.head, Some(first.node.id));
        assert_eq!(after.stats, before);
        assert_eq!(after.nodes.len(), 1);
    }

    #[test]
    fn future_history_schema_fails_closed_without_downgrade() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        history.history(&VersionHistoryRequest { note_id }).unwrap();
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        connection.pragma_update(None, "user_version", 999).unwrap();
        drop(connection);

        assert_eq!(
            history.history(&VersionHistoryRequest { note_id }),
            Err(WorkspaceFailure::HistorySchemaTooNew {
                found: 999,
                supported: 2,
            })
        );
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 999);
    }

    #[test]
    fn version_one_history_migrates_checkpoint_metadata_without_losing_nodes() {
        let directory = TestDirectory::new();
        let path = directory.path().join("history.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "application_id", HISTORY_APPLICATION_ID)
            .unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE version_node (
                    version_id TEXT PRIMARY KEY NOT NULL,
                    note_id TEXT NOT NULL,
                    note_title TEXT NOT NULL,
                    parent_id TEXT REFERENCES version_node(version_id)
                        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                    content_hash TEXT NOT NULL,
                    content_length INTEGER NOT NULL CHECK(content_length >= 0),
                    created_at_millis INTEGER NOT NULL CHECK(created_at_millis >= 0),
                    message TEXT
                 ) STRICT;
                 CREATE INDEX version_node_note_time
                    ON version_node(note_id, created_at_millis DESC, version_id DESC);
                 CREATE INDEX version_node_parent ON version_node(parent_id);
                 CREATE TABLE version_chunk (
                    chunk_hash TEXT PRIMARY KEY NOT NULL,
                    raw_length INTEGER NOT NULL CHECK(raw_length > 0 AND raw_length <= 4096),
                    compressed BLOB NOT NULL
                        CHECK(length(compressed) > 0 AND length(compressed) <= 8192)
                 ) STRICT;
                 CREATE TABLE version_manifest (
                    version_id TEXT NOT NULL REFERENCES version_node(version_id)
                        ON DELETE CASCADE,
                    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
                    chunk_hash TEXT NOT NULL REFERENCES version_chunk(chunk_hash)
                        ON DELETE RESTRICT,
                    PRIMARY KEY(version_id, ordinal)
                 ) STRICT, WITHOUT ROWID;
                 CREATE INDEX version_manifest_chunk ON version_manifest(chunk_hash);
                 CREATE TABLE version_head (
                    note_id TEXT PRIMARY KEY NOT NULL,
                    version_id TEXT NOT NULL REFERENCES version_node(version_id)
                        ON DELETE RESTRICT
                 ) STRICT, WITHOUT ROWID;
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);

        let note_id = NoteId::new();
        let history = SqliteHistory::new(directory.path());
        let graph = history.history(&VersionHistoryRequest { note_id }).unwrap();
        assert!(graph.nodes.is_empty());
        let saved = history
            .save(&save_request(note_id, "# Migrated\n", None))
            .unwrap();
        history
            .set_checkpoint(&SetVersionCheckpointRequest {
                note_id,
                version_id: saved.node.id,
                expected_head: saved.history.head,
                checkpoint_name: Some("迁移后检查点".to_owned()),
            })
            .unwrap();
        let connection = Connection::open(path).unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn cross_note_parent_corruption_is_rejected_before_mutation() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let first_note = NoteId::new();
        let second_note = NoteId::new();
        let first = history
            .save(&save_request(first_note, "# First note\n", None))
            .unwrap()
            .node;
        let second = history
            .save(&save_request(second_note, "# Second note\n", None))
            .unwrap()
            .node;
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        connection
            .execute(
                "UPDATE version_node SET parent_id = ?1 WHERE version_id = ?2",
                [&first.id, &second.id],
            )
            .unwrap();
        drop(connection);

        assert_eq!(
            history.history(&VersionHistoryRequest {
                note_id: second_note,
            }),
            Err(WorkspaceFailure::HistoryCorrupt {
                kind: "parentBelongsToAnotherNote".to_owned(),
            })
        );
        assert!(matches!(
            history.delete(&DeleteVersionRequest {
                note_id: second_note,
                version_id: second.id.clone(),
                expected_head: Some(second.id),
            }),
            Err(WorkspaceFailure::HistoryCorrupt { .. })
        ));
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        let still_present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM version_node WHERE note_id = ?1",
                [second_note.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(still_present, 1);
    }

    #[test]
    fn checkpoints_are_named_and_retention_preserves_anchors_and_branches() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let mut versions = Vec::new();
        let mut expected_head = None;
        for index in 0..6 {
            let markdown = format!(
                "# Version {index}\n\n{}\n",
                format!("unique-{index}-").repeat(900)
            );
            let saved = history
                .save(&save_request(note_id, &markdown, expected_head))
                .unwrap();
            expected_head = Some(saved.node.id.clone());
            versions.push(saved.node);
        }
        let head = expected_head.unwrap();
        let checkpointed = history
            .set_checkpoint(&SetVersionCheckpointRequest {
                note_id,
                version_id: versions[3].id.clone(),
                expected_head: Some(head.clone()),
                checkpoint_name: Some("通过核心测试".to_owned()),
            })
            .unwrap();
        assert_eq!(
            checkpointed
                .nodes
                .iter()
                .find(|node| node.id == versions[3].id)
                .and_then(|node| node.checkpoint_name.as_deref()),
            Some("通过核心测试")
        );

        let preview = history
            .preview_retention(&PreviewVersionRetentionRequest {
                note_id,
                expected_head: Some(head.clone()),
                policy: VersionRetentionPolicy {
                    keep_latest: 2,
                    keep_days: 0,
                },
            })
            .unwrap();
        assert_eq!(preview.candidates.len(), 2);
        assert_eq!(preview.remaining_version_count, 4);
        assert!(
            preview
                .candidates
                .iter()
                .all(|node| node.id != versions[0].id
                    && node.id != versions[3].id
                    && node.id != versions[4].id
                    && node.id != versions[5].id)
        );

        let result = history
            .apply_retention(&ApplyVersionRetentionRequest {
                note_id,
                expected_head: Some(head),
                policy: preview.policy,
                cutoff_at_millis: preview.cutoff_at_millis,
                preview_token: preview.preview_token,
            })
            .unwrap();
        assert_eq!(result.deleted_versions, 2);
        assert_eq!(result.history.nodes.len(), 4);
        assert_eq!(
            result
                .history
                .nodes
                .iter()
                .find(|node| node.id == versions[3].id)
                .and_then(|node| node.parent_id.as_deref()),
            Some(versions[0].id.as_str())
        );
        for node in &result.history.nodes {
            history
                .read(&ReadVersionRequest {
                    version_id: node.id.clone(),
                })
                .unwrap();
        }
    }

    #[test]
    fn retention_preview_becomes_stale_when_a_candidate_is_checkpointed() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let mut expected_head = None;
        for index in 0..5 {
            let saved = history
                .save(&save_request(
                    note_id,
                    &format!("# {index}\n\n{}\n", format!("{index}-").repeat(600)),
                    expected_head,
                ))
                .unwrap();
            expected_head = Some(saved.node.id);
        }
        let head = expected_head.unwrap();
        let preview = history
            .preview_retention(&PreviewVersionRetentionRequest {
                note_id,
                expected_head: Some(head.clone()),
                policy: VersionRetentionPolicy {
                    keep_latest: 1,
                    keep_days: 0,
                },
            })
            .unwrap();
        let protected = preview.candidates[0].id.clone();
        history
            .set_checkpoint(&SetVersionCheckpointRequest {
                note_id,
                version_id: protected,
                expected_head: Some(head.clone()),
                checkpoint_name: Some("不要清理".to_owned()),
            })
            .unwrap();

        assert_eq!(
            history.apply_retention(&ApplyVersionRetentionRequest {
                note_id,
                expected_head: Some(head),
                policy: preview.policy,
                cutoff_at_millis: preview.cutoff_at_millis,
                preview_token: preview.preview_token,
            }),
            Err(WorkspaceFailure::InvalidVersionRequest {
                kind: "staleRetentionPreview".to_owned(),
            })
        );
        assert_eq!(
            history
                .history(&VersionHistoryRequest { note_id })
                .unwrap()
                .nodes
                .len(),
            5
        );
    }

    #[test]
    fn retention_preview_refuses_to_delete_a_corrupt_candidate() {
        let directory = TestDirectory::new();
        let history = SqliteHistory::new(directory.path());
        let note_id = NoteId::new();
        let mut expected_head = None;
        for index in 0..4 {
            let saved = history
                .save(&save_request(
                    note_id,
                    &format!("# {index}\n\n{}\n", format!("body-{index}-").repeat(700)),
                    expected_head,
                ))
                .unwrap();
            expected_head = Some(saved.node.id);
        }
        let head = expected_head.unwrap();
        let graph = history.history(&VersionHistoryRequest { note_id }).unwrap();
        let candidate = graph.nodes[2].id.clone();
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        connection
            .execute(
                "UPDATE version_chunk SET compressed = x'00' WHERE chunk_hash = (
                    SELECT chunk_hash FROM version_manifest WHERE version_id = ?1 LIMIT 1
                 )",
                [&candidate],
            )
            .unwrap();
        drop(connection);

        assert!(matches!(
            history.preview_retention(&PreviewVersionRetentionRequest {
                note_id,
                expected_head: Some(head),
                policy: VersionRetentionPolicy {
                    keep_latest: 1,
                    keep_days: 0,
                },
            }),
            Err(WorkspaceFailure::HistoryCorrupt { .. })
        ));
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM version_node WHERE note_id = ?1",
                [note_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 4);
    }
}
