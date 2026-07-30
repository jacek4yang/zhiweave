use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use zhiweave_application::{
    AttachmentContent, AttachmentMediaType, AttachmentReferenceKind, AttachmentResolution,
    AttachmentResolutionState, ResolveAttachmentRequest, WorkspaceFailure,
};
use zhiweave_domain::{PortablePath, PortableResourcePath};

pub(crate) const MAX_ATTACHMENT_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ATTACHMENT_TARGET_CHARS: usize = 1_024;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

pub(crate) fn resolve_attachment(
    root: &Path,
    source_path: &PortablePath,
    request: &ResolveAttachmentRequest,
) -> Result<AttachmentResolution, WorkspaceFailure> {
    let raw_target = request.raw_target.trim();
    validate_target(raw_target)?;
    let recognized_attachment = request.reference_kind == AttachmentReferenceKind::MarkdownImage
        || has_attachment_extension(raw_target)
        || (request.reference_kind == AttachmentReferenceKind::WikiEmbed
            && raw_target
                .replace('\\', "/")
                .to_ascii_lowercase()
                .starts_with("attachments/"));
    if is_active_or_remote_target(raw_target) {
        return Ok(empty_resolution(
            raw_target,
            recognized_attachment,
            AttachmentResolutionState::RemoteBlocked,
        ));
    }
    if request.reference_kind == AttachmentReferenceKind::WikiEmbed && !recognized_attachment {
        return Ok(empty_resolution(
            raw_target,
            false,
            AttachmentResolutionState::Missing,
        ));
    }
    if raw_target.contains(['#', '?']) {
        return Ok(empty_resolution(
            raw_target,
            recognized_attachment,
            AttachmentResolutionState::Unsupported,
        ));
    }

    let candidates = candidate_paths(source_path, raw_target, request.reference_kind)?;
    let mut existing = Vec::new();
    for candidate in candidates {
        if resolve_existing_resource(root, &candidate)?.is_some() {
            existing.push(candidate);
        }
    }
    match existing.as_slice() {
        [] => Ok(empty_resolution(
            raw_target,
            recognized_attachment,
            AttachmentResolutionState::Missing,
        )),
        [_first, _second, ..] => Ok(empty_resolution(
            raw_target,
            recognized_attachment,
            AttachmentResolutionState::Ambiguous,
        )),
        [path] => read_supported_image(root, raw_target, path),
    }
}

fn validate_target(raw_target: &str) -> Result<(), WorkspaceFailure> {
    if raw_target.is_empty() {
        return Err(invalid_target("emptyTarget"));
    }
    if raw_target.chars().count() > MAX_ATTACHMENT_TARGET_CHARS {
        return Err(invalid_target("targetTooLong"));
    }
    if raw_target.chars().any(char::is_control) {
        return Err(invalid_target("invalidTargetCharacter"));
    }
    Ok(())
}

fn is_active_or_remote_target(target: &str) -> bool {
    let lowered = target.to_ascii_lowercase();
    lowered.starts_with("//")
        || lowered.starts_with("http:")
        || lowered.starts_with("https:")
        || lowered.starts_with("data:")
        || lowered.starts_with("file:")
        || lowered.starts_with("asset:")
        || lowered.starts_with("javascript:")
}

fn has_attachment_extension(target: &str) -> bool {
    let target = target.split(['#', '?']).next().unwrap_or_default();
    extension(target).is_some_and(|extension| {
        matches!(
            extension.as_str(),
            "png"
                | "jpg"
                | "jpeg"
                | "jpe"
                | "webp"
                | "gif"
                | "svg"
                | "pdf"
                | "mp3"
                | "wav"
                | "ogg"
                | "flac"
                | "mp4"
                | "webm"
                | "mov"
        )
    })
}

