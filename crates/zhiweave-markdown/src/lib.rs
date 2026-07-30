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

/// Maximum accepted length of a Wiki target or display alias.
pub const MAX_WIKI_SEGMENT_CHARS: usize = 500;
const MAX_WIKI_CONTEXT_CHARS: usize = 240;

/// Semantic kind of one source-preserving Wiki reference.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WikiReferenceKind {
    /// A normal `[[target]]` relationship.
    Link,
    /// An embedded `![[target]]` relationship.
    Embed,
}

/// One bounded Wiki reference extracted without rewriting Markdown.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WikiReference {
    /// Link or embed syntax.
    pub kind: WikiReferenceKind,
    /// Trimmed target exactly as authored, including an optional heading fragment.
    pub target: String,
    /// Optional trimmed display alias.
    pub alias: Option<String>,
    /// Byte offset of the opening marker in the original Markdown.
    pub byte_start: usize,
    /// Byte offset immediately after the closing marker.
    pub byte_end: usize,
    /// One-based source line.
    pub line: usize,
    /// One-based Unicode scalar column.
    pub column: usize,
    /// Bounded single-line source context.
    pub context: String,
}

/// Extracts bounded Wiki references from Markdown prose.
///
/// YAML frontmatter, fenced and indented code, inline code spans, HTML comments,
/// escaped markers, malformed syntax, and overlong targets are ignored.
#[must_use]
pub fn wiki_references(markdown: &str) -> Vec<WikiReference> {
    let mut references = Vec::new();
    let mut byte_base = 0;
    let mut in_frontmatter = false;
    let mut fence: Option<(char, usize)> = None;
    let mut inline_code_ticks: Option<usize> = None;
    let mut in_html_comment = false;

    for (line_index, raw_line) in markdown.split_inclusive('\n').enumerate() {
        let line = raw_line.trim_end_matches(['\r', '\n']);
        let line_number = line_index + 1;
        if line_number == 1 && line == "---" {
            in_frontmatter = true;
            byte_base += raw_line.len();
            continue;
        }
        if in_frontmatter {
            if matches!(line, "---" | "...") {
                in_frontmatter = false;
            }
            byte_base += raw_line.len();
            continue;
        }

        if let Some(marker) = fence_marker(line) {
            match fence {
                Some((open_character, open_length))
                    if marker.character == open_character
                        && marker.length >= open_length
                        && line[marker.after..]
                            .chars()
                            .all(|character| matches!(character, ' ' | '\t')) =>
                {
                    fence = None;
                }
                None => fence = Some((marker.character, marker.length)),
                _ => {}
            }
            byte_base += raw_line.len();
            continue;
        }
        if fence.is_some() || leading_indentation(line) >= 4 {
            byte_base += raw_line.len();
            continue;
        }

        scan_wiki_line(
            line,
            line_number,
            byte_base,
            &mut inline_code_ticks,
            &mut in_html_comment,
            &mut references,
        );
        byte_base += raw_line.len();
    }
    references
}

#[derive(Clone, Copy)]
struct FenceMarker {
    character: char,
    length: usize,
    after: usize,
}

fn fence_marker(line: &str) -> Option<FenceMarker> {
    let (indentation, marker_from) = indentation_and_offset(line);
    if indentation > 3 {
        return None;
    }
    let rest = &line[marker_from..];
    let character = rest.chars().next()?;
    if !matches!(character, '`' | '~') {
        return None;
    }
    let length = rest
        .chars()
        .take_while(|candidate| *candidate == character)
        .count();
    (length >= 3).then_some(FenceMarker {
        character,
        length,
        after: marker_from + length,
    })
}

fn leading_indentation(line: &str) -> usize {
    indentation_and_offset(line).0
}

fn indentation_and_offset(line: &str) -> (usize, usize) {
    let mut columns = 0;
    let mut offset = 0;
    for character in line.chars() {
        match character {
            ' ' => columns += 1,
            '\t' => columns += 4 - (columns % 4),
            _ => break,
        }
        offset += character.len_utf8();
    }
    (columns, offset)
}

