import Editor, { loader } from "@monaco-editor/react";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as monacoRuntime from "monaco-editor";
import type * as Monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import type { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { summarizeTextChange } from "../editActivity";
import { historyEditRanges } from "../monacoHistory";
import type {
  CursorPosition,
  EditorSelection,
  FileEditChange,
  RemoteCursor
} from "../types";
import type { ThemeMode } from "../theme";

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "typescript" || label === "javascript" ? new TypeScriptWorker() : new EditorWorker();
  }
};
loader.config({ monaco: monacoRuntime });

export interface OpenFile {
  path: string;
  content: string;
}

declare global {
  interface Window {
    __simplercpEditors?: Record<string, Monaco.editor.IStandaloneCodeEditor>;
    __simplercpYjsSynced?: Record<string, boolean>;
    __simplercpMonaco?: typeof Monaco;
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
  saveState,
  onSelectFile,
  onCloseFile,
  onLocalEdit,
  onCursorChange,
  navigationTarget
  , frozenRegions, analyzingRegions, conflictCards
}: {
  openFiles: OpenFile[];
  activePath?: string;
  projectId: string;
  roomId: string;
  memberId: string;
  canEdit: boolean;
  theme: ThemeMode;
  remoteCursors: RemoteCursor[];
  saveState: "Saved" | "Saving" | "Sync failed";
  navigationTarget?: { path: string; lineNumber: number; sequence: number };
  onSelectFile(path: string): void;
  onCloseFile(path: string): void;
  onLocalEdit(path: string, change: FileEditChange): void;
  onCursorChange(
    path: string,
    position: CursorPosition,
    selection: EditorSelection
  ): void;
  frozenRegions?: Array<{ file: string; regions: Array<{ pairId: string; actor: { kind: string; memberId?: string }; startLine: number; endLine: number; summary: string }> }>;
  conflictCards?: Array<{ pairId: string; summary: string; files: string[] }>;
  analyzingRegions?: Array<{ file: string; regions: Array<{ pairId: string; startLine: number; endLine: number; summary: string }> }>;
}) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const [editorVersion, setEditorVersion] = useState(0);
  const appliedNavigation = useRef<number>();
  const activeFile = openFiles.find((file) => file.path === activePath);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.path !== activePath || appliedNavigation.current === navigationTarget.sequence) return;
    const editor = window.__simplercpEditors?.[navigationTarget.path];
    const model = editor?.getModel();
    if (!editor || !model || !window.__simplercpYjsSynced?.[navigationTarget.path]) return;
    const lineNumber = Math.min(navigationTarget.lineNumber, model.getLineCount());
    editor.setPosition({ lineNumber, column: model.getLineFirstNonWhitespaceColumn(lineNumber) || 1 });
    editor.revealLineInCenter(navigationTarget.lineNumber);
    editor.focus();
    appliedNavigation.current = navigationTarget.sequence;
  }, [activePath, editorVersion, navigationTarget]);

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
        <span
          className={`editor-save-state ${saveState.toLowerCase().replace(" ", "-")}`}
          data-testid="editor-save-status"
        >
          {saveState}
        </span>
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
            frozenRegions={frozenRegions?.find((entry) => entry.file === activeFile.path)?.regions}
            analyzingRegions={analyzingRegions?.find((entry) => entry.file === activeFile.path)?.regions}
            onReady={() => setEditorVersion((version) => version + 1)}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco;
              window.__simplercpMonaco = monaco;
              decorationIdsRef.current = [];
              setEditorVersion((version) => version + 1);
              window.__simplercpEditors ??= {};
              window.__simplercpEditors[activeFile.path] = editor;
              editor.onDidChangeCursorSelection((event) => {
                onCursorChange(
                  activeFile.path,
                  event.selection.getPosition(),
                  {
                    startLineNumber: event.selection.startLineNumber,
                    startColumn: event.selection.startColumn,
                    endLineNumber: event.selection.endLineNumber,
                    endColumn: event.selection.endColumn
                  }
                );
              });
            }}
            conflictCards={conflictCards?.filter((card) => card.files.includes(activeFile.path))}
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
  onMount,
  onReady
  , frozenRegions, analyzingRegions, conflictCards
}: {
  file: OpenFile;
  projectId: string;
  roomId: string;
  memberId: string;
  canEdit: boolean;
  theme: ThemeMode;
  onLocalEdit(path: string, change: FileEditChange): void;
  onReady(): void;
  onMount(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco
  ): void;
  frozenRegions?: Array<{ pairId: string; actor: { kind: string; memberId?: string }; startLine: number; endLine: number; summary: string }>;
  conflictCards?: Array<{ pairId: string; summary: string; files: string[] }>;
  analyzingRegions?: Array<{ pairId: string; startLine: number; endLine: number; summary: string }>;
}) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "reconnecting" | "ready"
  >("connecting");
  const frozenRegionsRef = useRef<Array<{ pairId: string; actor: { kind: string; memberId?: string }; startLine: number; endLine: number; summary: string }>>([]);
  const frozenDecorationIdsRef = useRef<string[]>([]);
  const analysisDecorationIdsRef = useRef<string[]>([]);
  frozenRegionsRef.current = frozenRegions ?? [];
  const collaborationRef = useRef<{
    binding?: MonacoBinding;
    document: Y.Doc;
    provider: WebsocketProvider;
    text: Y.Text;
    observer: (event: Y.YTextEvent, transaction: Y.Transaction) => void;
  }>();

  useEffect(() => () => destroyCollaboration(), []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = window.__simplercpMonaco;
    if (!editor || !monaco) return;
    frozenDecorationIdsRef.current = editor.deltaDecorations(frozenDecorationIdsRef.current, frozenRegionsRef.current.map((region) => ({ range: new monaco.Range(region.startLine, 1, region.endLine, 1), options: { isWholeLine: true, className: "conflict-frozen-range", hoverMessage: { value: `已冻结：${region.summary}` } } })));
    return () => { editor.deltaDecorations(frozenDecorationIdsRef.current, []); frozenDecorationIdsRef.current = []; };
  }, [frozenRegions]);

  useEffect(() => {
    const editor = editorRef.current; const monaco = window.__simplercpMonaco;
    if (!editor || !monaco) return;
    analysisDecorationIdsRef.current = editor.deltaDecorations(analysisDecorationIdsRef.current, (analyzingRegions ?? []).map((region) => ({ range: new monaco.Range(region.startLine, 1, region.endLine, 1), options: { isWholeLine: true, className: "conflict-analyzing-range", hoverMessage: { value: region.summary } } })));
    return () => { editor.deltaDecorations(analysisDecorationIdsRef.current, []); analysisDecorationIdsRef.current = []; };
  }, [analyzingRegions]);

  function destroyCollaboration() {
    const collaboration = collaborationRef.current;
    if (!collaboration) return;
    collaboration.binding?.destroy();
    collaboration.text.unobserve(collaboration.observer);
    collaboration.provider.destroy();
    collaboration.document.destroy();
    collaborationRef.current = undefined;
    if (window.__simplercpEditors?.[file.path] === editorRef.current) {
      delete window.__simplercpEditors[file.path];
    }
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
        theme={theme === "dark" ? "vs-dark" : "vs"}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          readOnly: connectionStatus !== "ready" || !canEdit,
          domReadOnly: connectionStatus !== "ready" || !canEdit
        }}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          onMount(editor, monaco);
          const model = editor.getModel();
          const showFrozenNotice = () => window.dispatchEvent(new CustomEvent("simplercp-conflict-guard-notice", { detail: "该区域已冻结" }));
          const intersectsFrozenRegion = (range: Monaco.IRange) => {
            if (!model) return false;
            const validRange = model.validateRange(range);
            const from = model.getOffsetAt({ lineNumber: validRange.startLineNumber, column: validRange.startColumn });
            const to = model.getOffsetAt({ lineNumber: validRange.endLineNumber, column: validRange.endColumn });
            const decoratedRegions = frozenDecorationIdsRef.current.flatMap((id) => { const range = model.getDecorationRange(id); return range ? [{ startLine: range.startLineNumber, endLine: range.endLineNumber }] : []; });
            const regions = decoratedRegions.length > 0 ? decoratedRegions : frozenRegionsRef.current;
            return regions.some((region) => {
              const startLine = Math.min(region.startLine, model.getLineCount());
              const endLine = Math.min(region.endLine, model.getLineCount());
              const start = model.getOffsetAt({ lineNumber: startLine, column: 1 });
              const end = model.getOffsetAt({ lineNumber: endLine, column: model.getLineMaxColumn(endLine) }) + (endLine < model.getLineCount() ? model.getEOL().length : 0);
              return from === to ? from >= start && from <= end : from < end && to > start;
            });
          };
          const pushEditOperations = model?.pushEditOperations;
          const guardedEdit: Monaco.editor.ITextModel["pushEditOperations"] = (beforeCursorState, editOperations, cursorStateComputer) => {
            if (editOperations.some((operation) => intersectsFrozenRegion(operation.range))) {
              showFrozenNotice();
              return beforeCursorState;
            }
            return pushEditOperations!.call(model!, beforeCursorState, editOperations, cursorStateComputer);
          };
          if (model) model.pushEditOperations = guardedEdit;
          const guardHistory = (action: "undo" | "redo", operation: () => void): (() => void) => () => {
            if (frozenRegionsRef.current.length > 0 && model) {
              try {
                if (historyEditRanges(model, action).some(intersectsFrozenRegion)) { showFrozenNotice(); return; }
              } catch (error) {
                console.error("Conflict guard could not read Monaco edit history", error);
                window.dispatchEvent(new CustomEvent("simplercp-conflict-guard-notice", { detail: "无法读取编辑历史，该操作暂不可用" }));
                return;
              }
            }
            operation();
          };
          const historyModel = model as Monaco.editor.ITextModel & { undo(): void; redo(): void };
          const originalUndo = historyModel.undo.bind(historyModel);
          const originalRedo = historyModel.redo.bind(historyModel);
          const guardedUndo = model ? guardHistory("undo", originalUndo) : undefined;
          const guardedRedo = model ? guardHistory("redo", originalRedo) : undefined;
          historyModel.undo = () => guardHistory("undo", originalUndo)();
          historyModel.redo = () => guardHistory("redo", originalRedo)();
          const undoCommand = editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => guardedUndo?.());
          const redoCommand = editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => guardedRedo?.());
          const trigger = editor.trigger.bind(editor);
          editor.trigger = ((source: string, handlerId: string, payload: unknown) => {
            if ((handlerId === "undo" || handlerId === "redo") && model) {
              (handlerId === "undo" ? guardedUndo : guardedRedo)?.();
              return;
            }
            return trigger(source, handlerId, payload);
          }) as typeof editor.trigger;
          editor.onDidDispose(() => {
            if (model?.pushEditOperations === guardedEdit) model.pushEditOperations = pushEditOperations!;
            editor.trigger = trigger as typeof editor.trigger;
            historyModel.undo = originalUndo;
            historyModel.redo = originalRedo;
            void undoCommand;
            void redoCommand;
          });

          const document = new Y.Doc();
          const text = document.getText("content");
          let observedText = text.toString();
          let binding: MonacoBinding | undefined;
          let bindingStarting = false;
          const bindingModule = import("y-monaco");
          const observer = (
            event: Y.YTextEvent,
            transaction: Y.Transaction
          ) => {
            const previousText = observedText;
            const nextText = text.toString();
            observedText = nextText;
            if (transaction.local && transaction.origin === binding) {
              const change = summarizeTextChange(
                previousText,
                nextText,
                event.delta
              );
              if (change.ranges.length > 0) {
                onLocalEdit(file.path, change);
              }
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
            if (!synced) return;
            if (binding) {
              setConnectionStatus("ready");
              return;
            }
            if (bindingStarting) return;
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
            onReady();
          };
          provider.on("sync", (synced) => void bindWhenSynced(synced));
          provider.on(
            "status",
            ({ status }: { status: "connecting" | "connected" | "disconnected" }) => {
              if (status === "disconnected") {
                setConnectionStatus((current) =>
                  current === "ready" ? "reconnecting" : current
                );
              }
            }
          );
          if (provider.synced) void bindWhenSynced(true);
        }}
      />
      {connectionStatus !== "ready" ? (
        <div
          className="editor-collaboration-status"
          role="status"
          data-testid="editor-collaboration-status"
        >
          <LoaderCircle size={16} aria-hidden="true" />
          {connectionStatus === "connecting"
            ? "Connecting collaboration"
            : "Reconnecting collaboration"}
        </div>
      ) : null}
      {conflictCards && conflictCards.length > 0 ? <div className="editor-conflict-overlay" data-testid="editor-conflict-overlay">{conflictCards.map((card) => <article className="conflict-card" key={card.pairId}><strong>冲突预防</strong><p>{card.summary}</p></article>)}</div> : null}
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
