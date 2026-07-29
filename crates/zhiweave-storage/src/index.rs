use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{
    Connection, Error as SqliteError, ErrorCode, OpenFlags, OptionalExtension, Transaction,
    TransactionBehavior, params,
};
use zhiweave_application::{
    IndexState, IndexStatus, SearchNoteResult, SearchNotesRequest, WorkspaceFailure,
};
use zhiweave_domain::{NoteId, NoteKind, PortablePath};

use crate::IndexedDocument;

pub(crate) const INDEX_SCHEMA_VERSION: u32 = 1;
const INDEX_APPLICATION_ID: i32 = 0x5a48_5756;
const MAX_SEARCH_CHARS: usize = 256;
const MAX_SEARCH_RESULTS: usize = 100;
const INDEX_FILE_NAME: &str = "index.sqlite3";
const REBUILD_FILE_NAME: &str = "index.rebuild.sqlite3";

pub(crate) struct SqliteIndex {
    path: PathBuf,
    metadata_directory: PathBuf,
}

impl SqliteIndex {
    pub(crate) fn new(metadata_directory: &Path) -> Self {
        Self {
            path: metadata_directory.join(INDEX_FILE_NAME),
            metadata_directory: metadata_directory.to_owned(),
        }
    }

    pub(crate) fn synchronize(
        &self,
        documents: &[IndexedDocument],
    ) -> Result<IndexStatus, WorkspaceFailure> {
        let mut connection = open_index(&self.path)?;
        synchronize_transaction(&mut connection, documents)?;
        checkpoint(&connection)?;
        Ok(IndexStatus {
            state: IndexState::Ready,
            schema_version: INDEX_SCHEMA_VERSION,
            note_count: documents.len(),
            issue: None,
        })
    }

    pub(crate) fn update_one(&self, document: &IndexedDocument) -> Result<(), WorkspaceFailure> {
        let mut connection = open_index(&self.path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| sqlite_failure("beginIncrementalIndex", &error))?;
        upsert_document(&transaction, document)?;
        transaction
            .commit()
            .map_err(|error| sqlite_failure("commitIncrementalIndex", &error))?;
        Ok(())
    }

    pub(crate) fn search(
        &self,
        request: &SearchNotesRequest,
    ) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
        let query = validate_search(request)?;
        let connection = open_index(&self.path)?;
        if query.chars().count() < 3 {
            search_short_query(&connection, query, request.limit)
        } else {
            search_trigram(&connection, query, request.limit)
        }
    }

    pub(crate) fn rebuild(&self, documents: &[IndexedDocument]) -> Result<bool, WorkspaceFailure> {
        let temporary = self.metadata_directory.join(REBUILD_FILE_NAME);
        remove_rebuild_artifacts(&temporary)?;

        let build_result = (|| {
            let mut connection = open_index(&temporary)?;
            synchronize_transaction(&mut connection, documents)?;
            verify_integrity(&connection)?;
            connection
                .pragma_update(None, "journal_mode", "DELETE")
                .map_err(|error| sqlite_failure("finishRebuild", &error))?;
            drop(connection);
            Ok::<(), WorkspaceFailure>(())
        })();
        if let Err(failure) = build_result {
            let _ = remove_rebuild_artifacts(&temporary);
            return Err(failure);
        }

        let preserved =
            preserve_existing_database(&self.path, &self.metadata_directory.join("recovery"))?;
        if let Err(error) = fs::rename(&temporary, &self.path) {
            if preserved {
                restore_preserved_database(&self.path, &self.metadata_directory.join("recovery"))?;
            }
            return Err(index_io("installRebuiltIndex", &error));
        }
        let connection = open_index(&self.path)?;
        verify_integrity(&connection)?;
        checkpoint(&connection)?;
        Ok(preserved)
    }
}

