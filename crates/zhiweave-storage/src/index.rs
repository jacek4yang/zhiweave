use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{
    Connection, Error as SqliteError, ErrorCode, OpenFlags, OptionalExtension, Transaction,
    TransactionBehavior, params, params_from_iter,
};
use zhiweave_application::{
    BacklinkReference, BacklinkReferenceKind, BacklinksRequest, IndexState, IndexStatus,
    LocalGraph, LocalGraphEdge, LocalGraphNode, LocalGraphRequest, ResolveWikiTargetRequest,
    ResolvedWikiTargetNote, SearchNoteResult, SearchNotesRequest, WikiTargetCreationProposal,
    WikiTargetResolution, WikiTargetResolutionState, WorkspaceFailure,
};
use zhiweave_domain::{NoteId, NoteKind, PortablePath};
use zhiweave_markdown::{WikiReference, WikiReferenceKind};

use crate::IndexedDocument;

pub(crate) const INDEX_SCHEMA_VERSION: u32 = 2;
const INDEX_APPLICATION_ID: i32 = 0x5a48_5756;
const MAX_SEARCH_CHARS: usize = 256;
const MAX_SEARCH_RESULTS: usize = 100;
const MAX_BACKLINK_RESULTS: usize = 200;
const MAX_LOCAL_GRAPH_NODES: usize = 80;
const MAX_WIKI_TARGET_CHARS: usize = 500;
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
        match upsert_document(&transaction, document)? {
            IndexUpdate::Unchanged => {}
            IndexUpdate::SourceOnly => {
                resolve_wiki_edges(&transaction, Some(document.id))?;
            }
            IndexUpdate::TargetMetadataChanged => {
                resolve_wiki_edges(&transaction, None)?;
            }
        }
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

    pub(crate) fn backlinks(
        &self,
        request: &BacklinksRequest,
    ) -> Result<Vec<BacklinkReference>, WorkspaceFailure> {
        if request.limit == 0 {
            return Err(WorkspaceFailure::InvalidSearch {
                kind: "zeroBacklinkLimit".to_owned(),
            });
        }
        let connection = open_index(&self.path)?;
        read_backlinks(
            &connection,
            request.note_id,
            request.limit.min(MAX_BACKLINK_RESULTS),
        )
    }

    pub(crate) fn local_graph(
        &self,
        request: &LocalGraphRequest,
    ) -> Result<LocalGraph, WorkspaceFailure> {
        if request.node_limit == 0 {
            return Err(WorkspaceFailure::InvalidGraphRequest {
                kind: "zeroNodeLimit".to_owned(),
            });
        }
        let connection = open_index(&self.path)?;
        read_local_graph(
            &connection,
            request.note_id,
            request.node_limit.min(MAX_LOCAL_GRAPH_NODES),
        )
    }

    pub(crate) fn resolve_wiki_target(
        &self,
        request: &ResolveWikiTargetRequest,
    ) -> Result<WikiTargetResolution, WorkspaceFailure> {
        let raw_target = request.raw_target.trim();
        if raw_target.is_empty() {
            return Err(WorkspaceFailure::InvalidWikiTarget {
                kind: "emptyTarget".to_owned(),
            });
        }
        if raw_target.chars().count() > MAX_WIKI_TARGET_CHARS {
            return Err(WorkspaceFailure::InvalidWikiTarget {
                kind: "targetTooLong".to_owned(),
            });
        }
        if raw_target
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\0'))
        {
            return Err(WorkspaceFailure::InvalidWikiTarget {
                kind: "invalidTargetCharacter".to_owned(),
            });
        }

        let connection = open_index(&self.path)?;
        let targets = read_wiki_targets(&connection)?;
        let source = targets.notes.get(&request.source_note_id).ok_or_else(|| {
            WorkspaceFailure::InvalidWikiTarget {
                kind: "unknownSourceNote".to_owned(),
            }
        })?;
        let heading = raw_target
            .split_once('#')
            .map(|(_, value)| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let (state, target) = match resolve_wiki_target_id(
            request.source_note_id,
            raw_target,
            &targets.paths,
            &targets.names,
        ) {
            WikiResolution::Resolved(id) => (
                WikiTargetResolutionState::Resolved,
                targets.notes.get(&id).cloned(),
            ),
            WikiResolution::Missing => (WikiTargetResolutionState::Missing, None),
            WikiResolution::Ambiguous => (WikiTargetResolutionState::Ambiguous, None),
        };
        if state == WikiTargetResolutionState::Resolved && target.is_none() {
            return Err(index_corrupt("missingResolvedWikiTarget"));
        }
        let creation = (state == WikiTargetResolutionState::Missing)
            .then(|| wiki_creation_proposal(raw_target, source, &targets.paths, heading.clone()))
            .flatten();
        Ok(WikiTargetResolution {
            raw_target: raw_target.to_owned(),
            state,
            target,
            heading,
            creation,
        })
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
    }
    if version <= 1 {
        transaction
            .execute_batch(
                "ALTER TABLE note_index ADD COLUMN wiki_revision TEXT;
                CREATE TABLE wiki_edge (
                    source_note_id TEXT NOT NULL
                        REFERENCES note_index(note_id) ON DELETE CASCADE,
                    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
                    reference_kind TEXT NOT NULL
                        CHECK(reference_kind IN ('link', 'embed')),
                    raw_target TEXT NOT NULL
                        CHECK(length(raw_target) BETWEEN 1 AND 500),
                    target_note_id TEXT
                        REFERENCES note_index(note_id) ON DELETE SET NULL,
                    resolution TEXT NOT NULL
                        CHECK(resolution IN ('missing', 'ambiguous', 'resolved')),
                    source_start INTEGER NOT NULL CHECK(source_start >= 0),
                    source_end INTEGER NOT NULL CHECK(source_end > source_start),
                    line INTEGER NOT NULL CHECK(line >= 1),
                    column_number INTEGER NOT NULL CHECK(column_number >= 1),
                    context TEXT NOT NULL,
                    PRIMARY KEY(source_note_id, ordinal)
                ) STRICT;
                CREATE INDEX wiki_edge_target
                    ON wiki_edge(target_note_id, source_note_id);
                CREATE INDEX wiki_edge_unresolved
                    ON wiki_edge(resolution, raw_target);",
            )
            .map_err(|error| sqlite_failure("migrateSchemaV2", &error))?;
    }
    transaction
        .pragma_update(None, "user_version", INDEX_SCHEMA_VERSION)
        .map_err(|error| sqlite_failure("recordSchemaVersion", &error))?;
    transaction
        .commit()
        .map_err(|error| sqlite_failure("commitMigration", &error))
}

