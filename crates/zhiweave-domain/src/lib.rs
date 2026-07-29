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
        let path = normalize_relative_path(&path.into())?;
        if title.is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        if !Path::new(&path)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(DomainError::NotMarkdown);
        }
        Ok(Self {
            id: NoteId::new(),
            title,
            path,
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
    let normalized = path.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains('\0')
        || normalized
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return Err(DomainError::InvalidPath);
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{DomainError, Note, NoteKind};

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
}
