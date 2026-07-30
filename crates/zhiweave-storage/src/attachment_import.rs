use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use zhiweave_application::{
    AttachmentImportPresentation, AttachmentImportProposal, ImportAttachmentRequest,
    MAX_ATTACHMENT_IMPORT_BYTES, ProposeAttachmentImportRequest, WorkspaceFailure,
};
use zhiweave_domain::{PortablePath, PortableResourcePath};

use crate::attachment::{hex_digest, is_safe_inline_image};

const ATTACHMENTS_DIRECTORY: &str = "attachments";
const MAX_FILENAME_BYTES: usize = 180;
const MAX_COLLISION_ATTEMPTS: usize = 1_000;

pub(crate) fn propose_import(
    root: &Path,
    source_path: &PortablePath,
    request: &ProposeAttachmentImportRequest,
) -> Result<AttachmentImportProposal, WorkspaceFailure> {
    build_proposal(
        root,
        source_path,
        request.source_note_id,
        &request.original_file_name,
        &request.bytes,
    )
}

fn build_proposal(
    root: &Path,
    source_path: &PortablePath,
    source_note_id: zhiweave_domain::NoteId,
    original_file_name: &str,
    bytes: &[u8],
) -> Result<AttachmentImportProposal, WorkspaceFailure> {
    validate_bytes(bytes)?;
    let file_name = sanitize_file_name(original_file_name)?;
    let path = next_available_path(root, &file_name)?;
    let byte_length = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let content_sha256 = hex_digest(bytes);
    let presentation = if is_safe_inline_image(path.as_str(), bytes) {
        AttachmentImportPresentation::InlineImage
    } else {
        AttachmentImportPresentation::EmbeddedFile
    };
    let markdown_reference = match presentation {
        AttachmentImportPresentation::InlineImage => {
            let target = relative_target(source_path, &path);
            let alt = file_stem(&file_name);
            format!("![{alt}]({target})")
        }
        AttachmentImportPresentation::EmbeddedFile => format!("![[{path}]]"),
    };
    Ok(AttachmentImportProposal {
        source_note_id,
        original_file_name: original_file_name.to_owned(),
        path,
        markdown_reference,
        presentation,
        byte_length,
        content_sha256,
    })
}

pub(crate) fn commit_import(
    root: &Path,
    source_path: &PortablePath,
    request: &ImportAttachmentRequest,
) -> Result<AttachmentImportProposal, WorkspaceFailure> {
    let proposal = build_proposal(
        root,
        source_path,
        request.source_note_id,
        &request.original_file_name,
        &request.bytes,
    )?;
    if proposal.path != request.expected_path {
        return Err(invalid_import("staleDestination"));
    }
    if proposal.markdown_reference != request.expected_markdown_reference {
        return Err(invalid_import("staleSourceLocation"));
    }
    if proposal.presentation != request.expected_presentation {
        return Err(invalid_import("presentationMismatch"));
    }
    if proposal.byte_length != request.expected_byte_length {
        return Err(invalid_import("contentLengthMismatch"));
    }
    if proposal.content_sha256 != request.expected_content_sha256 {
        return Err(invalid_import("contentDigestMismatch"));
    }

    let attachments = ensure_attachments_directory(root)?;
    let file_name = proposal
        .path
        .as_str()
        .strip_prefix("attachments/")
        .ok_or_else(|| invalid_import("invalidDestination"))?;
    if file_name.contains('/') {
        return Err(invalid_import("invalidDestination"));
    }
    let destination = attachments.join(file_name);
    let mut guard = CreatedResource::create(&destination, &proposal.path)?;
    guard
        .file_mut()?
        .write_all(&request.bytes)
        .map_err(|error| io_failure("writeAttachmentImport", proposal.path.as_str(), &error))?;
    guard
        .file_mut()?
        .sync_all()
        .map_err(|error| io_failure("syncAttachmentImport", proposal.path.as_str(), &error))?;
    guard.close();

    let mut verified = Vec::with_capacity(request.bytes.len());
    File::open(&destination)
        .map_err(|error| io_failure("openImportedAttachment", proposal.path.as_str(), &error))?
        .take(MAX_ATTACHMENT_IMPORT_BYTES + 1)
        .read_to_end(&mut verified)
        .map_err(|error| io_failure("verifyAttachmentImport", proposal.path.as_str(), &error))?;
    if verified != request.bytes || hex_digest(&verified) != proposal.content_sha256 {
        return Err(WorkspaceFailure::Io {
            operation: "verifyAttachmentImport".to_owned(),
            path: proposal.path.to_string(),
            kind: "contentMismatch".to_owned(),
        });
    }
    guard.commit();
    Ok(proposal)
}