fn verify_schema(connection: &Connection) -> Result<(), WorkspaceFailure> {
    for table in ["note_index", "note_fts", "wiki_edge"] {
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
        let _ = upsert_document(&transaction, document)?;
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
    resolve_wiki_edges(&transaction, None)?;
    transaction
        .commit()
        .map_err(|error| sqlite_failure("commitIndexSync", &error))
}

fn upsert_document(
    transaction: &Transaction<'_>,
    document: &IndexedDocument,
) -> Result<IndexUpdate, WorkspaceFailure> {
    let note_id = document.id.to_string();
    let current = transaction
        .query_row(
            "SELECT path, revision, title, kind, modified_at_millis, wiki_revision
             FROM note_index WHERE note_id = ?1",
            [&note_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| sqlite_failure("readIndexedRevision", &error))?;
    let kind = kind_name(document.kind);
    let unchanged = current.as_ref().is_some_and(
        |(path, revision, title, current_kind, modified, wiki_revision)| {
            path == document.path.as_str()
                && revision == document.revision.as_str()
                && title == &document.title
                && current_kind == kind
                && *modified == sqlite_millis(document.modified_at_millis)
                && wiki_revision.as_deref() == Some(document.revision.as_str())
        },
    );
    if unchanged {
        return Ok(IndexUpdate::Unchanged);
    }
    let target_metadata_changed = current.as_ref().is_none_or(|(path, _, title, _, _, _)| {
        path != document.path.as_str() || title != &document.title
    });

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
                note_id, path, title, kind, revision, modified_at_millis, wiki_revision
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
             ON CONFLICT(note_id) DO UPDATE SET
                path = excluded.path,
                title = excluded.title,
                kind = excluded.kind,
                revision = excluded.revision,
                modified_at_millis = excluded.modified_at_millis,
                wiki_revision = excluded.wiki_revision",
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
    replace_wiki_edges(transaction, &note_id, &document.wiki_references)?;
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
    Ok(if target_metadata_changed {
        IndexUpdate::TargetMetadataChanged
    } else {
        IndexUpdate::SourceOnly
    })
}

enum IndexUpdate {
    Unchanged,
    SourceOnly,
    TargetMetadataChanged,
}

fn replace_wiki_edges(
    transaction: &Transaction<'_>,
    note_id: &str,
    references: &[WikiReference],
) -> Result<(), WorkspaceFailure> {
    transaction
        .execute("DELETE FROM wiki_edge WHERE source_note_id = ?1", [note_id])
        .map_err(|error| sqlite_failure("replaceWikiEdges", &error))?;
    for (ordinal, reference) in references.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO wiki_edge(
                    source_note_id, ordinal, reference_kind, raw_target,
                    target_note_id, resolution, source_start, source_end,
                    line, column_number, context
                 ) VALUES (?1, ?2, ?3, ?4, NULL, 'missing', ?5, ?6, ?7, ?8, ?9)",
                params![
                    note_id,
                    sqlite_usize(ordinal),
                    wiki_reference_kind_name(reference.kind),
                    reference.target,
                    sqlite_usize(reference.byte_start),
                    sqlite_usize(reference.byte_end),
                    sqlite_usize(reference.line),
                    sqlite_usize(reference.column),
                    reference.context,
                ],
            )
            .map_err(|error| sqlite_failure("insertWikiEdge", &error))?;
    }
    Ok(())
}