fn candidate_paths(
    source_path: &PortablePath,
    raw_target: &str,
    kind: AttachmentReferenceKind,
) -> Result<BTreeSet<PortableResourcePath>, WorkspaceFailure> {
    let mut candidates = BTreeSet::new();
    match kind {
        AttachmentReferenceKind::MarkdownImage => {
            candidates.insert(resolve_relative_reference(source_path, raw_target)?);
        }
        AttachmentReferenceKind::WikiEmbed => {
            if raw_target.contains('/') || raw_target.contains('\\') {
                let normalized = raw_target.strip_prefix("./").unwrap_or(raw_target);
                candidates.insert(
                    PortableResourcePath::new(normalized)
                        .map_err(|_| invalid_target("nonPortablePath"))?,
                );
            } else {
                let source_candidate = source_path.as_str().rsplit_once('/').map_or_else(
                    || raw_target.to_owned(),
                    |(directory, _)| format!("{directory}/{raw_target}"),
                );
                for candidate in [
                    source_candidate,
                    format!("attachments/{raw_target}"),
                    raw_target.to_owned(),
                ] {
                    candidates.insert(
                        PortableResourcePath::new(candidate)
                            .map_err(|_| invalid_target("nonPortablePath"))?,
                    );
                }
            }
        }
    }
    Ok(candidates)
}

fn resolve_relative_reference(
    source_path: &PortablePath,
    raw_target: &str,
) -> Result<PortableResourcePath, WorkspaceFailure> {
    let mut components = source_path
        .as_str()
        .rsplit_once('/')
        .map_or_else(Vec::new, |(directory, _)| {
            directory.split('/').map(ToOwned::to_owned).collect()
        });
    let normalized = raw_target.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(invalid_target("absolutePath"));
    }
    for component in normalized.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                if components.pop().is_none() {
                    return Err(invalid_target("pathEscapesWorkspace"));
                }
            }
            value => components.push(value.to_owned()),
        }
    }
    PortableResourcePath::new(components.join("/")).map_err(|_| invalid_target("nonPortablePath"))
}

fn resolve_existing_resource(
    root: &Path,
    path: &PortableResourcePath,
) -> Result<Option<PathBuf>, WorkspaceFailure> {
    if path
        .as_str()
        .split('/')
        .next()
        .is_some_and(|component| component.eq_ignore_ascii_case(".zhiweave"))
    {
        return Err(invalid_target("hiddenMetadata"));
    }
    let mut current = root.to_path_buf();
    for component in path.as_str().split('/') {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(WorkspaceFailure::SymbolicLink {
                    path: path.to_string(),
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(io_failure("inspectAttachment", path.as_str(), &error)),
        }
    }
    let canonical = current
        .canonicalize()
        .map_err(|error| io_failure("canonicalizeAttachment", path.as_str(), &error))?;
    if !canonical.starts_with(root) {
        return Err(invalid_target("outsideWorkspace"));
    }
    let metadata = canonical
        .metadata()
        .map_err(|error| io_failure("inspectAttachment", path.as_str(), &error))?;
    Ok(metadata.is_file().then_some(canonical))
}

fn read_supported_image(
    root: &Path,
    raw_target: &str,
    path: &PortableResourcePath,
) -> Result<AttachmentResolution, WorkspaceFailure> {
    let Some(absolute) = resolve_existing_resource(root, path)? else {
        return Ok(empty_resolution(
            raw_target,
            true,
            AttachmentResolutionState::Missing,
        ));
    };
    let metadata = absolute
        .metadata()
        .map_err(|error| io_failure("inspectAttachment", path.as_str(), &error))?;
    if metadata.len() > MAX_ATTACHMENT_PREVIEW_BYTES {
        return Ok(empty_resolution(
            raw_target,
            true,
            AttachmentResolutionState::TooLarge,
        ));
    }
    let mut bytes = Vec::with_capacity(
        usize::try_from(metadata.len().min(MAX_ATTACHMENT_PREVIEW_BYTES)).unwrap_or(0),
    );
    File::open(&absolute)
        .map_err(|error| io_failure("openAttachment", path.as_str(), &error))?
        .take(MAX_ATTACHMENT_PREVIEW_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_failure("readAttachment", path.as_str(), &error))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ATTACHMENT_PREVIEW_BYTES {
        return Ok(empty_resolution(
            raw_target,
            true,
            AttachmentResolutionState::TooLarge,
        ));
    }

    let Some((media_type, width, height)) = image_metadata(&bytes) else {
        return Ok(empty_resolution(
            raw_target,
            true,
            AttachmentResolutionState::Unsupported,
        ));
    };
    if !extension_matches_media(path.as_str(), media_type) {
        return Ok(empty_resolution(
            raw_target,
            true,
            AttachmentResolutionState::Unsupported,
        ));
    }
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Ok(empty_resolution(
            raw_target,
            true,
            AttachmentResolutionState::TooLarge,
        ));
    }
    let byte_length = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let content_sha256 = hex_digest(&bytes);
    Ok(AttachmentResolution {
        raw_target: raw_target.to_owned(),
        recognized_attachment: true,
        state: AttachmentResolutionState::Resolved,
        content: Some(AttachmentContent {
            path: path.clone(),
            media_type,
            byte_length,
            content_sha256,
            width,
            height,
            bytes,
        }),
    })
}