fn validate_bytes(bytes: &[u8]) -> Result<(), WorkspaceFailure> {
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ATTACHMENT_IMPORT_BYTES {
        return Err(WorkspaceFailure::LimitExceeded {
            limit: format!("attachment import bytes {MAX_ATTACHMENT_IMPORT_BYTES}"),
        });
    }
    Ok(())
}

fn sanitize_file_name(original: &str) -> Result<String, WorkspaceFailure> {
    if original.is_empty()
        || original != original.trim()
        || original.contains(['/', '\\'])
        || original.chars().any(char::is_control)
    {
        return Err(invalid_import("invalidFileName"));
    }

    let (stem, extension) = split_extension(original);
    let extension = extension.filter(|value| {
        value.len() <= 20
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
    });
    let extension_bytes = extension.map_or(0, |value| value.len() + 1);
    let maximum_stem_bytes = MAX_FILENAME_BYTES.saturating_sub(extension_bytes);
    let mut sanitized = String::new();
    let mut pending_separator = false;
    for character in stem.chars() {
        let unsafe_markdown = matches!(
            character,
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '[' | ']' | '(' | ')' | '!' | '#'
        );
        if character.is_whitespace() || unsafe_markdown {
            pending_separator = !sanitized.is_empty();
            continue;
        }
        if pending_separator && !sanitized.ends_with('-') {
            sanitized.push('-');
        }
        pending_separator = false;
        if sanitized.len() + character.len_utf8() > maximum_stem_bytes {
            break;
        }
        sanitized.push(character);
    }
    let sanitized = sanitized.trim_matches([' ', '.', '-', '_']);
    let stem = if sanitized.is_empty() || is_windows_reserved_name(sanitized) {
        "attachment"
    } else {
        sanitized
    };
    let mut file_name = stem.to_owned();
    if let Some(extension) = extension {
        file_name.push('.');
        file_name.push_str(&extension.to_ascii_lowercase());
    }
    if PortableResourcePath::new(format!("{ATTACHMENTS_DIRECTORY}/{file_name}")).is_err() {
        file_name = format!("attachment-{file_name}");
    }
    PortableResourcePath::new(format!("{ATTACHMENTS_DIRECTORY}/{file_name}"))
        .map_err(|_| invalid_import("nonPortableFileName"))?;
    Ok(file_name)
}

fn is_windows_reserved_name(value: &str) -> bool {
    let uppercase = value.to_ascii_uppercase();
    matches!(uppercase.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        || (uppercase.len() == 4
            && (uppercase.starts_with("COM") || uppercase.starts_with("LPT"))
            && matches!(uppercase.as_bytes()[3], b'1'..=b'9'))
}

fn split_extension(file_name: &str) -> (&str, Option<&str>) {
    match file_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            (stem, Some(extension))
        }
        _ => (file_name, None),
    }
}