fn resolve_wiki_edges(
    transaction: &Transaction<'_>,
    source_filter: Option<NoteId>,
) -> Result<(), WorkspaceFailure> {
    let targets = read_wiki_targets(transaction)?;

    let edges = if let Some(source_id) = source_filter {
        let mut statement = transaction
            .prepare(
                "SELECT source_note_id, ordinal, raw_target
                 FROM wiki_edge
                 WHERE source_note_id = ?1
                 ORDER BY ordinal",
            )
            .map_err(|error| sqlite_failure("prepareWikiEdges", &error))?;
        let rows = statement
            .query_map([source_id.to_string()], decode_wiki_edge)
            .map_err(|error| sqlite_failure("queryWikiEdges", &error))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| sqlite_failure("readWikiEdges", &error))?
    } else {
        let mut statement = transaction
            .prepare(
                "SELECT source_note_id, ordinal, raw_target
                 FROM wiki_edge ORDER BY source_note_id, ordinal",
            )
            .map_err(|error| sqlite_failure("prepareWikiEdges", &error))?;
        let rows = statement
            .query_map([], decode_wiki_edge)
            .map_err(|error| sqlite_failure("queryWikiEdges", &error))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| sqlite_failure("readWikiEdges", &error))?
    };
    for (raw_source_id, ordinal, raw_target) in edges {
        let source_id = raw_source_id
            .parse::<NoteId>()
            .map_err(|_| index_corrupt("invalidWikiSourceId"))?;
        let resolution =
            resolve_wiki_target_id(source_id, &raw_target, &targets.paths, &targets.names);
        let (target_id, state) = match resolution {
            WikiResolution::Resolved(id) => (Some(id.to_string()), "resolved"),
            WikiResolution::Missing => (None, "missing"),
            WikiResolution::Ambiguous => (None, "ambiguous"),
        };
        transaction
            .execute(
                "UPDATE wiki_edge
                 SET target_note_id = ?1, resolution = ?2
                 WHERE source_note_id = ?3 AND ordinal = ?4",
                params![target_id, state, raw_source_id, ordinal],
            )
            .map_err(|error| sqlite_failure("resolveWikiEdge", &error))?;
    }
    Ok(())
}

fn decode_wiki_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, i64, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
}

enum WikiResolution {
    Resolved(NoteId),
    Missing,
    Ambiguous,
}

struct WikiTargets {
    paths: HashMap<String, BTreeSet<NoteId>>,
    names: HashMap<String, BTreeSet<NoteId>>,
    notes: HashMap<NoteId, ResolvedWikiTargetNote>,
}

