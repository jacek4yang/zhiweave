use std::{
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
    CheckoutVersionRequest, DeleteVersionRequest, DeleteVersionResult, ReadVersionRequest,
    SaveVersionRequest, SaveVersionResult, VersionContent, VersionHistory, VersionHistoryRequest,
    VersionHistoryStats, VersionNode, WorkspaceFailure,
};
use zhiweave_domain::NoteId;

use crate::MAX_NOTE_BYTES;

const HISTORY_FILE_NAME: &str = "history.sqlite3";
const HISTORY_APPLICATION_ID: i32 = 0x5a48_4856;
const HISTORY_SCHEMA_VERSION: u32 = 1;
const MAX_VERSIONS_PER_NOTE: usize = 10_000;
const MAX_TITLE_CHARS: usize = 200;
const MAX_MESSAGE_CHARS: usize = 200;
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
        let node = load_version_node(&connection, &request.version_id)?;
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
            .query_map([&request.version_id], |row| {
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
            let raw_length = usize::try_from(raw_length)
                .map_err(|_| history_corrupt("chunkLengthOutOfRange"))?;
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
                ) STRICT, WITHOUT ROWID;",
            )
            .map_err(|error| history_sqlite_failure("migrateHistorySchemaV1", &error))?;
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
                    content_length, created_at_millis, message
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
    })
}

fn load_version_node(
    connection: &Connection,
    version_id: &str,
) -> Result<VersionNode, WorkspaceFailure> {
    let raw = connection
        .query_row(
            "SELECT version_id, note_id, note_title, parent_id, content_hash,
                    content_length, created_at_millis, message
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

fn validate_version_id(value: &str) -> Result<(), WorkspaceFailure> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| invalid("invalidVersionId"))
}

fn digest_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
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
        CheckoutVersionRequest, DeleteVersionRequest, ReadVersionRequest, SaveVersionRequest,
        VersionHistoryRequest, WorkspaceFailure,
    };
    use zhiweave_domain::NoteId;

    use super::SqliteHistory;

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
                supported: 1,
            })
        );
        let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 999);
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
}