fn scan_wiki_line(
    line: &str,
    line_number: usize,
    byte_base: usize,
    inline_code_ticks: &mut Option<usize>,
    in_html_comment: &mut bool,
    references: &mut Vec<WikiReference>,
) {
    let bytes = line.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if *in_html_comment {
            let Some(relative_end) = line[cursor..].find("-->") else {
                return;
            };
            cursor += relative_end + 3;
            *in_html_comment = false;
            continue;
        }
        if line[cursor..].starts_with("<!--") {
            *in_html_comment = true;
            cursor += 4;
            continue;
        }

        if bytes[cursor] == b'`' {
            let ticks = ascii_run(bytes, cursor, b'`');
            match *inline_code_ticks {
                Some(open_ticks) if ticks == open_ticks => *inline_code_ticks = None,
                None => *inline_code_ticks = Some(ticks),
                _ => {}
            }
            cursor += ticks;
            continue;
        }
        if inline_code_ticks.is_some() {
            cursor += next_character_length(line, cursor);
            continue;
        }
        if bytes[cursor] == b'\\' {
            let escaped_from = cursor + 1;
            let escaped_opening_length = if line[escaped_from..].starts_with("![[") {
                Some(3)
            } else if line[escaped_from..].starts_with("[[") {
                Some(2)
            } else {
                None
            };
            if let Some(opening_length) = escaped_opening_length {
                let Some((close_from, _)) = find_wiki_close(line, escaped_from + opening_length)
                else {
                    return;
                };
                cursor = close_from + 2;
            } else {
                cursor = escaped_from;
                if cursor < bytes.len() {
                    cursor += next_character_length(line, cursor);
                }
            }
            continue;
        }

        let embedded = line[cursor..].starts_with("![[");
        let linked = line[cursor..].starts_with("[[");
        if embedded || linked {
            let opening_length = if embedded { 3 } else { 2 };
            if let Some((close_from, separator)) = find_wiki_close(line, cursor + opening_length) {
                let content_from = cursor + opening_length;
                let target_to = separator.unwrap_or(close_from);
                let target = line[content_from..target_to].trim();
                let alias = separator.map(|from| line[from + 1..close_from].trim());
                let valid_alias = alias.is_none_or(|value| {
                    !value.is_empty() && value.chars().count() <= MAX_WIKI_SEGMENT_CHARS
                });
                if !target.is_empty()
                    && target.chars().count() <= MAX_WIKI_SEGMENT_CHARS
                    && valid_alias
                {
                    references.push(WikiReference {
                        kind: if embedded {
                            WikiReferenceKind::Embed
                        } else {
                            WikiReferenceKind::Link
                        },
                        target: target.to_owned(),
                        alias: alias.map(str::to_owned),
                        byte_start: byte_base + cursor,
                        byte_end: byte_base + close_from + 2,
                        line: line_number,
                        column: line[..cursor].chars().count() + 1,
                        context: bounded_context(line),
                    });
                }
                cursor = close_from + 2;
                continue;
            }
            return;
        }
        cursor += next_character_length(line, cursor);
    }
}

fn find_wiki_close(line: &str, from: usize) -> Option<(usize, Option<usize>)> {
    let bytes = line.as_bytes();
    let mut cursor = from;
    let mut separator = None;
    let mut characters = 0;
    while cursor < bytes.len() && characters <= MAX_WIKI_SEGMENT_CHARS * 2 + 1 {
        if bytes[cursor] == b'\\' {
            cursor += 1;
            if cursor < bytes.len() {
                cursor += next_character_length(line, cursor);
                characters += 1;
            }
            continue;
        }
        if line[cursor..].starts_with("[[") {
            return None;
        }
        if line[cursor..].starts_with("]]") {
            return Some((cursor, separator));
        }
        if bytes[cursor] == b'|' && separator.is_none() {
            separator = Some(cursor);
        }
        cursor += next_character_length(line, cursor);
        characters += 1;
    }
    None
}

fn ascii_run(bytes: &[u8], from: usize, character: u8) -> usize {
    bytes[from..]
        .iter()
        .take_while(|candidate| **candidate == character)
        .count()
}

fn next_character_length(text: &str, from: usize) -> usize {
    text[from..].chars().next().map_or(1, char::len_utf8)
}

fn bounded_context(line: &str) -> String {
    let trimmed = line.trim();
    let mut context = trimmed
        .chars()
        .take(MAX_WIKI_CONTEXT_CHARS)
        .collect::<String>();
    if trimmed.chars().count() > MAX_WIKI_CONTEXT_CHARS {
        context.push('…');
    }
    context
}