fn read_wiki_targets(connection: &Connection) -> Result<WikiTargets, WorkspaceFailure> {
    let mut statement = connection
        .prepare("SELECT note_id, path, title, kind FROM note_index ORDER BY note_id")
        .map_err(|error| sqlite_failure("prepareWikiTargets", &error))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| sqlite_failure("queryWikiTargets", &error))?;
    let notes = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| sqlite_failure("readWikiTargets", &error))?;
    let mut targets = WikiTargets {
        paths: HashMap::new(),
        names: HashMap::new(),
        notes: HashMap::new(),
    };
    for (raw_id, raw_path, title, raw_kind) in notes {
        let id = raw_id
            .parse::<NoteId>()
            .map_err(|_| index_corrupt("invalidWikiTargetId"))?;
        let path = PortablePath::new_markdown(&raw_path)
            .map_err(|_| index_corrupt("invalidWikiTargetPath"))?;
        let kind = parse_kind(&raw_kind).ok_or_else(|| index_corrupt("invalidWikiTargetKind"))?;
        targets
            .paths
            .entry(wiki_key(path.as_str()))
            .or_default()
            .insert(id);
        targets
            .names
            .entry(wiki_key(&title))
            .or_default()
            .insert(id);
        targets
            .names
            .entry(wiki_key(file_stem(path.as_str())))
            .or_default()
            .insert(id);
        targets.notes.insert(
            id,
            ResolvedWikiTargetNote {
                id,
                title,
                path,
                kind,
            },
        );
    }
    Ok(targets)
}

fn resolve_wiki_target_id(
    source_id: NoteId,
    raw_target: &str,
    paths: &HashMap<String, BTreeSet<NoteId>>,
    names: &HashMap<String, BTreeSet<NoteId>>,
) -> WikiResolution {
    let authored = raw_target.trim();
    let target = authored.split('#').next().unwrap_or_default().trim();
    if target.is_empty() {
        return if authored.starts_with('#') {
            WikiResolution::Resolved(source_id)
        } else {
            WikiResolution::Missing
        };
    }
    let target = target.strip_prefix("./").unwrap_or(target);
    let path_target = if target
        .rsplit_once('.')
        .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("md"))
    {
        target.to_owned()
    } else {
        format!("{target}.md")
    };
    if let Some(candidates) = paths.get(&wiki_key(&path_target)) {
        return match candidates.len() {
            0 => WikiResolution::Missing,
            1 => candidates
                .first()
                .copied()
                .map_or(WikiResolution::Missing, WikiResolution::Resolved),
            _ => WikiResolution::Ambiguous,
        };
    }
    if target.contains('/') || target.contains('\\') {
        return WikiResolution::Missing;
    }

    let name_target = target
        .rsplit_once('.')
        .filter(|(_, extension)| extension.eq_ignore_ascii_case("md"))
        .map_or(target, |(stem, _)| stem);
    match names.get(&wiki_key(name_target)) {
        Some(candidates) if candidates.len() == 1 => candidates
            .first()
            .copied()
            .map_or(WikiResolution::Missing, WikiResolution::Resolved),
        Some(candidates) if !candidates.is_empty() => WikiResolution::Ambiguous,
        _ => WikiResolution::Missing,
    }
}

fn wiki_key(value: &str) -> String {
    value.trim().to_lowercase()
}

fn file_stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .filter(|(_, extension)| extension.eq_ignore_ascii_case("md"))
        .map_or(name, |(stem, _)| stem)
}