fn open_index(path: &Path) -> Result<Connection, WorkspaceFailure> {
    let existed = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(index_corrupt("indexFileType"));
        }
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(index_io("inspectIndex", &error)),
    };
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| sqlite_failure("openIndex", &error))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| sqlite_failure("configureBusyTimeout", &error))?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| sqlite_failure("enableForeignKeys", &error))?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|error| sqlite_failure("configureDurability", &error))?;

    let application_id: i32 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|error| sqlite_failure("readApplicationId", &error))?;
    if existed && application_id != INDEX_APPLICATION_ID {
        return Err(index_corrupt("foreignDatabase"));
    }
    if !existed {
        connection
            .pragma_update(None, "application_id", INDEX_APPLICATION_ID)
            .map_err(|error| sqlite_failure("writeApplicationId", &error))?;
    }

    verify_integrity(&connection)?;
    migrate(&connection)?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| sqlite_failure("enableWal", &error))?;
    connection
        .pragma_update(None, "wal_autocheckpoint", 1_000)
        .map_err(|error| sqlite_failure("configureCheckpoint", &error))?;
    verify_schema(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), WorkspaceFailure> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| sqlite_failure("readSchemaVersion", &error))?;
    if version > INDEX_SCHEMA_VERSION {
        return Err(WorkspaceFailure::IndexSchemaTooNew {
            found: version,
            supported: INDEX_SCHEMA_VERSION,
        });
    }
    if version == INDEX_SCHEMA_VERSION {
        return Ok(());
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| sqlite_failure("beginMigration", &error))?;
    if version == 0 {
        transaction
            .execute_batch(
                "CREATE TABLE note_index (
                    note_id TEXT PRIMARY KEY NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    revision TEXT NOT NULL,
                    modified_at_millis INTEGER NOT NULL CHECK(modified_at_millis >= 0)
                ) STRICT;
                CREATE INDEX note_index_modified_at
                    ON note_index(modified_at_millis DESC);
                CREATE VIRTUAL TABLE note_fts USING fts5(
                    note_id UNINDEXED,
                    path UNINDEXED,
                    title,
                    markdown,
                    tokenize='trigram',
                    detail='full'
                );",
            )
            .map_err(|error| sqlite_failure("migrateSchemaV1", &error))?;
        transaction
            .pragma_update(None, "user_version", INDEX_SCHEMA_VERSION)
            .map_err(|error| sqlite_failure("recordSchemaVersion", &error))?;
    }
    transaction
        .commit()
        .map_err(|error| sqlite_failure("commitMigration", &error))
}

fn verify_schema(connection: &Connection) -> Result<(), WorkspaceFailure> {
    for table in ["note_index", "note_fts"] {
        let exists = connection
            .query_row(
                "SELECT 1 FROM sqlite_schema WHERE name = ?1 LIMIT 1",
                [table],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| sqlite_failure("verifySchema", &error))?
            .is_some();
        if !exists {
            return Err(index_corrupt("missingSchemaObject"));
        }
    }
    Ok(())
}

fn verify_integrity(connection: &Connection) -> Result<(), WorkspaceFailure> {
    let result: String = connection
        .pragma_query_value(None, "quick_check", |row| row.get(0))
        .map_err(|error| sqlite_failure("quickCheck", &error))?;
    if result != "ok" {
        return Err(index_corrupt("quickCheckFailed"));
    }
    Ok(())
}

fn synchronize_transaction(
    connection: &mut Connection,
    documents: &[IndexedDocument],
) -> Result<(), WorkspaceFailure> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| sqlite_failure("beginIndexSync", &error))?;
    transaction
        .execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS current_note_ids (
                note_id TEXT PRIMARY KEY
            ) WITHOUT ROWID;
            DELETE FROM current_note_ids;",
        )
        .map_err(|error| sqlite_failure("prepareIndexSync", &error))?;
    for document in documents {
        transaction
            .execute(
                "INSERT INTO current_note_ids(note_id) VALUES (?1)",
                [document.id.to_string()],
            )
            .map_err(|error| sqlite_failure("trackIndexedNote", &error))?;
        upsert_document(&transaction, document)?;
    }
    transaction
        .execute(
            "DELETE FROM note_fts
             WHERE note_id NOT IN (SELECT note_id FROM current_note_ids)",
            [],
        )
        .map_err(|error| sqlite_failure("pruneFullTextIndex", &error))?;
    transaction
        .execute(
            "DELETE FROM note_index
             WHERE note_id NOT IN (SELECT note_id FROM current_note_ids)",
            [],
        )
        .map_err(|error| sqlite_failure("pruneMetadataIndex", &error))?;
    transaction
        .commit()
        .map_err(|error| sqlite_failure("commitIndexSync", &error))
}

