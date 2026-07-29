//! Conservative Markdown import helpers.

use thiserror::Error;

/// Result of importing a Learning Loop/Obsidian Markdown file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportedMarkdown {
    /// Markdown with internal `ll_*` YAML keys removed.
    pub markdown: String,
    /// Removed internal key/value lines for later hidden-metadata migration.
    pub removed_properties: Vec<String>,
}

/// Markdown import failure.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ImportError {
    /// Frontmatter begins but has no closing delimiter.
    #[error("unterminated YAML frontmatter")]
    UnterminatedFrontmatter,
}

/// Removes only top-level Learning Loop internal YAML keys.
///
/// Ordinary user properties and the Markdown body remain byte-for-byte stable
/// except for normalized LF line endings.
///
/// # Errors
///
/// Returns [`ImportError::UnterminatedFrontmatter`] rather than guessing when
/// the opening YAML delimiter has no matching close.
pub fn remove_learning_loop_properties(markdown: &str) -> Result<ImportedMarkdown, ImportError> {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.starts_with("---\n") {
        return Ok(ImportedMarkdown {
            markdown: normalized,
            removed_properties: Vec::new(),
        });
    }
    let Some(relative_end) = normalized[4..].find("\n---\n") else {
        return Err(ImportError::UnterminatedFrontmatter);
    };
    let end = 4 + relative_end;
    let frontmatter = &normalized[4..end];
    let body = &normalized[end + 5..];
    let mut kept = Vec::new();
    let mut removed = Vec::new();
    for line in frontmatter.split('\n') {
        if line.trim_start().starts_with("ll_") {
            removed.push(line.to_owned());
        } else {
            kept.push(line);
        }
    }
    let markdown = if kept.iter().all(|line| line.trim().is_empty()) {
        body.to_owned()
    } else {
        format!("---\n{}\n---\n{body}", kept.join("\n"))
    };
    Ok(ImportedMarkdown {
        markdown,
        removed_properties: removed,
    })
}

#[cfg(test)]
mod tests {
    use super::{ImportError, remove_learning_loop_properties};

    #[test]
    fn old_internal_properties_are_hidden_but_user_properties_survive() {
        let input = concat!(
            "---\n",
            "tags: [rust]\n",
            "ll_id: 123\n",
            "ll_type: node\n",
            "source: official-book\n",
            "---\n",
            "# Ownership\n",
        );
        let imported = remove_learning_loop_properties(input).unwrap();
        assert_eq!(
            imported.markdown,
            "---\ntags: [rust]\nsource: official-book\n---\n# Ownership\n"
        );
        assert_eq!(imported.removed_properties, ["ll_id: 123", "ll_type: node"]);
    }

    #[test]
    fn malformed_frontmatter_fails_closed() {
        assert_eq!(
            remove_learning_loop_properties("---\nll_id: 123\n").unwrap_err(),
            ImportError::UnterminatedFrontmatter
        );
    }
}
