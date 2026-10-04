import Editor, { loader } from "@monaco-editor/react";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as monacoRuntime from "monaco-editor";
import type * as Monaco from "monaco-editor";
import type { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { summarizeTextChange } from "../editActivity";
import type {
  CursorPosition,
  EditorSelection,
  FileEditChange,
  RemoteCursor,
  KnowledgeCard,
  KnowledgeAnchorResolution
} from "../types";
import type { ThemeMode } from "../theme";

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
  onPinKnowledge,
  onReanchorKnowledge,
  knowledgeEnabled,
  knowledgeResolutions,
  knowledgeCards
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
  onSelectFile(path: string): void;
  onCloseFile(path: string): void;
  onLocalEdit(path: string, change: FileEditChange): void;
  onCursorChange(
    path: string,
    position: CursorPosition,
    selection: EditorSelection
  ): void;
  onPinKnowledge(file: string, selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void;
  onReanchorKnowledge(id: string, anchorIndex: number, selection: EditorSelection): Promise<void>;
  knowledgeEnabled: boolean;
  knowledgeResolutions: KnowledgeAnchorResolution[];
  knowledgeCards: KnowledgeCard[];
}) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const knowledgeDecorationIdsRef = useRef<string[]>([]);
  const knowledgeStateRef = useRef({ cards: knowledgeCards, resolutions: knowledgeResolutions, onReanchor: onReanchorKnowledge });
  knowledgeStateRef.current = { cards: knowledgeCards, resolutions: knowledgeResolutions, onReanchor: onReanchorKnowledge };
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

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFile) return;
    const cards = new Map(knowledgeCards.map((card) => [card.id, card]));
    const decorations = knowledgeResolutions
      .filter((resolution) => resolution.range && cards.has(resolution.cardId))
      .map((resolution) => {
        const card = cards.get(resolution.cardId)!;
        const range = resolution.range!;
        const canManage = card.ownerMemberId === memberId || card.review?.confirmedBy.includes(memberId);
        const openCommand = `${editor.getId()}:knowledge.openCard`;
        const reanchorCommand = `${editor.getId()}:knowledge.reanchor`;
        const openLink = `command:${openCommand}?${encodeURIComponent(JSON.stringify([card.id]))}`;
        const reanchorLink = `command:${reanchorCommand}?${encodeURIComponent(JSON.stringify([{ cardId: card.id, anchorIndex: resolution.anchorIndex }]))}`;
        const hoverMessage = {
          value: `**${card.type} · ${escapeKnowledgeMarkdown(card.title)}**\n\n${escapeKnowledgeMarkdown(card.summary)}\n\n${escapeKnowledgeMarkdown(card.provenance?.author.displayName ?? "")}\n\n[打开卡片](${openLink})${resolution.status === "needsReview" && canManage ? `\n\n[用当前选区重新锚定](${reanchorLink})` : ""}`,
          isTrusted: { enabledCommands: [openCommand, reanchorCommand] }
        };
        return {
          range: new monaco.Range(range.startLine, range.startColumn, range.endLine, range.endColumn),
          options: {
            className: resolution.status === "needsReview" ? "knowledge-anchor-review" : "knowledge-anchor-highlight",
            glyphMarginClassName: resolution.status === "needsReview" ? "knowledge-glyph knowledge-glyph-review" : `knowledge-glyph knowledge-glyph-${card.type}`,
            hoverMessage,
            glyphMarginHoverMessage: hoverMessage
          }
        };
      });
    knowledgeDecorationIdsRef.current = editor.deltaDecorations(knowledgeDecorationIdsRef.current, decorations);
  }, [activeFile, editorVersion, knowledgeCards, knowledgeResolutions, memberId]);

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
            knowledgeEnabled={knowledgeEnabled}
            theme={theme}
            onLocalEdit={onLocalEdit}
            onPinKnowledge={onPinKnowledge}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco;
              window.__simplercpMonaco = monaco;
              decorationIdsRef.current = [];
              knowledgeDecorationIdsRef.current = [];
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
              if (knowledgeEnabled) {
                const knowledgeActions: Monaco.IDisposable[] = [];
                knowledgeActions.push(editor.addAction({
                  id: "knowledge.openCard",
                  label: "打开知识卡片",
                  run: (_editor, cardId: string) => {
                    if (knowledgeStateRef.current.cards.some(card => card.id === cardId)) window.dispatchEvent(new CustomEvent("knowledge-open-card", { detail: cardId }));
                  }
                }));
                knowledgeActions.push(editor.addAction({
                  id: "knowledge.reanchor",
                  label: "用当前选区重新锚定",
                  run: async (_editor, input?: { cardId: string; anchorIndex: number }) => {
                    if (!input) return;
                    const { cardId, anchorIndex } = input;
                    const state = knowledgeStateRef.current;
                    const card = state.cards.find(item => item.id === cardId);
                    const selection = editor.getSelection();
                    const resolution = state.resolutions.find(item => item.cardId === cardId && item.anchorIndex === anchorIndex);
                    if (!card || !selection || selection.isEmpty() || resolution?.status !== "needsReview") return;
                    if (card.ownerMemberId !== memberId && !card.review?.confirmedBy.includes(memberId)) return;
                    if (card.anchors[anchorIndex]?.file.workspaceRelativePath !== activeFile.path) return;
                    await state.onReanchor(cardId, anchorIndex, selection);
                  }
                }));
                knowledgeActions.push(editor.addAction({
                  id: "knowledge.pin",
                  label: "Pin 为知识卡片",
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1,
                  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
                  run: () => {
                    const selection = editor.getSelection();
                    if (!selection || selection.isEmpty()) return;
                    onPinKnowledge(activeFile.path, {
                      startLineNumber: selection.startLineNumber,
                      startColumn: selection.startColumn,
                      endLineNumber: selection.endLineNumber,
                      endColumn: selection.endColumn
                    });
                  }
                }));
                editor.onDidDispose(() => { for (const action of knowledgeActions) action.dispose(); });
              }
            }}
          />
        ) : (
          <div className="empty-state">Open a file to start collaborating.</div>
        )}
      </div>
    </div>
  );
}

function escapeKnowledgeMarkdown(value: string) {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/g, "\\$&");
}

function CollaborativeEditor({
  file,
  projectId,
  roomId,
  memberId,
  canEdit,
  knowledgeEnabled,
  theme,
  onLocalEdit,
  onPinKnowledge,
  onMount
}: {
  file: OpenFile;
  projectId: string;
  roomId: string;
  memberId: string;
  canEdit: boolean;
  knowledgeEnabled: boolean;
  theme: ThemeMode;
  onLocalEdit(path: string, change: FileEditChange): void;
  onPinKnowledge(file: string, selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void;
  onMount(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco
  ): void;
}) {
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "reconnecting" | "ready"
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
        theme={theme === "dark" ? "vs-dark" : "vs"}
        options={{
          minimap: { enabled: false },
          glyphMargin: knowledgeEnabled,
          fontSize: 13,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          readOnly: connectionStatus !== "ready" || !canEdit,
          domReadOnly: connectionStatus !== "ready" || !canEdit
        }}
        onMount={(editor, monaco) => {
          onMount(editor, monaco);

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