fn upsert_document(
    transaction: &Transaction<'_>,
    document: &IndexedDocument,
) -> Result<(), WorkspaceFailure> {
    let note_id = document.id.to_string();
    let current = transaction
        .query_row(
            "SELECT path, revision, title, kind, modified_at_millis
             FROM note_index WHERE note_id = ?1",
            [&note_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| sqlite_failure("readIndexedRevision", &error))?;
    let kind = kind_name(document.kind);
    let unchanged = current.is_some_and(|(path, revision, title, current_kind, modified)| {
        path == document.path.as_str()
            && revision == document.revision.as_str()
            && title == document.title
            && current_kind == kind
            && modified == sqlite_millis(document.modified_at_millis)
    });
    if unchanged {
        return Ok(());
    }

    transaction
        .execute(
            "DELETE FROM note_fts
             WHERE note_id IN (
                SELECT note_id FROM note_index WHERE path = ?1 AND note_id <> ?2
             ) OR note_id = ?2",
            params![document.path.as_str(), note_id],
        )
        .map_err(|error| sqlite_failure("replaceFullTextIndex", &error))?;
    transaction
        .execute(
            "DELETE FROM note_index WHERE path = ?1 AND note_id <> ?2",
            params![document.path.as_str(), note_id],
        )
        .map_err(|error| sqlite_failure("replacePathIdentity", &error))?;
    transaction
        .execute(
            "INSERT INTO note_index(
                note_id, path, title, kind, revision, modified_at_millis
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(note_id) DO UPDATE SET
                path = excluded.path,
                title = excluded.title,
                kind = excluded.kind,
                revision = excluded.revision,
                modified_at_millis = excluded.modified_at_millis",
            params![
                note_id,
                document.path.as_str(),
                document.title,
                kind,
                document.revision.as_str(),
                sqlite_millis(document.modified_at_millis),
            ],
        )
        .map_err(|error| sqlite_failure("upsertMetadataIndex", &error))?;
    transaction
        .execute(
            "INSERT INTO note_fts(note_id, path, title, markdown)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                note_id,
                document.path.as_str(),
                document.title,
                document.markdown,
            ],
        )
        .map_err(|error| sqlite_failure("upsertFullTextIndex", &error))?;
    Ok(())
}

fn search_trigram(
    connection: &Connection,
    query: &str,
    requested_limit: usize,
) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
    let literal_query = format!("\"{}\"", query.replace('"', "\"\""));
    let mut statement = connection
        .prepare(
            "SELECT i.note_id, i.title, i.path, i.kind,
                    snippet(note_fts, 3, '', '', ' … ', 18),
                    bm25(note_fts, 0.0, 0.0, 6.0, 1.0)
             FROM note_fts
             JOIN note_index AS i ON i.note_id = note_fts.note_id
             WHERE note_fts MATCH ?1
             ORDER BY 6 ASC, i.title ASC
             LIMIT ?2",
        )
        .map_err(|error| sqlite_failure("prepareSearch", &error))?;
    read_search_rows(
        statement
            .query(params![literal_query, bounded_limit(requested_limit)])
            .map_err(|error| sqlite_failure("executeSearch", &error))?,
    )
}

fn search_short_query(
    connection: &Connection,
    query: &str,
    requested_limit: usize,
) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
    let mut statement = connection
        .prepare(
            "SELECT i.note_id, i.title, i.path, i.kind,
                    substr(replace(replace(note_fts.markdown, char(13), ' '), char(10), ' '), 1, 180),
                    0.0
             FROM note_fts
             JOIN note_index AS i ON i.note_id = note_fts.note_id
             WHERE instr(lower(note_fts.title), lower(?1)) > 0
                OR instr(lower(note_fts.markdown), lower(?1)) > 0
             ORDER BY i.modified_at_millis DESC, i.title ASC
             LIMIT ?2",
        )
        .map_err(|error| sqlite_failure("prepareShortSearch", &error))?;
    read_search_rows(
        statement
            .query(params![query, bounded_limit(requested_limit)])
            .map_err(|error| sqlite_failure("executeShortSearch", &error))?,
    )
}