fn image_metadata(bytes: &[u8]) -> Option<(AttachmentMediaType, u32, u32)> {
    png_dimensions(bytes)
        .map(|(width, height)| (AttachmentMediaType::Png, width, height))
        .or_else(|| {
            jpeg_dimensions(bytes).map(|(width, height)| (AttachmentMediaType::Jpeg, width, height))
        })
        .or_else(|| {
            webp_dimensions(bytes).map(|(width, height)| (AttachmentMediaType::Webp, width, height))
        })
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut cursor = 2;
    while cursor + 4 <= bytes.len() {
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if matches!(marker, 0xd8 | 0xd9) || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = usize::from(u16::from_be_bytes(
            bytes.get(cursor..cursor + 2)?.try_into().ok()?,
        ));
        if length < 2 || cursor + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            if length < 7 {
                return None;
            }
            let height = u32::from(u16::from_be_bytes(
                bytes.get(cursor + 3..cursor + 5)?.try_into().ok()?,
            ));
            let width = u32::from(u16::from_be_bytes(
                bytes.get(cursor + 5..cursor + 7)?.try_into().ok()?,
            ));
            return Some((width, height));
        }
        cursor += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || !bytes.starts_with(b"RIFF") || bytes.get(8..12)? != b"WEBP" {
        return None;
    }
    match bytes.get(12..16)? {
        b"VP8X" => {
            if bytes.get(20).is_some_and(|flags| flags & 0x02 != 0) {
                return None;
            }
            Some((
                read_u24_le(bytes.get(24..27)?)? + 1,
                read_u24_le(bytes.get(27..30)?)? + 1,
            ))
        }
        b"VP8L" => {
            if *bytes.get(20)? != 0x2f {
                return None;
            }
            let packed = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
            Some(((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1))
        }
        b"VP8 " => {
            if bytes.get(23..26)? != [0x9d, 0x01, 0x2a] {
                return None;
            }
            let width = u32::from(u16::from_le_bytes(bytes.get(26..28)?.try_into().ok()?) & 0x3fff);
            let height =
                u32::from(u16::from_le_bytes(bytes.get(28..30)?.try_into().ok()?) & 0x3fff);
            Some((width, height))
        }
        _ => None,
    }
}

fn read_u24_le(bytes: &[u8]) -> Option<u32> {
    Some(
        u32::from(*bytes.first()?)
            | (u32::from(*bytes.get(1)?) << 8)
            | (u32::from(*bytes.get(2)?) << 16),
    )
}

fn extension_matches_media(path: &str, media_type: AttachmentMediaType) -> bool {
    extension(path).is_some_and(|extension| match media_type {
        AttachmentMediaType::Png => extension == "png",
        AttachmentMediaType::Jpeg => matches!(extension.as_str(), "jpg" | "jpeg" | "jpe"),
        AttachmentMediaType::Webp => extension == "webp",
    })
}

fn extension(path: &str) -> Option<String> {
    path.rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
}

fn empty_resolution(
    raw_target: &str,
    recognized_attachment: bool,
    state: AttachmentResolutionState,
) -> AttachmentResolution {
    AttachmentResolution {
        raw_target: raw_target.to_owned(),
        recognized_attachment,
        state,
        content: None,
    }
}

pub(crate) fn is_safe_inline_image(path: &str, bytes: &[u8]) -> bool {
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ATTACHMENT_PREVIEW_BYTES {
        return false;
    }
    image_metadata(bytes).is_some_and(|(media_type, width, height)| {
        extension_matches_media(path, media_type)
            && width > 0
            && height > 0
            && width <= MAX_IMAGE_DIMENSION
            && height <= MAX_IMAGE_DIMENSION
            && u64::from(width) * u64::from(height) <= MAX_IMAGE_PIXELS
    })
}

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(encoded, "{byte:02x}");
    }
    encoded
}

