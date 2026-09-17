import Editor from "@monaco-editor/react";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type {
  CursorPosition,
  EditorSelection,
  RemoteCursor
} from "../types";
import type { ThemeMode } from "../theme";

export interface OpenFile {
  path: string;
  content: string;
}

declare global {
  interface Window {
    __simplercpEditors?: Record<string, Monaco.editor.IStandaloneCodeEditor>;
    __simplercpYjsSynced?: Record<string, boolean>;
  }
}

export function EditorArea({
  openFiles,
  activePath,
  projectId,
  roomId,
  memberId,
  canEdit,
  theme,
  remoteCursors,
  onSelectFile,
  onCloseFile,
  onLocalEdit,
  onCursorChange
}: {
  openFiles: OpenFile[];
  activePath?: string;
  projectId: string;
  roomId: string;
  memberId: string;
  canEdit: boolean;
  theme: ThemeMode;
  remoteCursors: RemoteCursor[];
  onSelectFile(path: string): void;
  onCloseFile(path: string): void;
  onLocalEdit(path: string): void;
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
          <div
            key={file.path}
            className={file.path === activePath ? "tab active" : "tab"}
          >
            <button
              className="tab-select"
              onClick={() => onSelectFile(file.path)}
              title={file.path}
            >
              {file.path}
            </button>
            <button
              className="tab-close"
              aria-label={`Close ${file.path}`}
              title="Close"
              onClick={() => onCloseFile(file.path)}
              data-testid={`close-tab-${file.path}`}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="editor-frame" data-testid="editor-frame">
        {activeFile ? (
          <CollaborativeEditor
            key={`${activeFile.path}:${canEdit}`}
            file={activeFile}
            projectId={projectId}
            roomId={roomId}
            memberId={memberId}
            canEdit={canEdit}
            theme={theme}
            onLocalEdit={onLocalEdit}
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
          />
        ) : (
          <div className="empty-state">Open a file to start collaborating.</div>
        )}
      </div>
    </div>
  );
}

function CollaborativeEditor({
  file,
  projectId,
  roomId,
  memberId,
  canEdit,
  theme,
  onLocalEdit,
  onMount
}: {
  file: OpenFile;
  projectId: string;
  roomId: string;
  memberId: string;
  canEdit: boolean;
  theme: ThemeMode;
  onLocalEdit(path: string): void;
  onMount(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco
  ): void;
}) {
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "ready"
  >("connecting");
  const collaborationRef = useRef<{
    binding?: MonacoBinding;
    document: Y.Doc;
    provider: WebsocketProvider;
    text: Y.Text;
    observer: (event: Y.YTextEvent, transaction: Y.Transaction) => void;
  }>();

  useEffect(() => () => destroyCollaboration(), []);

  function destroyCollaboration() {
    const collaboration = collaborationRef.current;
    if (!collaboration) return;
    collaboration.binding?.destroy();
    collaboration.text.unobserve(collaboration.observer);
    collaboration.provider.destroy();
    collaboration.document.destroy();
    collaborationRef.current = undefined;
    if (window.__simplercpYjsSynced) {
      delete window.__simplercpYjsSynced[file.path];
    }
  }

  return (
    <div
      className="collaborative-editor"
      data-collaboration-status={connectionStatus}
      aria-busy={connectionStatus === "connecting"}
    >
      <Editor
        path={file.path}
        defaultValue={file.content}
        language={languageForPath(file.path)}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          readOnly: true,
          domReadOnly: true
        }}
        onMount={(editor, monaco) => {
          onMount(editor, monaco);

          const document = new Y.Doc();
          const text = document.getText("content");
          let binding: MonacoBinding | undefined;
          let bindingStarting = false;
          const bindingModule = import("y-monaco");
          const observer = (
            _event: Y.YTextEvent,
            transaction: Y.Transaction
          ) => {
            if (transaction.local && transaction.origin === binding) {
              onLocalEdit(file.path);
            }
          };
          text.observe(observer);

          const provider = new WebsocketProvider(
            collaborativeServerUrl(projectId),
            encodeURIComponent(`${roomId}:${file.path}`),
            document,
            {
              disableBc: true,
              params: { memberId }
            }
          );
          collaborationRef.current = {
            document,
            provider,
            text,
            observer
          };

          const bindWhenSynced = async (synced: boolean) => {
            if (!synced || binding || bindingStarting) return;
            bindingStarting = true;
            const { MonacoBinding } = await bindingModule;
            if (!collaborationRef.current) return;
            const model = editor.getModel();
            if (!model) return;
            binding = new MonacoBinding(text, model, new Set([editor]));
            if (collaborationRef.current) {
              collaborationRef.current.binding = binding;
            }
            editor.updateOptions({
              readOnly: !canEdit,
              domReadOnly: !canEdit
            });
            window.__simplercpYjsSynced ??= {};
            window.__simplercpYjsSynced[file.path] = true;
            setConnectionStatus("ready");
          };
          provider.on("sync", (synced) => void bindWhenSynced(synced));
          if (provider.synced) void bindWhenSynced(true);
        }}
      />
      {connectionStatus === "connecting" ? (
        <div
          className="editor-collaboration-status"
          role="status"
          data-testid="editor-collaboration-status"
        >
          <LoaderCircle size={16} aria-hidden="true" />
          Connecting collaboration
        </div>
      ) : null}
    </div>
  );
}

function collaborativeServerUrl(projectId: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/yjs/${encodeURIComponent(projectId)}`;
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
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".xml")) return "xml";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}