/// Returns the first visible ATX level-one heading without rewriting Markdown.
///
/// YAML frontmatter and fenced code blocks are ignored. The returned text is
/// trimmed and excludes optional closing `#` markers.
#[must_use]
pub fn first_level_one_heading(markdown: &str) -> Option<String> {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = normalized.lines().peekable();
    let mut in_frontmatter = matches!(lines.peek(), Some(&"---"));
    if in_frontmatter {
        lines.next();
    }
    let mut in_fence: Option<char> = None;

    for line in lines {
        if in_frontmatter {
            if line == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        let trimmed = line.trim_start_matches(' ');
        let indentation = line.len().saturating_sub(trimmed.len());
        if indentation <= 3 {
            let fence_character = trimmed.chars().next();
            if matches!(fence_character, Some('`' | '~'))
                && trimmed
                    .chars()
                    .take_while(|character| Some(*character) == fence_character)
                    .count()
                    >= 3
            {
                match in_fence {
                    Some(open) if Some(open) == fence_character => in_fence = None,
                    None => in_fence = fence_character,
                    _ => {}
                }
                continue;
            }
        }
        if in_fence.is_some() {
            continue;
        }
        if indentation > 3 {
            continue;
        }

        let Some(heading) = trimmed.strip_prefix("# ") else {
            continue;
        };
        let heading = heading.trim().trim_end_matches('#').trim_end().to_owned();
        if !heading.is_empty() {
            return Some(heading);
        }
    }
    None
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
    use super::{
        ImportError, MAX_WIKI_SEGMENT_CHARS, WikiReferenceKind, first_level_one_heading,
        remove_learning_loop_properties, wiki_references,
    };

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

    #[test]
    fn title_comes_from_first_visible_level_one_heading() {
        let markdown = concat!(
            "---\n",
            "title: metadata is not the visible title\n",
            "---\n",
            "```markdown\n",
            "# Example only\n",
            "```\n",
            "  # Ownership and borrowing ##\n",
        );

        assert_eq!(
            first_level_one_heading(markdown).as_deref(),
            Some("Ownership and borrowing")
        );
    }

    #[test]
    fn title_is_absent_for_deeper_headings_and_empty_text() {
        assert_eq!(first_level_one_heading("## Detail\n"), None);
        assert_eq!(first_level_one_heading("# \n"), None);
        assert_eq!(first_level_one_heading("    # code, not a heading\n"), None);
    }

    #[test]
    fn wiki_references_preserve_unicode_offsets_aliases_and_embed_kind() {
        let markdown = "中文 [[UUID#版本|标识符]] 与 ![[assets/diagram.png]]。\n";
        let references = wiki_references(markdown);

        assert_eq!(references.len(), 2);
        assert_eq!(references[0].kind, WikiReferenceKind::Link);
        assert_eq!(references[0].target, "UUID#版本");
        assert_eq!(references[0].alias.as_deref(), Some("标识符"));
        assert_eq!(references[0].byte_start, markdown.find("[[UUID").unwrap());
        assert_eq!(
            &markdown[references[0].byte_start..references[0].byte_end],
            "[[UUID#版本|标识符]]"
        );
        assert_eq!(references[0].line, 1);
        assert_eq!(references[0].column, 4);
        assert_eq!(references[1].kind, WikiReferenceKind::Embed);
        assert_eq!(references[1].target, "assets/diagram.png");
    }

    #[test]
    fn wiki_references_ignore_non_prose_and_malformed_or_overlong_syntax() {
        let overlong = "x".repeat(MAX_WIKI_SEGMENT_CHARS + 1);
        let markdown = format!(
            "{}[[{overlong}]]\n",
            concat!(
                "---\nproperty: [[metadata]]\n---\n",
                "`[[inline]]`\n",
                "\\[[escaped]]\n",
                "\\![[escaped-embed]]\n",
                "<!-- [[comment]] -->\n",
                "    [[indented-code]]\n",
                "```markdown\n[[fenced]]\n```\n",
                "~~~\n![[tilde-fence]]\n~~~\n",
                "[[valid]] [[missing-close] [[nested [[target]]]] "
            )
        );

        assert_eq!(
            wiki_references(&markdown)
                .into_iter()
                .map(|reference| reference.target)
                .collect::<Vec<_>>(),
            ["valid"]
        );
    }

    #[test]
    fn inline_code_spans_can_cross_lines_without_creating_edges() {
        let markdown = "``code [[hidden]]\ncontinues`` and [[visible]]\n";

        assert_eq!(
            wiki_references(markdown)
                .into_iter()
                .map(|reference| reference.target)
                .collect::<Vec<_>>(),
            ["visible"]
        );
    }
}