fn invalid_target(kind: &str) -> WorkspaceFailure {
    WorkspaceFailure::InvalidAttachmentTarget {
        kind: kind.to_owned(),
    }
}

fn io_failure(operation: &str, path: &str, error: &std::io::Error) -> WorkspaceFailure {
    WorkspaceFailure::Io {
        operation: operation.to_owned(),
        path: path.to_owned(),
        kind: match error.kind() {
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
    use zhiweave_application::{
        AttachmentMediaType, AttachmentReferenceKind, ResolveAttachmentRequest,
    };
    use zhiweave_domain::{NoteId, PortablePath};

    use super::{candidate_paths, image_metadata, resolve_relative_reference, webp_dimensions};

    #[test]
    fn markdown_images_resolve_relative_to_the_source_without_escaping() {
        let source = PortablePath::new_markdown("topics/rust/ownership.md").unwrap();
        assert_eq!(
            resolve_relative_reference(&source, "../../attachments/diagram.png")
                .unwrap()
                .as_str(),
            "attachments/diagram.png"
        );
        assert!(resolve_relative_reference(&source, "../../../outside.png").is_err());
    }

    #[test]
    fn wiki_embed_candidates_are_deterministic_and_deduplicated() {
        let source = PortablePath::new_markdown("topics/ownership.md").unwrap();
        let candidates =
            candidate_paths(&source, "diagram.png", AttachmentReferenceKind::WikiEmbed)
                .unwrap()
                .into_iter()
                .map(|path| path.to_string())
                .collect::<Vec<_>>();
        assert_eq!(
            candidates,
            [
                "attachments/diagram.png",
                "diagram.png",
                "topics/diagram.png"
            ]
        );
    }

    #[test]
    fn image_headers_are_sniffed_without_trusting_extensions() {
        let mut png = vec![0; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&640_u32.to_be_bytes());
        png[20..24].copy_from_slice(&480_u32.to_be_bytes());
        assert_eq!(
            image_metadata(&png),
            Some((AttachmentMediaType::Png, 640, 480))
        );

        let mut webp = vec![0; 30];
        webp[..4].copy_from_slice(b"RIFF");
        webp[8..12].copy_from_slice(b"WEBP");
        webp[12..16].copy_from_slice(b"VP8X");
        webp[24..27].copy_from_slice(&[0xff, 0x03, 0]);
        webp[27..30].copy_from_slice(&[0xdf, 0x01, 0]);
        assert_eq!(webp_dimensions(&webp), Some((1_024, 480)));
        webp[20] = 0x02;
        assert_eq!(webp_dimensions(&webp), None);
    }

    #[test]
    fn request_contract_keeps_reference_kind_and_stable_source() {
        let source_note_id = NoteId::from_bytes([7; 16]);
        let request = ResolveAttachmentRequest {
            source_note_id,
            raw_target: "diagram.png".to_owned(),
            reference_kind: AttachmentReferenceKind::MarkdownImage,
        };
        assert_eq!(request.source_note_id, source_note_id);
        assert_eq!(request.raw_target, "diagram.png");
        assert_eq!(
            request.reference_kind,
            AttachmentReferenceKind::MarkdownImage
        );
    }
}