fn wiki_creation_proposal(
    raw_target: &str,
    source: &ResolvedWikiTargetNote,
    paths: &HashMap<String, BTreeSet<NoteId>>,
    heading: Option<String>,
) -> Option<WikiTargetCreationProposal> {
    let authored = raw_target.trim();
    let target = authored.split('#').next()?.trim();
    if target.is_empty() {
        return None;
    }
    let target = target.strip_prefix("./").unwrap_or(target);
    let has_directory = target.contains('/') || target.contains('\\');
    let has_markdown_extension = target
        .rsplit_once('.')
        .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("md"));

    if has_directory {
        let path_target = if has_markdown_extension {
            target.to_owned()
        } else {
            format!("{target}.md")
        };
        let path = PortablePath::new_markdown(path_target).ok()?;
        if paths.contains_key(&wiki_key(path.as_str())) {
            return None;
        }
        let title = file_stem(path.as_str()).trim().to_owned();
        return (!title.is_empty()).then_some(WikiTargetCreationProposal {
            title,
            path,
            heading,
        });
    }

    let title = if has_markdown_extension {
        target
            .rsplit_once('.')
            .map_or(target, |(stem, _)| stem)
            .trim()
    } else {
        target
    };
    if title.is_empty() {
        return None;
    }
    let filename = portable_wiki_filename(title);
    let source_directory = source
        .path
        .as_str()
        .rsplit_once('/')
        .map(|(value, _)| value);
    for suffix in 1..=100 {
        let name = if suffix == 1 {
            format!("{filename}.md")
        } else {
            format!("{filename}-{suffix}.md")
        };
        let candidate = source_directory
            .map_or_else(|| name.clone(), |directory| format!("{directory}/{name}"));
        let path = PortablePath::new_markdown(candidate).ok()?;
        if !paths.contains_key(&wiki_key(path.as_str())) {
            return Some(WikiTargetCreationProposal {
                title: title.to_owned(),
                path,
                heading,
            });
        }
    }
    None
}

fn portable_wiki_filename(title: &str) -> String {
    let mut filename = String::new();
    let mut previous_separator = false;
    for character in title.trim().chars() {
        if filename.chars().count() >= 80 {
            break;
        }
        let invalid = character.is_control() || r#"<>:"/\|?*"#.contains(character);
        if character.is_whitespace() || invalid {
            if !filename.is_empty() && !previous_separator {
                filename.push('-');
                previous_separator = true;
            }
        } else {
            filename.push(character);
            previous_separator = false;
        }
    }
    let filename = filename.trim_matches([' ', '.', '-']);
    if filename.is_empty() {
        "node".to_owned()
    } else if PortablePath::new_markdown(format!("{filename}.md")).is_ok() {
        filename.to_owned()
    } else {
        format!("node-{filename}")
    }
}

fn wiki_reference_kind_name(kind: WikiReferenceKind) -> &'static str {
    match kind {
        WikiReferenceKind::Link => "link",
        WikiReferenceKind::Embed => "embed",
    }
}

fn read_backlinks(
    connection: &Connection,
    note_id: NoteId,
    limit: usize,
) -> Result<Vec<BacklinkReference>, WorkspaceFailure> {
    let mut statement = connection
        .prepare(
            "SELECT source.note_id, source.title, source.path, source.kind,
                    edge.reference_kind, edge.raw_target, edge.source_start,
                    edge.source_end, edge.line, edge.column_number, edge.context
             FROM wiki_edge AS edge
             JOIN note_index AS source ON source.note_id = edge.source_note_id
             WHERE edge.target_note_id = ?1 AND edge.resolution = 'resolved'
             ORDER BY source.modified_at_millis DESC, source.title ASC,
                      edge.line ASC, edge.column_number ASC
             LIMIT ?2",
        )
        .map_err(|error| sqlite_failure("prepareBacklinks", &error))?;
    let mut rows = statement
        .query(params![note_id.to_string(), sqlite_usize(limit)])
        .map_err(|error| sqlite_failure("queryBacklinks", &error))?;
    let mut results = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| sqlite_failure("readBacklink", &error))?
    {
        let raw_source_id: String = row
            .get(0)
            .map_err(|error| sqlite_failure("decodeBacklinkSourceId", &error))?;
        let raw_path: String = row
            .get(2)
            .map_err(|error| sqlite_failure("decodeBacklinkPath", &error))?;
        let raw_kind: String = row
            .get(3)
            .map_err(|error| sqlite_failure("decodeBacklinkNoteKind", &error))?;
        let reference_kind: String = row
            .get(4)
            .map_err(|error| sqlite_failure("decodeBacklinkKind", &error))?;
        results.push(BacklinkReference {
            source_note_id: raw_source_id
                .parse::<NoteId>()
                .map_err(|_| index_corrupt("invalidBacklinkSourceId"))?,
            source_title: row
                .get(1)
                .map_err(|error| sqlite_failure("decodeBacklinkTitle", &error))?,
            source_path: PortablePath::new_markdown(raw_path)
                .map_err(|_| index_corrupt("invalidBacklinkPath"))?,
            source_kind: parse_kind(&raw_kind)
                .ok_or_else(|| index_corrupt("invalidBacklinkNoteKind"))?,
            reference_kind: match reference_kind.as_str() {
                "link" => BacklinkReferenceKind::Link,
                "embed" => BacklinkReferenceKind::Embed,
                _ => return Err(index_corrupt("invalidBacklinkKind")),
            },
            raw_target: row
                .get(5)
                .map_err(|error| sqlite_failure("decodeBacklinkTarget", &error))?,
            source_byte_start: read_usize(row, 6, "invalidBacklinkStart")?,
            source_byte_end: read_usize(row, 7, "invalidBacklinkEnd")?,
            line: read_usize(row, 8, "invalidBacklinkLine")?,
            column: read_usize(row, 9, "invalidBacklinkColumn")?,
            context: row
                .get(10)
                .map_err(|error| sqlite_failure("decodeBacklinkContext", &error))?,
        });
    }
    Ok(results)
}