fn next_available_path(
    root: &Path,
    file_name: &str,
) -> Result<PortableResourcePath, WorkspaceFailure> {
    let directory = root.join(ATTACHMENTS_DIRECTORY);
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(WorkspaceFailure::SymbolicLink {
                path: ATTACHMENTS_DIRECTORY.to_owned(),
            });
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(WorkspaceFailure::Io {
                operation: "inspectAttachmentDirectory".to_owned(),
                path: ATTACHMENTS_DIRECTORY.to_owned(),
                kind: "notDirectory".to_owned(),
            });
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(io_failure(
                "inspectAttachmentDirectory",
                ATTACHMENTS_DIRECTORY,
                &error,
            ));
        }
    }

    let (stem, extension) = split_extension(file_name);
    for index in 1..=MAX_COLLISION_ATTEMPTS {
        let candidate_name = if index == 1 {
            file_name.to_owned()
        } else {
            collision_file_name(stem, extension, index)
        };
        let candidate =
            PortableResourcePath::new(format!("{ATTACHMENTS_DIRECTORY}/{candidate_name}"))
                .map_err(|_| invalid_import("nonPortableDestination"))?;
        match fs::symlink_metadata(root.join(candidate.as_str())) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(WorkspaceFailure::SymbolicLink {
                    path: candidate.to_string(),
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(candidate);
            }
            Err(error) => {
                return Err(io_failure(
                    "inspectAttachmentDestination",
                    candidate.as_str(),
                    &error,
                ));
            }
        }
    }
    Err(WorkspaceFailure::LimitExceeded {
        limit: format!("attachment collisions {MAX_COLLISION_ATTEMPTS}"),
    })
}

fn collision_file_name(stem: &str, extension: Option<&str>, index: usize) -> String {
    let suffix = format!("-{index}");
    let extension_bytes = extension.map_or(0, |value| value.len() + 1);
    let maximum_stem_bytes = MAX_FILENAME_BYTES
        .saturating_sub(extension_bytes)
        .saturating_sub(suffix.len());
    let mut boundary = maximum_stem_bytes.min(stem.len());
    while !stem.is_char_boundary(boundary) {
        boundary = boundary.saturating_sub(1);
    }
    let mut candidate = stem[..boundary]
        .trim_end_matches([' ', '.', '-', '_'])
        .to_owned();
    if candidate.is_empty() {
        candidate.push_str("attachment");
    }
    candidate.push_str(&suffix);
    if let Some(extension) = extension {
        candidate.push('.');
        candidate.push_str(extension);
    }
    candidate
}

fn ensure_attachments_directory(root: &Path) -> Result<PathBuf, WorkspaceFailure> {
    let directory = root.join(ATTACHMENTS_DIRECTORY);
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(WorkspaceFailure::SymbolicLink {
                path: ATTACHMENTS_DIRECTORY.to_owned(),
            });
        }
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err(WorkspaceFailure::Io {
                operation: "inspectAttachmentDirectory".to_owned(),
                path: ATTACHMENTS_DIRECTORY.to_owned(),
                kind: "notDirectory".to_owned(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&directory).map_err(|error| {
                io_failure("createAttachmentDirectory", ATTACHMENTS_DIRECTORY, &error)
            })?;
        }
        Err(error) => {
            return Err(io_failure(
                "inspectAttachmentDirectory",
                ATTACHMENTS_DIRECTORY,
                &error,
            ));
        }
    }
    let canonical = directory.canonicalize().map_err(|error| {
        io_failure(
            "canonicalizeAttachmentDirectory",
            ATTACHMENTS_DIRECTORY,
            &error,
        )
    })?;
    if !canonical.starts_with(root) {
        return Err(invalid_import("destinationOutsideWorkspace"));
    }
    Ok(canonical)
}

fn relative_target(source: &PortablePath, destination: &PortableResourcePath) -> String {
    let source_directory = source
        .as_str()
        .rsplit_once('/')
        .map_or("", |(directory, _)| directory);
    let source_components = if source_directory.is_empty() {
        Vec::new()
    } else {
        source_directory.split('/').collect::<Vec<_>>()
    };
    let destination_components = destination.as_str().split('/').collect::<Vec<_>>();
    let common = source_components
        .iter()
        .zip(&destination_components)
        .take_while(|(left, right)| left == right)
        .count();
    let mut relative = "../".repeat(source_components.len().saturating_sub(common));
    relative.push_str(&destination_components[common..].join("/"));
    relative
}