fn read_search_rows(
    mut rows: rusqlite::Rows<'_>,
) -> Result<Vec<SearchNoteResult>, WorkspaceFailure> {
    let mut results = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| sqlite_failure("readSearchResult", &error))?
    {
        let note_id: String = row
            .get(0)
            .map_err(|error| sqlite_failure("decodeSearchId", &error))?;
        let path: String = row
            .get(2)
            .map_err(|error| sqlite_failure("decodeSearchPath", &error))?;
        let kind: String = row
            .get(3)
            .map_err(|error| sqlite_failure("decodeSearchKind", &error))?;
        results.push(SearchNoteResult {
            id: note_id
                .parse::<NoteId>()
                .map_err(|_| index_corrupt("invalidNoteId"))?,
            title: row
                .get(1)
                .map_err(|error| sqlite_failure("decodeSearchTitle", &error))?,
            path: PortablePath::new_markdown(path)
                .map_err(|_| index_corrupt("invalidPortablePath"))?,
            kind: parse_kind(&kind).ok_or_else(|| index_corrupt("invalidNoteKind"))?,
            snippet: row
                .get(4)
                .map_err(|error| sqlite_failure("decodeSearchSnippet", &error))?,
            rank: row
                .get(5)
                .map_err(|error| sqlite_failure("decodeSearchRank", &error))?,
        });
    }
    Ok(results)
}

fn validate_search(request: &SearchNotesRequest) -> Result<&str, WorkspaceFailure> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err(WorkspaceFailure::InvalidSearch {
            kind: "empty".to_owned(),
        });
    }
    if request.limit == 0 {
        return Err(WorkspaceFailure::InvalidSearch {
            kind: "zeroLimit".to_owned(),
        });
    }
    if query.chars().count() > MAX_SEARCH_CHARS
        || query.chars().any(|character| {
            character == '\0' || (character.is_control() && !character.is_whitespace())
        })
    {
        return Err(WorkspaceFailure::InvalidSearch {
            kind: "unsafeOrTooLong".to_owned(),
        });
    }
    Ok(query)
}

fn bounded_limit(requested: usize) -> i64 {
    i64::try_from(requested.min(MAX_SEARCH_RESULTS)).unwrap_or(100)
}

fn sqlite_millis(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn checkpoint(connection: &Connection) -> Result<(), WorkspaceFailure> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .map_err(|error| sqlite_failure("checkpointIndex", &error))
}

fn remove_rebuild_artifacts(path: &Path) -> Result<(), WorkspaceFailure> {
    for candidate in database_artifacts(path) {
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(index_corrupt("rebuildArtifactType"));
            }
            Ok(_) => fs::remove_file(&candidate)
                .map_err(|error| index_io("removeStaleRebuild", &error))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(index_io("inspectRebuildArtifact", &error)),
        }
    }
    Ok(())
}

fn preserve_existing_database(path: &Path, recovery: &Path) -> Result<bool, WorkspaceFailure> {
    let mut artifacts = Vec::new();
    for candidate in database_artifacts(path) {
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(index_corrupt("indexArtifactType"));
            }
            Ok(_) => artifacts.push(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(index_io("inspectIndexArtifact", &error)),
        }
    }
    if artifacts.is_empty() {
        return Ok(false);
    }
    prepare_recovery_directory(recovery)?;
    let generation = next_recovery_generation(recovery)?;
    let mut moved = Vec::new();
    for artifact in artifacts.iter().rev() {
        let suffix = artifact
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix(INDEX_FILE_NAME))
            .unwrap_or_default();
        let destination = recovery.join(format!(
            "index-before-rebuild-{generation:04}.sqlite3{suffix}"
        ));
        if let Err(error) = fs::rename(artifact, &destination) {
            for (source, saved) in moved.into_iter().rev() {
                let _ = fs::rename(saved, source);
            }
            return Err(index_io("preservePreviousIndex", &error));
        }
        moved.push((artifact.clone(), destination));
    }
    Ok(true)
}

