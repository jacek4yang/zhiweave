import { useEffect, useRef } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { basicSetup, EditorView } from "codemirror";

interface MarkdownEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function MarkdownEditor({
  value,
  onChange,
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
          codeLanguages: languages,
        }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });
    return () => {
      view.destroy();
    };
  }, []);

  return <div className="markdown-editor" ref={host} />;
}