fn file_stem(file_name: &str) -> &str {
    split_extension(file_name).0
}

struct CreatedResource {
    path: PathBuf,
    file: Option<File>,
    committed: bool,
}

impl CreatedResource {
    fn create(path: &Path, portable: &PortableResourcePath) -> Result<Self, WorkspaceFailure> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    WorkspaceFailure::AlreadyExists {
                        path: portable.to_string(),
                    }
                } else {
                    io_failure("createAttachmentImport", portable.as_str(), &error)
                }
            })?;
        Ok(Self {
            path: path.to_path_buf(),
            file: Some(file),
            committed: false,
        })
    }

    fn file_mut(&mut self) -> Result<&mut File, WorkspaceFailure> {
        self.file
            .as_mut()
            .ok_or_else(|| invalid_import("destinationAlreadyClosed"))
    }

    fn close(&mut self) {
        self.file.take();
    }

    fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for CreatedResource {
    fn drop(&mut self) {
        self.file.take();
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn invalid_import(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::InvalidAttachmentImport {
        kind: kind.to_owned(),
    }
}

fn io_failure(operation: &str, path: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::Io {
        operation: operation.to_owned(),
        path: path.to_owned(),
        kind: match error.kind() {
            std::io::ErrorKind::AlreadyExists => "alreadyExists",
            std::io::ErrorKind::NotFound => "notFound",
            std::io::ErrorKind::PermissionDenied => "permissionDenied",
            std::io::ErrorKind::InvalidData | std::io::ErrorKind::InvalidInput => "invalidData",
            _ => "other",
        }
        .to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use zhiweave_application::ProposeAttachmentImportRequest;
    use zhiweave_domain::{NoteId, PortablePath};

    use super::{propose_import, relative_target, sanitize_file_name};

    #[test]
    fn filenames_are_portable_without_exposing_markdown_delimiters() {
        assert_eq!(
            sanitize_file_name(" UUID diagram (final)!.PNG").unwrap_err(),
            zhiweave_application::WorkspaceFailure::InvalidAttachmentImport {
                kind: "invalidFileName".to_owned()
            }
        );
        assert_eq!(
            sanitize_file_name("UUID diagram (final)!.PNG").unwrap(),
            "UUID-diagram-final.png"
        );
        assert_eq!(sanitize_file_name("CON.txt").unwrap(), "attachment.txt");
        assert!(sanitize_file_name("../secret.png").is_err());
    }

    #[test]
    fn relative_targets_follow_the_source_note_directory() {
        let source = PortablePath::new_markdown("topics/rust/uuid.md").unwrap();
        let destination =
            zhiweave_domain::PortableResourcePath::new("attachments/uuid.png").unwrap();
        assert_eq!(
            relative_target(&source, &destination),
            "../../attachments/uuid.png"
        );
    }

    #[test]
    fn proposal_preserves_original_bytes_in_its_digest() {
        let root = std::env::temp_dir().join(format!(
            "zhiweave-attachment-proposal-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = PortablePath::new_markdown("topics/uuid.md").unwrap();
        let proposal = propose_import(
            &root,
            &source,
            &ProposeAttachmentImportRequest {
                source_note_id: NoteId::new(),
                original_file_name: "proof.pdf".to_owned(),
                bytes: b"original-pdf-bytes".to_vec(),
            },
        )
        .unwrap();
        assert_eq!(proposal.path.as_str(), "attachments/proof.pdf");
        assert_eq!(proposal.markdown_reference, "![[attachments/proof.pdf]]");
        assert_eq!(proposal.byte_length, 18);
        std::fs::remove_dir(&root).unwrap();
    }
}
