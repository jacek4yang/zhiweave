//! Pure `ZhiWeave` learning-domain types.

use std::{fmt, path::Path};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Stable identity for a note. Paths are mutable and are not identities.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct NoteId(Uuid);

impl NoteId {
    /// Creates a time-sortable random identity.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }

    /// Restores a stable identity supplied by a trusted persistence adapter.
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(Uuid::from_bytes(bytes))
    }
}

impl Default for NoteId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for NoteId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// User-facing role of a Markdown document.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteKind {
    /// A durable learning objective.
    Topic,
    /// One focused question in a topic.
    Node,
    /// External source or excerpt.
    Source,
    /// Academic paper analysis.
    Paper,
    /// Programming experiment or operational record.
    Experiment,
    /// English word or technical term.
    EnglishTerm,
    /// Active-recall prompt.
    ReviewCard,
    /// Daily learning dashboard.
    Daily,
    /// Ordinary Markdown outside a structured workflow.
    Note,
}

/// A cross-platform, workspace-relative Markdown path.
///
/// The normalized representation always uses `/` separators and excludes
/// components that are ambiguous or invalid on supported desktop platforms.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PortablePath(String);

impl PortablePath {
    /// Validates and normalizes a relative Markdown path.
    ///
    /// # Errors
    ///
    /// Returns [`DomainError::InvalidPath`] for traversal, absolute paths,
    /// Windows device names, control characters, or non-portable components.
    /// Returns [`DomainError::NotMarkdown`] unless the extension is `.md`.
    pub fn new_markdown(path: impl AsRef<str>) -> Result<Self, DomainError> {
        let normalized = normalize_relative_path(path.as_ref())?;
        if !Path::new(&normalized)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(DomainError::NotMarkdown);
        }
        Ok(Self(normalized))
    }

    /// Returns the normalized `/`-separated path.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PortablePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for PortablePath {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let path = String::deserialize(deserializer)?;
        Self::new_markdown(path).map_err(serde::de::Error::custom)
    }
}

/// Markdown note content with hidden stable identity and learning role.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Note {
    /// Stable internal identity.
    pub id: NoteId,
    /// User-visible title.
    pub title: String,
    /// Portable relative Markdown path.
    pub path: String,
    /// Learning role.
    pub kind: NoteKind,
    /// UTF-8 Markdown source.
    pub markdown: String,
}

impl Note {
    /// Creates a validated note.
    ///
    /// # Errors
    ///
    /// Returns [`DomainError`] when the title, path, or extension is invalid.
    pub fn create(
        title: impl Into<String>,
        path: impl Into<String>,
        kind: NoteKind,
        markdown: impl Into<String>,
    ) -> Result<Self, DomainError> {
        let title = title.into().trim().to_owned();
        let path = PortablePath::new_markdown(path.into())?;
        if title.is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        Ok(Self {
            id: NoteId::new(),
            title,
            path: path.to_string(),
            kind,
            markdown: markdown.into(),
        })
    }
}

/// Domain validation failure.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum DomainError {
    /// Note title is blank.
    #[error("note title is empty")]
    EmptyTitle,
    /// Path is absolute or escapes the workspace.
    #[error("note path is not portable and relative")]
    InvalidPath,
    /// Structured note content must be Markdown.
    #[error("note path does not end in .md")]
    NotMarkdown,
}

fn normalize_relative_path(path: &str) -> Result<String, DomainError> {
    if path != path.trim() {
        return Err(DomainError::InvalidPath);
    }
    let normalized = path.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.len() > 1_024
        || normalized.contains('\0')
        || normalized.split('/').any(is_invalid_component)
    {
        return Err(DomainError::InvalidPath);
    }
    Ok(normalized)
}

fn is_invalid_component(component: &str) -> bool {
    component.is_empty()
        || component == "."
        || component == ".."
        || component.len() > 255
        || component.ends_with([' ', '.'])
        || component
            .chars()
            .any(|character| character.is_control() || r#"<>:"|?*"#.contains(character))
        || is_windows_device_name(component)
}

fn is_windows_device_name(component: &str) -> bool {
    let stem = component
        .split_once('.')
        .map_or(component, |(before_extension, _)| before_extension)
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(
                    number,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
}

#[cfg(test)]
mod tests {
    use super::{DomainError, Note, NoteKind, PortablePath};

    #[test]
    fn note_has_hidden_identity_and_portable_path() {
        let note = Note::create(
            "所有权是什么？",
            r"topics\rust\ownership.md",
            NoteKind::Node,
            "# 所有权是什么？\n",
        )
        .unwrap();

        assert_eq!(note.path, "topics/rust/ownership.md");
        assert_eq!(note.title, "所有权是什么？");
        assert!(!note.markdown.contains(&note.id.to_string()));
    }

    #[test]
    fn traversal_and_non_markdown_notes_are_rejected() {
        assert_eq!(
            Note::create("escape", "../escape.md", NoteKind::Note, "").unwrap_err(),
            DomainError::InvalidPath
        );
        assert_eq!(
            Note::create("binary", "binary.bin", NoteKind::Note, "").unwrap_err(),
            DomainError::NotMarkdown
        );
    }

    #[test]
    fn windows_absolute_device_and_ambiguous_paths_are_rejected_everywhere() {
        for path in [
            r"C:\Users\person\note.md",
            r"\\server\share\note.md",
            "topics/CON.md",
            "topics/CON .md",
            "topics/LPT9.md",
            "topics/COM¹.md",
            "topics/trailing. /note.md",
            "topics/bad?.md",
            " topics/note.md",
            "topics//note.md",
        ] {
            assert_eq!(
                PortablePath::new_markdown(path).unwrap_err(),
                DomainError::InvalidPath,
                "{path} should be rejected"
            );
        }
    }

    #[test]
    fn portable_markdown_paths_have_one_canonical_representation() {
        let path = PortablePath::new_markdown(r"topics\rust\ownership.MD").unwrap();

        assert_eq!(path.as_str(), "topics/rust/ownership.MD");
        assert_eq!(path.to_string(), "topics/rust/ownership.MD");
    }

    #[test]
    fn deserialization_cannot_bypass_path_validation() {
        let valid: PortablePath = serde_json::from_str(r#""topics/ownership.md""#).unwrap();
        assert_eq!(valid.as_str(), "topics/ownership.md");

        for invalid in [
            r#""../outside.md""#,
            r#""C:\\secrets.md""#,
            r#""topics/CON.md""#,
        ] {
            assert!(serde_json::from_str::<PortablePath>(invalid).is_err());
        }
    }
}