fn prepare_recovery_directory(recovery: &Path) -> Result<(), WorkspaceFailure> {
    match fs::symlink_metadata(recovery) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(index_corrupt("recoveryDirectoryType"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(recovery).map_err(|error| index_io("createIndexRecovery", &error))?;
        }
        Err(error) => return Err(index_io("inspectIndexRecovery", &error)),
    }
    Ok(())
}

fn restore_preserved_database(path: &Path, recovery: &Path) -> Result<(), WorkspaceFailure> {
    let Some(generation) = latest_recovery_generation(recovery)? else {
        return Ok(());
    };
    for suffix in ["", "-wal", "-shm"] {
        let saved = recovery.join(format!(
            "index-before-rebuild-{generation:04}.sqlite3{suffix}"
        ));
        if saved.exists() {
            fs::rename(&saved, artifact_path(path, suffix))
                .map_err(|error| index_io("restorePreviousIndex", &error))?;
        }
    }
    Ok(())
}

fn next_recovery_generation(recovery: &Path) -> Result<u32, WorkspaceFailure> {
    Ok(latest_recovery_generation(recovery)?.map_or(1, |value| value.saturating_add(1)))
}

fn latest_recovery_generation(recovery: &Path) -> Result<Option<u32>, WorkspaceFailure> {
    let mut latest = None;
    for entry in fs::read_dir(recovery).map_err(|error| index_io("readIndexRecovery", &error))? {
        let entry = entry.map_err(|error| index_io("readIndexRecoveryEntry", &error))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(number) = name
            .strip_prefix("index-before-rebuild-")
            .and_then(|rest| rest.strip_suffix(".sqlite3"))
            .and_then(|number| number.parse::<u32>().ok())
        else {
            continue;
        };
        latest = Some(latest.map_or(number, |current: u32| current.max(number)));
    }
    Ok(latest)
}

fn database_artifacts(path: &Path) -> [PathBuf; 3] {
    [
        path.to_owned(),
        artifact_path(path, "-wal"),
        artifact_path(path, "-shm"),
    ]
}

fn artifact_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

fn kind_name(kind: NoteKind) -> &'static str {
    match kind {
        NoteKind::Topic => "topic",
        NoteKind::Node => "node",
        NoteKind::Source => "source",
        NoteKind::Paper => "paper",
        NoteKind::Experiment => "experiment",
        NoteKind::EnglishTerm => "english_term",
        NoteKind::ReviewCard => "review_card",
        NoteKind::Daily => "daily",
        NoteKind::Note => "note",
    }
}

fn parse_kind(value: &str) -> Option<NoteKind> {
    match value {
        "topic" => Some(NoteKind::Topic),
        "node" => Some(NoteKind::Node),
        "source" => Some(NoteKind::Source),
        "paper" => Some(NoteKind::Paper),
        "experiment" => Some(NoteKind::Experiment),
        "english_term" => Some(NoteKind::EnglishTerm),
        "review_card" => Some(NoteKind::ReviewCard),
        "daily" => Some(NoteKind::Daily),
        "note" => Some(NoteKind::Note),
        _ => None,
    }
}

fn sqlite_failure(operation: &str, error: &SqliteError) -> WorkspaceFailure {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => {
            index_corrupt("sqliteIntegrity")
        }
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => {
            index_unavailable(operation, "busy")
        }
        Some(ErrorCode::DiskFull) => index_unavailable(operation, "storageFull"),
        Some(ErrorCode::ReadOnly | ErrorCode::PermissionDenied) => {
            index_unavailable(operation, "permissionDenied")
        }
        _ => index_unavailable(operation, "other"),
    }
}

fn index_corrupt(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::IndexCorrupt {
        kind: kind.to_owned(),
    }
}

fn index_unavailable(operation: &str, kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::IndexUnavailable {
        operation: operation.to_owned(),
        kind: kind.to_owned(),
    }
}

fn index_io(operation: &str, error: &std::io::Error) -> WorkspaceFailure {
    index_unavailable(
        operation,
        match error.kind() {
            std::io::ErrorKind::PermissionDenied => "permissionDenied",
            std::io::ErrorKind::StorageFull => "storageFull",
            std::io::ErrorKind::AlreadyExists => "alreadyExists",
            _ => "other",
        },
    )
}
