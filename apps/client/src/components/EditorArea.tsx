import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type {
  CursorPosition,
  EditorSelection,
  RemoteCursor
} from "../types";

export interface OpenFile {
  path: string;
  content: string;
}

declare global {
  interface Window {
    __simplercpEditors?: Record<string, Monaco.editor.IStandaloneCodeEditor>;
  }
}

export function EditorArea({
  openFiles,
  activePath,
  remoteCursors,
  onSelectFile,
  onChangeFile,
  onCursorChange
}: {
  openFiles: OpenFile[];
  activePath?: string;
  remoteCursors: RemoteCursor[];
  onSelectFile(path: string): void;
  onChangeFile(path: string, content: string): void;
  onCursorChange(
    path: string,
    position: CursorPosition,
    selection: EditorSelection
  ): void;
}) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const [editorVersion, setEditorVersion] = useState(0);
  const activeFile = openFiles.find((file) => file.path === activePath);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFile) return;

    const decorations = remoteCursors
      .filter((cursor) => cursor.path === activeFile.path)
      .flatMap((cursor) => createCursorDecorations(monaco, cursor));
    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      decorations
    );
  }, [activeFile, editorVersion, remoteCursors]);

  return (
    <div className="editor-area">
      <div className="tabs" data-testid="editor-tabs">
        {openFiles.map((file) => (
          <button
            key={file.path}
            className={file.path === activePath ? "tab active" : "tab"}
            onClick={() => onSelectFile(file.path)}
          >
            {file.path}
          </button>
        ))}
      </div>
      <div className="editor-frame" data-testid="editor-frame">
        {activeFile ? (
          <Editor
            key={activeFile.path}
            path={activeFile.path}
            value={activeFile.content}
            language={languageForPath(activeFile.path)}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: "on",
              scrollBeyondLastLine: false
            }}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco;
              decorationIdsRef.current = [];
              setEditorVersion((version) => version + 1);
              window.__simplercpEditors ??= {};
              window.__simplercpEditors[activeFile.path] = editor;
              editor.onDidChangeCursorSelection((event) => {
                onCursorChange(
                  activeFile.path,
                  event.selection.getPosition(),
                  event.selection
                );
              });
            }}
            onChange={(value) => onChangeFile(activeFile.path, value ?? "")}
          />
        ) : (
          <div className="empty-state">Open a file to start collaborating.</div>
        )}
      </div>
    </div>
  );
}

function createCursorDecorations(
  monaco: typeof Monaco,
  cursor: RemoteCursor
): Monaco.editor.IModelDeltaDecoration[] {
  const color = colorIndex(cursor.memberId);
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  const selection = cursor.selection;
  const hasSelection =
    selection.startLineNumber !== selection.endLineNumber ||
    selection.startColumn !== selection.endColumn;

  if (hasSelection) {
    decorations.push({
      range: new monaco.Range(
        selection.startLineNumber,
        selection.startColumn,
        selection.endLineNumber,
        selection.endColumn
      ),
      options: {
        className: `remote-selection remote-color-${color}`
      }
    });
  }

  decorations.push({
    range: new monaco.Range(
      cursor.position.lineNumber,
      Math.max(1, cursor.position.column - 1),
      cursor.position.lineNumber,
      cursor.position.column
    ),
    options: {
      afterContentClassName: `remote-cursor remote-color-${color}`,
      after: {
        content: ` ${cursor.displayName}`,
        inlineClassName: `remote-cursor-label remote-color-${color}`
      }
    }
  });

  return decorations;
}

function colorIndex(memberId: string) {
  let hash = 0;
  for (const character of memberId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 4;
}

function languageForPath(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".xml")) return "xml";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}