fn read_local_graph(
    connection: &Connection,
    root_note_id: NoteId,
    node_limit: usize,
) -> Result<LocalGraph, WorkspaceFailure> {
    let root = read_local_graph_root(connection, root_note_id)?;
    let (nodes, selected, truncated) =
        read_local_graph_nodes(connection, root_note_id, node_limit, root)?;
    let edges = read_local_graph_edges(connection, root_note_id, &selected)?;
    Ok(LocalGraph {
        root_note_id,
        nodes,
        edges,
        truncated,
    })
}

fn read_local_graph_root(
    connection: &Connection,
    root_note_id: NoteId,
) -> Result<LocalGraphNode, WorkspaceFailure> {
    let root = connection
        .query_row(
            "SELECT title, path, kind FROM note_index WHERE note_id = ?1",
            [root_note_id.to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| sqlite_failure("queryLocalGraphRoot", &error))?
        .ok_or_else(|| WorkspaceFailure::InvalidGraphRequest {
            kind: "unknownRootNote".to_owned(),
        })?;
    decode_local_graph_node(root_note_id, root.0, root.1, &root.2)
}

fn read_local_graph_nodes(
    connection: &Connection,
    root_note_id: NoteId,
    node_limit: usize,
    root: LocalGraphNode,
) -> Result<(Vec<LocalGraphNode>, BTreeSet<NoteId>, bool), WorkspaceFailure> {
    let neighbor_query_limit = node_limit;
    let mut neighbor_statement = connection
        .prepare(
            "SELECT neighbor.note_id, neighbor.title, neighbor.path, neighbor.kind,
                    COUNT(*) AS occurrence_count
             FROM wiki_edge AS edge
             JOIN note_index AS neighbor
               ON neighbor.note_id =
                  CASE WHEN edge.source_note_id = ?1
                       THEN edge.target_note_id ELSE edge.source_note_id END
             WHERE edge.resolution = 'resolved'
               AND (edge.source_note_id = ?1 OR edge.target_note_id = ?1)
               AND neighbor.note_id <> ?1
             GROUP BY neighbor.note_id, neighbor.title, neighbor.path, neighbor.kind
             ORDER BY occurrence_count DESC,
                      neighbor.title COLLATE NOCASE, neighbor.note_id
             LIMIT ?2",
        )
        .map_err(|error| sqlite_failure("prepareLocalGraphNeighbors", &error))?;
    let mut neighbor_rows = neighbor_statement
        .query(params![
            root_note_id.to_string(),
            sqlite_usize(neighbor_query_limit)
        ])
        .map_err(|error| sqlite_failure("queryLocalGraphNeighbors", &error))?;
    let mut nodes = vec![root];
    let mut selected = BTreeSet::from([root_note_id]);
    let mut truncated = false;
    while let Some(row) = neighbor_rows
        .next()
        .map_err(|error| sqlite_failure("readLocalGraphNeighbor", &error))?
    {
        let raw_neighbor_id: String = row
            .get(0)
            .map_err(|error| sqlite_failure("decodeLocalGraphNeighborId", &error))?;
        let neighbor_id = raw_neighbor_id
            .parse::<NoteId>()
            .map_err(|_| index_corrupt("invalidLocalGraphNeighborId"))?;
        if nodes.len() >= node_limit {
            truncated = true;
            break;
        }
        nodes.push(decode_local_graph_node(
            neighbor_id,
            row.get(1)
                .map_err(|error| sqlite_failure("decodeLocalGraphNeighborTitle", &error))?,
            row.get(2)
                .map_err(|error| sqlite_failure("decodeLocalGraphNeighborPath", &error))?,
            &row.get::<_, String>(3)
                .map_err(|error| sqlite_failure("decodeLocalGraphNeighborKind", &error))?,
        )?);
        selected.insert(neighbor_id);
    }
    Ok((nodes, selected, truncated))
}

fn read_local_graph_edges(
    connection: &Connection,
    root_note_id: NoteId,
    selected: &BTreeSet<NoteId>,
) -> Result<Vec<LocalGraphEdge>, WorkspaceFailure> {
    let placeholders = (2..=selected.len() + 1)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let edge_query = format!(
        "SELECT edge.source_note_id, edge.target_note_id, edge.reference_kind,
                COUNT(*) AS occurrence_count
         FROM wiki_edge AS edge
         WHERE edge.resolution = 'resolved'
           AND (edge.source_note_id = ?1 OR edge.target_note_id = ?1)
           AND CASE WHEN edge.source_note_id = ?1
                    THEN edge.target_note_id ELSE edge.source_note_id END
               IN ({placeholders})
         GROUP BY edge.source_note_id, edge.target_note_id, edge.reference_kind
         ORDER BY edge.source_note_id, edge.target_note_id, edge.reference_kind"
    );
    let mut edge_statement = connection
        .prepare(&edge_query)
        .map_err(|error| sqlite_failure("prepareLocalGraphEdges", &error))?;
    let mut edge_parameters = Vec::with_capacity(selected.len() + 1);
    edge_parameters.push(root_note_id.to_string());
    edge_parameters.extend(selected.iter().map(ToString::to_string));
    let mut edge_rows = edge_statement
        .query(params_from_iter(edge_parameters.iter()))
        .map_err(|error| sqlite_failure("queryLocalGraphEdges", &error))?;
    let mut edges = Vec::new();
    while let Some(row) = edge_rows
        .next()
        .map_err(|error| sqlite_failure("readLocalGraphEdge", &error))?
    {
        let raw_source_id: String = row
            .get(0)
            .map_err(|error| sqlite_failure("decodeLocalGraphSourceId", &error))?;
        let raw_target_id: String = row
            .get(1)
            .map_err(|error| sqlite_failure("decodeLocalGraphTargetId", &error))?;
        let source_note_id = raw_source_id
            .parse::<NoteId>()
            .map_err(|_| index_corrupt("invalidLocalGraphSourceId"))?;
        let target_note_id = raw_target_id
            .parse::<NoteId>()
            .map_err(|_| index_corrupt("invalidLocalGraphTargetId"))?;
        let reference_kind: String = row
            .get(2)
            .map_err(|error| sqlite_failure("decodeLocalGraphKind", &error))?;
        edges.push(LocalGraphEdge {
            source_note_id,
            target_note_id,
            reference_kind: match reference_kind.as_str() {
                "link" => BacklinkReferenceKind::Link,
                "embed" => BacklinkReferenceKind::Embed,
                _ => return Err(index_corrupt("invalidLocalGraphKind")),
            },
            occurrence_count: read_usize(row, 3, "invalidLocalGraphOccurrenceCount")?,
        });
    }
    Ok(edges)
}

fn decode_local_graph_node(
    id: NoteId,
    title: String,
    raw_path: String,
    raw_kind: &str,
) -> Result<LocalGraphNode, WorkspaceFailure> {
    Ok(LocalGraphNode {
        id,
        title,
        path: PortablePath::new_markdown(raw_path)
            .map_err(|_| index_corrupt("invalidLocalGraphPath"))?,
        kind: parse_kind(raw_kind).ok_or_else(|| index_corrupt("invalidLocalGraphNoteKind"))?,
    })
}

fn read_usize(
    row: &rusqlite::Row<'_>,
    column: usize,
    corruption_kind: &str,
) -> Result<usize, WorkspaceFailure> {
    let value: i64 = row
        .get(column)
        .map_err(|error| sqlite_failure("decodeBacklinkOffset", &error))?;
    usize::try_from(value).map_err(|_| index_corrupt(corruption_kind))
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

fn sqlite_usize(value: usize) -> i64 {
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
