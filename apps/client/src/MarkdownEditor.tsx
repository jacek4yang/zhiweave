import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import {
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";

import { zhiweaveMarkdownExtensions } from "./markdownLezerExtensions";
import { markdownLivePreview } from "./markdownLivePreview";

interface MarkdownEditorProps {
  readonly livePreview?: boolean;
  readonly noteId?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onOpenWikiTarget?: (rawTarget: string) => void;
  readonly onStatusChange?: (status: EditorStatus) => void;
}

export interface EditorStatus {
  readonly line: number;
  readonly column: number;
  readonly lines: number;
  readonly characters: number;
  readonly words: number;
  readonly selectionLength: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
}

export interface MarkdownEditorHandle {
  readonly focus: () => void;
  readonly redo: () => boolean;
  readonly revealOffset: (offset: number) => void;
  readonly undo: () => boolean;
}

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading1,
    color: "var(--syntax-blue)",
    fontWeight: "750",
  },
  {
    tag: tags.heading2,
    color: "var(--syntax-violet)",
    fontWeight: "700",
  },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: "var(--syntax-cyan)",
    fontWeight: "650",
  },
  {
    tag: [tags.meta, tags.punctuation, tags.contentSeparator],
    color: "var(--syntax-punctuation)",
  },
  {
    tag: tags.quote,
    color: "var(--syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: tags.strong,
    color: "var(--syntax-yellow)",
    fontWeight: "750",
  },
  {
    tag: tags.emphasis,
    color: "var(--syntax-warm)",
    fontStyle: "italic",
  },
  {
    tag: tags.link,
    color: "var(--syntax-teal)",
    textDecoration: "underline",
  },
  {
    tag: tags.url,
    color: "var(--syntax-blue)",
    textDecoration: "underline",
  },
  {
    tag: [tags.monospace, tags.string],
    color: "var(--syntax-green)",
  },
  {
    tag: [tags.number, tags.bool, tags.constant(tags.name)],
    color: "var(--syntax-orange)",
  },
  {
    tag: [tags.keyword, tags.modifier],
    color: "var(--syntax-magenta)",
    fontWeight: "650",
  },
  {
    tag: tags.comment,
    color: "var(--syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: tags.invalid,
    color: "var(--danger)",
    textDecoration: "underline wavy",
  },
]);

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor({
    livePreview = true,
    noteId,
    value,
    onChange,
    onOpenWikiTarget,
    onStatusChange,
  }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const livePreviewCompartmentRef = useRef<Compartment | null>(null);
  if (livePreviewCompartmentRef.current === null) {
    livePreviewCompartmentRef.current = new Compartment();
  }
  const livePreviewCompartment = livePreviewCompartmentRef.current;
  const onChangeRef = useRef(onChange);
  const onOpenWikiTargetRef = useRef(onOpenWikiTarget);
  const onStatusChangeRef = useRef(onStatusChange);
  onChangeRef.current = onChange;
  onOpenWikiTargetRef.current = onOpenWikiTarget;
  onStatusChangeRef.current = onStatusChange;

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    redo() {
      const view = viewRef.current;
      return view === null ? false : redo(view);
    },
    revealOffset(offset) {
      const view = viewRef.current;
      if (view === null) {
        return;
      }
      const anchor = Math.max(0, Math.min(offset, view.state.doc.length));
      view.dispatch({
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        selection: { anchor },
      });
      view.focus();
    },
    undo() {
      const view = viewRef.current;
      return view === null ? false : undo(view);
    },
  }), []);

  useEffect(() => {
    if (host.current === null) {
      return undefined;
    }
    const view = new EditorView({
      parent: host.current,
      doc: value,
      extensions: [
        basicSetup,
        markdown({
          base: markdownLanguage,
          extensions: zhiweaveMarkdownExtensions,
        }),
        syntaxHighlighting(markdownHighlightStyle),
        livePreviewCompartment.of(
          livePreview
            ? markdownLivePreview((rawTarget) =>
                onOpenWikiTargetRef.current?.(rawTarget)
              )
            : [],
        ),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            onStatusChangeRef.current?.(editorStatus(update.view));
          }
        }),
      ],
    });
    viewRef.current = view;
    onStatusChangeRef.current?.(editorStatus(view));
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(
        livePreview
          ? markdownLivePreview((rawTarget) =>
              onOpenWikiTargetRef.current?.(rawTarget)
            )
          : [],
      ),
    });
  }, [livePreview, livePreviewCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === value) {
      return;
    }
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }, [value]);

  return (
    <div
      className="markdown-editor"
      data-context="editor"
      data-live-preview={livePreview ? "on" : "off"}
      data-note-id={noteId}
      ref={host}
    />
  );
});

function editorStatus(view: EditorView): EditorStatus {
  const document = view.state.doc;
  const selection = view.state.selection.main;
  const line = document.lineAt(selection.head);
  const text = document.toString();
  return {
    line: line.number,
    column: selection.head - line.from + 1,
    lines: document.lines,
    characters: text.length,
    words: countWords(text),
    selectionLength: Math.abs(selection.to - selection.from),
    undoDepth: undoDepth(view.state),
    redoDepth: redoDepth(view.state),
  };
}

function countWords(value: string): number {
  return (
    value.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_'-]+/gu,
    )?.length ?? 0
  );
}
