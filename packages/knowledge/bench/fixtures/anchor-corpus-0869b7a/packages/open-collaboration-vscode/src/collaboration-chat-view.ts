// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable, postConstruct } from 'inversify';
import { ExtensionContext } from './inversify.js';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { CollaborationInstance } from './collaboration-instance.js';

export interface ChatPositionJson {
    line: number;
    character: number;
}

export interface ChatRangeJson {
    start: ChatPositionJson;
    end: ChatPositionJson;
}

export type ChatContextKind = 'selection' | 'file';

export interface ChatContextItemJson {
    id: string;
    kind: ChatContextKind;
    /** Workspace-relative path (best-effort) for display purposes. */
    path?: string;
    /** Workspace folder name (for multi-root workspaces). */
    workspaceFolderName?: string;
    /** Path relative to the workspace folder root (best-effort). */
    workspaceRelativePath: string;
    languageId?: string;
    range?: ChatRangeJson;
    content: string;
    truncated?: boolean;
    createdAt: number;
}

export interface ChatEditorStateJson {
    activePath?: string;
    cursor?: ChatPositionJson;
    selections?: ChatRangeJson[];
    selectedText?: string;
    selectedTextTruncated?: boolean;
    visiblePaths?: string[];
    openTabPaths?: string[];
}

export interface ChatMessageJson {
    id: string;
    userName: string;
    text: string;
    timestamp: number;
    context?: ChatContextItemJson[];
    editorState?: ChatEditorStateJson;
}

const CHAT_MESSAGE_BROADCAST = 'oct/chat/message';

type IncomingWebviewMessage =
    | { type: 'ready' }
    | { type: 'sendMessage'; text: string }
    | { type: 'exportMessages' }
    | { type: 'captureFromChat' }
    | { type: 'addSelectionContext' }
    | { type: 'addFileContext' }
    | { type: 'removePendingContext'; id: string }
    | { type: 'clearPendingContext' }
    | { type: 'openContext'; item: Pick<ChatContextItemJson, 'path' | 'workspaceFolderName' | 'workspaceRelativePath' | 'range'> };

@injectable()
export class CollaborationChatViewProvider implements vscode.WebviewViewProvider {

    @inject(ExtensionContext)
    private readonly context: vscode.ExtensionContext;

    @inject(CollaborationRoomService)
    private readonly roomService: CollaborationRoomService;

    private view: vscode.WebviewView | undefined;
    private instance: CollaborationInstance | undefined;
    private currentUserName = 'Me';
    private messages: ChatMessageJson[] = [];
    private messageIds = new Set<string>();
    private pendingContext: ChatContextItemJson[] = [];
    private readonly exportFolderName = '.CoVSCode';
    private readonly chatFolderName = 'chat';

    private readonly onDidAddMessageEmitter = new vscode.EventEmitter<ChatMessageJson>();
    readonly onDidAddMessage = this.onDidAddMessageEmitter.event;

    getMessagesSnapshot(): readonly ChatMessageJson[] {
        return this.messages.slice();
    }

    @postConstruct()
    protected init(): void {
        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('oct.chatView', this, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );

        this.roomService.onDidJoinRoom(async instance => {
            this.instance = instance;
            this.messages = [];
            this.messageIds.clear();
            this.pendingContext = [];
            try {
                this.currentUserName = (await instance.ownUserData).name ?? 'Me';
            } catch {
                this.currentUserName = 'Me';
            }

            // Receive chat broadcasts from other peers in this collaboration session.
            instance.connection.onBroadcast(CHAT_MESSAGE_BROADCAST, (_origin, message) => {
                if (!isChatMessageJson(message)) {
                    return;
                }
                this.addMessage(message);
            });

            // Make the chat discoverable immediately after joining.
            setTimeout(() => {
                vscode.commands.executeCommand('oct.chatView.focus');
            }, 150);

            this.postInit();

            instance.onDidDispose(() => {
                this.instance = undefined;
                this.messages = [];
                this.messageIds.clear();
                this.pendingContext = [];
                this.currentUserName = 'Me';
                this.postInit();
            });
        });
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.onDidDispose(() => {
            if (this.view === webviewView) {
                this.view = undefined;
            }
        });

        const webview = webviewView.webview;
        webview.options = {
            enableScripts: true
        };

        webview.html = this.getHtml(webview);
        webview.onDidReceiveMessage((message: IncomingWebviewMessage) => {
            if (message?.type === 'ready') {
                this.postInit();
                return;
            }
            if (message?.type === 'exportMessages') {
                void this.exportMessages();
                return;
            }
            if (message?.type === 'captureFromChat') {
                void vscode.commands.executeCommand('oct.knowledge.captureFromChat');
                return;
            }
            if (message?.type === 'addSelectionContext') {
                void this.addSelectionContext();
                return;
            }
            if (message?.type === 'addFileContext') {
                void this.addFileContext();
                return;
            }
            if (message?.type === 'removePendingContext') {
                if (typeof message.id === 'string') {
                    this.pendingContext = this.pendingContext.filter(i => i.id !== message.id);
                    this.postPendingContext();
                }
                return;
            }
            if (message?.type === 'clearPendingContext') {
                this.pendingContext = [];
                this.postPendingContext();
                return;
            }
            if (message?.type === 'openContext') {
                void this.openContext(message.item);
                return;
            }
            if (message?.type === 'sendMessage') {
                if (!this.instance) {
                    return;
                }
                const text = (message.text ?? '').trim();
                if (!text) {
                    return;
                }
                const chatMessage: ChatMessageJson = {
                    id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
                    userName: this.currentUserName,
                    text,
                    timestamp: Date.now(),
                    context: this.pendingContext.length ? this.pendingContext : undefined,
                    editorState: this.getEditorState()
                };
                // Show immediately locally; also broadcast to other peers.
                this.addMessage(chatMessage);
                this.instance.connection.sendBroadcast(CHAT_MESSAGE_BROADCAST, chatMessage);
                // Clear context after sending (matches typical "add context" workflows).
                this.pendingContext = [];
                this.postPendingContext();
                return;
            }
        }, undefined, this.context.subscriptions);

        this.postInit();
    }

    private async exportMessages(): Promise<void> {
        if (!this.instance) {
            vscode.window.showInformationMessage(vscode.l10n.t('Join a collaboration session to export chat messages.'));
            return;
        }
        if (!this.messages.length) {
            vscode.window.showInformationMessage(vscode.l10n.t('No chat messages to export in this session yet.'));
            return;
        }

        const picked = await vscode.window.showQuickPick(
            this.messages.map((m): (vscode.QuickPickItem & { messageId: string }) => ({
                messageId: m.id,
                label: `${m.userName}: ${truncateForSingleLineLabel(m.text, 120)}`,
                description: formatTimestampForDisplay(m.timestamp),
                detail: m.context?.length ? vscode.l10n.t('{0} context item(s)', m.context.length) : undefined
            })),
            {
                canPickMany: true,
                title: vscode.l10n.t('Select messages to export'),
                placeHolder: vscode.l10n.t('Choose one or more messages from this chat session')
            }
        );

        if (!picked || !picked.length) {
            return;
        }

        const ids = new Set(picked.map(p => p.messageId));
        const selected = this.messages.filter(m => ids.has(m.id));

        const workspaceFolder = this.getExportWorkspaceFolder();
        if (!workspaceFolder) {
            vscode.window.showErrorMessage(vscode.l10n.t('Open a workspace folder to export chat messages.'));
            return;
        }

        const root = vscode.Uri.joinPath(workspaceFolder.uri, this.exportFolderName);
        const exportDir = vscode.Uri.joinPath(root, this.chatFolderName);
        try {
            await vscode.workspace.fs.createDirectory(exportDir);
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create export folder: {0}', String(err)));
            return;
        }

        const fileName = `chat-${formatTimestampForFilename(Date.now())}.json`;
        const fileUri = vscode.Uri.joinPath(exportDir, fileName);

        const exportLabel = vscode.l10n.t('Export');
        const confirm = await vscode.window.showInformationMessage(
            vscode.l10n.t('Export {0} message(s) to {1}?', selected.length, fileName),
            { modal: true },
            exportLabel
        );
        if (confirm !== exportLabel) {
            return;
        }

        try {
            const json = JSON.stringify(selected, undefined, 2);
            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(json));
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to export chat messages: {0}', String(err)));
            return;
        }

        const revealLabel = vscode.l10n.t('Reveal in Explorer');
        const reveal = await vscode.window.showInformationMessage(
            vscode.l10n.t('Chat messages exported to {0}', fileUri.fsPath),
            revealLabel
        );
        if (reveal === revealLabel) {
            void vscode.commands.executeCommand('revealFileInOS', fileUri);
        }
    }

    private getExportWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        const active = vscode.window.activeTextEditor?.document?.uri;
        if (active) {
            const folder = vscode.workspace.getWorkspaceFolder(active);
            if (folder) {
                return folder;
            }
        }
        return vscode.workspace.workspaceFolders?.[0];
    }

    private addMessage(message: ChatMessageJson): void {
        if (this.messageIds.has(message.id)) {
            return;
        }
        this.messageIds.add(message.id);
        this.messages.push(message);
        this.view?.webview.postMessage({ type: 'addMessage', message });
        this.onDidAddMessageEmitter.fire(message);
    }

    private postInit(): void {
        this.view?.webview.postMessage({
            type: 'init',
            connected: !!this.instance,
            currentUserName: this.currentUserName,
            messages: this.messages,
            pendingContext: this.pendingContext
        });
    }

    private postPendingContext(): void {
        this.view?.webview.postMessage({
            type: 'pendingContext',
            pendingContext: this.pendingContext
        });
    }

    private async addSelectionContext(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage(vscode.l10n.t('No active editor to add selection context.'));
            return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showInformationMessage(vscode.l10n.t('Select some code first to add it as context.'));
            return;
        }
        const doc = editor.document;
        const raw = doc.getText(selection);
        const { content, truncated } = truncateText(raw, 20_000);
        const uri = doc.uri;
        if (!vscode.workspace.getWorkspaceFolder(uri)) {
            vscode.window.showErrorMessage(vscode.l10n.t('Please select code from a file inside the current workspace.'));
            return;
        }
        const ws = getWorkspacePathInfo(uri);
        if (!ws.workspaceRelativePath) {
            vscode.window.showErrorMessage(vscode.l10n.t('Please select code from a file inside the current workspace.'));
            return;
        }
        const item: ChatContextItemJson = {
            id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
            kind: 'selection',
            path: ws.displayPath ?? safeAsRelativePath(uri),
            workspaceFolderName: ws.workspaceFolderName,
            workspaceRelativePath: ws.workspaceRelativePath,
            languageId: doc.languageId,
            range: toChatRangeJson(selection),
            content,
            truncated: truncated || undefined,
            createdAt: Date.now()
        };
        this.pendingContext = [...this.pendingContext, item].slice(-10);
        this.postPendingContext();
    }

    private async addFileContext(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const defaultUri = folder?.uri ?? vscode.window.activeTextEditor?.document.uri;
        const picked = await vscode.window.showOpenDialog({
            defaultUri,
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: vscode.l10n.t('Add as Chat Context')
        });
        const uri = picked?.[0];
        if (!uri) {
            return;
        }
        // Only allow attaching files from the current workspace for navigability.
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage(vscode.l10n.t('Please pick a file inside the current workspace.'));
            return;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const { content, truncated } = truncateText(doc.getText(), 20_000);
        const ws = getWorkspacePathInfo(uri);
        if (!ws.workspaceRelativePath) {
            vscode.window.showErrorMessage(vscode.l10n.t('Please pick a file inside the current workspace.'));
            return;
        }
        const item: ChatContextItemJson = {
            id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
            kind: 'file',
            path: ws.displayPath ?? safeAsRelativePath(uri),
            workspaceFolderName: ws.workspaceFolderName,
            workspaceRelativePath: ws.workspaceRelativePath,
            languageId: doc.languageId,
            // For file context, jump to the beginning by default.
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            },
            content,
            truncated: truncated || undefined,
            createdAt: Date.now()
        };
        this.pendingContext = [...this.pendingContext, item].slice(-10);
        this.postPendingContext();
    }

    private async openContext(item: Pick<ChatContextItemJson, 'path' | 'workspaceFolderName' | 'workspaceRelativePath' | 'range'>): Promise<void> {
        if (!item || typeof item !== 'object') {
            return;
        }
        const candidateUris = resolveContextCandidateUris(item);
        for (const uri of candidateUris) {
            try {
                // Basic safety: only navigate within the workspace.
                if (!vscode.workspace.getWorkspaceFolder(uri)) {
                    continue;
                }
                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc, { preview: true });
                const vsRange = item.range ? fromChatRangeJson(item.range) : undefined;
                if (vsRange) {
                    editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    editor.selection = new vscode.Selection(vsRange.start, vsRange.end);
                }
                return;
            } catch {
                // Try next candidate.
            }
        }
        vscode.window.showErrorMessage(vscode.l10n.t('Cannot navigate: file is not in the current workspace.'));
    }

    private getEditorState(): ChatEditorStateJson {
        const visibleEditors = vscode.window.visibleTextEditors;
        const visiblePaths = visibleEditors
            .map(e => getWorkspacePathInfo(e.document.uri).displayPath)
            .filter((p): p is string => typeof p === 'string' && !!p);

        const openTabPaths: string[] = [];
        try {
            const seen = new Set<string>();
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    const input = (tab as unknown as { input?: unknown }).input;
                    const uris: vscode.Uri[] = [];
                    if (input && typeof input === 'object') {
                        const anyInput = input as Record<string, unknown>;
                        const uri = anyInput['uri'];
                        const original = anyInput['original'];
                        const modified = anyInput['modified'];
                        if (uri instanceof vscode.Uri) {
                            uris.push(uri);
                        }
                        if (original instanceof vscode.Uri) {
                            uris.push(original);
                        }
                        if (modified instanceof vscode.Uri) {
                            uris.push(modified);
                        }
                    }
                    for (const uri of uris) {
                        const s = uri.toString();
                        if (seen.has(s)) {
                            continue;
                        }
                        seen.add(s);
                        const displayPath = getWorkspacePathInfo(uri).displayPath;
                        if (displayPath) {
                            openTabPaths.push(displayPath);
                        }
                    }
                }
            }
        } catch {
            // Best-effort only (Tab API may differ across VS Code versions).
        }

        const active = vscode.window.activeTextEditor;
        if (!active) {
            return { visiblePaths, openTabPaths };
        }

        const doc = active.document;
        const activePath = getWorkspacePathInfo(doc.uri).displayPath;
        const cursor = { line: active.selection.active.line, character: active.selection.active.character };
        const selections = active.selections.map(toChatRangeJson);

        // Best-effort selected text snapshot (truncated).
        const rawSelectedText = active.selections
            .filter(s => !s.isEmpty)
            .map(s => doc.getText(s))
            .join('\n\n');
        const { content: selectedText, truncated: selectedTextTruncated } = truncateText(rawSelectedText, 10_000);

        return {
            activePath,
            cursor,
            selections,
            selectedText: selectedText || undefined,
            selectedTextTruncated: selectedTextTruncated || undefined,
            visiblePaths,
            openTabPaths
        };
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const csp = [
            `default-src 'none'`,
            `img-src ${webview.cspSource} https:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`
        ].join('; ');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Collaboration Chat</title>
  <style>
    :root {
      --pad: 10px;
    }
    body {
      padding: 0;
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .container {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: var(--pad);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .header-spacer {
      flex: 1;
    }
    .header-actions {
      display: flex;
      gap: 6px;
      align-items: baseline;
    }
    .title {
      font-weight: 600;
    }
    .meta {
      opacity: 0.75;
      font-size: 0.9em;
    }
    .messages {
      flex: 1;
      overflow: auto;
      padding: var(--pad);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .message {
      padding: 8px 10px;
      border: 1px solid var(--vscode-sideBar-border);
      border-radius: 6px;
      background: var(--vscode-editor-background);
    }
    .message-header {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 4px;
    }
    .user {
      font-weight: 600;
    }
    .time {
      opacity: 0.7;
      font-size: 0.85em;
    }
    .text {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.35;
    }
    .context {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .context-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid var(--vscode-sideBar-border);
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      font-size: 0.85em;
      line-height: 1.4;
      user-select: none;
    }
    .context-item button {
      height: auto;
      padding: 0 6px;
      border-radius: 999px;
    }
    .context-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 320px;
    }
    .context-link:hover {
      text-decoration: underline;
    }
    .composer {
      padding: var(--pad);
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--vscode-sideBar-background);
    }
    .composer-context-bar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .composer-context-items {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 120px;
    }
    .composer-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .composer-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      resize: none;
      min-height: 56px;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: inherit;
    }
    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 0;
    }
    button {
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      height: 36px;
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .empty {
      opacity: 0.75;
      padding: var(--pad);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">Chat</div>
      <div class="meta" id="status"></div>
      <div class="header-spacer"></div>
      <div class="header-actions">
        <button id="captureFromChat" title="从聊天生成知识卡片">知识卡片</button>
        <button id="export" title="导出本次会话聊天记录">导出</button>
      </div>
    </div>
    <div class="messages" id="messages">
      <div class="empty" id="empty">No messages yet.</div>
    </div>
    <div class="composer">
      <div class="composer-context-bar">
        <div class="composer-context-items" id="composerContext"></div>
        <div class="composer-actions">
          <button id="addSelection" title="Add selected code as context">+ Selection</button>
          <button id="addFile" title="Add a file from the workspace as context">+ File</button>
          <button id="clearContext" title="Clear all context">Clear</button>
        </div>
      </div>
      <div class="composer-row">
        <textarea id="input" placeholder="Type a message… (Enter to send, Shift+Enter for newline)"></textarea>
        <button id="send">Send</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const exportBtn = document.getElementById('export');
    const captureFromChatBtn = document.getElementById('captureFromChat');
    const composerContextEl = document.getElementById('composerContext');
    const addSelectionBtn = document.getElementById('addSelection');
    const addFileBtn = document.getElementById('addFile');
    const clearContextBtn = document.getElementById('clearContext');

    let pendingContext = [];

    function contextLabel(item) {
      const path = item && (item.path || item.workspaceRelativePath) ? (item.path || item.workspaceRelativePath) : 'context';
      const range = item && item.range && item.range.start && item.range.end ? item.range : undefined;
      if (!range) {
        return path;
      }
      const s = range.start.line + 1;
      let endLine = range.end.line;
      if (range.end.character === 0 && endLine > range.start.line) {
        endLine -= 1;
      }
      const e = endLine + 1;
      if (s === e) {
        return path + ':' + s;
      }
      return path + ':' + s + '-' + e;
    }

    function renderPendingContext() {
      if (!composerContextEl) {
        return;
      }
      composerContextEl.innerHTML = '';
      const items = Array.isArray(pendingContext) ? pendingContext : [];
      if (!items.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'meta';
        placeholder.textContent = 'No context attached';
        composerContextEl.appendChild(placeholder);
        return;
      }
      for (const item of items) {
        const chip = document.createElement('div');
        chip.className = 'context-item';

        const link = document.createElement('a');
        link.className = 'context-link';
        link.href = '#';
        link.textContent = contextLabel(item);
        link.title = contextLabel(item);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openContext',
            item: {
              path: item.path,
              workspaceFolderName: item.workspaceFolderName,
              workspaceRelativePath: item.workspaceRelativePath,
              range: item.range
            }
          });
        });

        const remove = document.createElement('button');
        remove.textContent = 'x';
        remove.title = 'Remove';
        remove.addEventListener('click', () => {
          vscode.postMessage({ type: 'removePendingContext', id: item.id });
        });

        chip.appendChild(link);
        chip.appendChild(remove);
        composerContextEl.appendChild(chip);
      }
    }

    function setStatus(connected, currentUserName) {
      if (!connected) {
        statusEl.textContent = 'Not connected';
        inputEl.disabled = true;
        sendBtn.disabled = true;
        if (exportBtn) exportBtn.disabled = true;
        if (captureFromChatBtn) captureFromChatBtn.disabled = true;
        if (addSelectionBtn) addSelectionBtn.disabled = true;
        if (addFileBtn) addFileBtn.disabled = true;
        if (clearContextBtn) clearContextBtn.disabled = true;
        return;
      }
      statusEl.textContent = currentUserName ? ('Signed in as ' + currentUserName) : 'Connected';
      inputEl.disabled = false;
      sendBtn.disabled = false;
      if (exportBtn) exportBtn.disabled = false;
      if (captureFromChatBtn) captureFromChatBtn.disabled = false;
      if (addSelectionBtn) addSelectionBtn.disabled = false;
      if (addFileBtn) addFileBtn.disabled = false;
      if (clearContextBtn) clearContextBtn.disabled = false;
    }

    function renderMessage(msg) {
      const empty = document.getElementById('empty');
      if (empty) empty.remove();

      const wrapper = document.createElement('div');
      wrapper.className = 'message';

      const header = document.createElement('div');
      header.className = 'message-header';

      const user = document.createElement('div');
      user.className = 'user';
      user.textContent = msg.userName ?? '';

      const time = document.createElement('div');
      time.className = 'time';
      const date = new Date(msg.timestamp || Date.now());
      time.textContent = date.toLocaleTimeString();

      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = msg.text ?? '';

      header.appendChild(user);
      header.appendChild(time);
      wrapper.appendChild(header);
      wrapper.appendChild(text);

      const ctxItems = Array.isArray(msg.context) ? msg.context : [];
      if (ctxItems.length) {
        const ctx = document.createElement('div');
        ctx.className = 'context';
        for (const item of ctxItems) {
          const chip = document.createElement('div');
          chip.className = 'context-item';

          const link = document.createElement('a');
          link.className = 'context-link';
          link.href = '#';
          link.textContent = contextLabel(item);
          link.title = contextLabel(item);
          link.addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({
              type: 'openContext',
              item: {
                path: item.path,
                workspaceFolderName: item.workspaceFolderName,
                workspaceRelativePath: item.workspaceRelativePath,
                range: item.range
              }
            });
          });

          chip.appendChild(link);
          ctx.appendChild(chip);
        }
        wrapper.appendChild(ctx);
      }
      messagesEl.appendChild(wrapper);

      // Keep the latest message in view.
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function send() {
      const text = (inputEl.value || '').trim();
      if (!text) {
        return;
      }
      vscode.postMessage({ type: 'sendMessage', text });
      inputEl.value = '';
      inputEl.focus();
    }

    sendBtn.addEventListener('click', send);
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportMessages' });
      });
    }
    if (captureFromChatBtn) {
      captureFromChatBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'captureFromChat' });
      });
    }
    if (addSelectionBtn) {
      addSelectionBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'addSelectionContext' });
      });
    }
    if (addFileBtn) {
      addFileBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'addFileContext' });
      });
    }
    if (clearContextBtn) {
      clearContextBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearPendingContext' });
      });
    }
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || !message.type) {
        return;
      }
      if (message.type === 'init') {
        // Reset UI
        messagesEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.id = 'empty';
        empty.textContent = 'No messages yet.';
        messagesEl.appendChild(empty);

        setStatus(!!message.connected, message.currentUserName);
        pendingContext = Array.isArray(message.pendingContext) ? message.pendingContext : [];
        renderPendingContext();
        const msgs = Array.isArray(message.messages) ? message.messages : [];
        for (const m of msgs) {
          renderMessage(m);
        }
        return;
      }
      if (message.type === 'pendingContext') {
        pendingContext = Array.isArray(message.pendingContext) ? message.pendingContext : [];
        renderPendingContext();
        return;
      }
      if (message.type === 'addMessage') {
        renderMessage(message.message || {});
        return;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function isChatMessageJson(value: unknown): value is ChatMessageJson {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Partial<ChatMessageJson>;
    return typeof v.id === 'string'
        && typeof v.userName === 'string'
        && typeof v.text === 'string'
        && typeof v.timestamp === 'number'
        && (v.context === undefined || isChatContextArrayJson(v.context))
        && (v.editorState === undefined || isChatEditorStateJson(v.editorState));
}

function isChatContextArrayJson(value: unknown): value is ChatContextItemJson[] {
    if (!Array.isArray(value)) {
        return false;
    }
    return value.every(isChatContextItemJson);
}

function isChatContextItemJson(value: unknown): value is ChatContextItemJson {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Partial<ChatContextItemJson>;
    return typeof v.id === 'string'
        && (v.kind === 'selection' || v.kind === 'file')
        && typeof v.content === 'string'
        && typeof v.createdAt === 'number'
        && (v.path === undefined || typeof v.path === 'string')
        && (v.workspaceFolderName === undefined || typeof v.workspaceFolderName === 'string')
        && typeof v.workspaceRelativePath === 'string'
        && (v.languageId === undefined || typeof v.languageId === 'string')
        && (v.truncated === undefined || typeof v.truncated === 'boolean')
        && (v.range === undefined || isChatRangeJson(v.range));
}

function isChatEditorStateJson(value: unknown): value is ChatEditorStateJson {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Partial<ChatEditorStateJson>;
    return (v.activePath === undefined || typeof v.activePath === 'string')
        && (v.cursor === undefined || isChatPositionJson(v.cursor))
        && (v.selections === undefined || (Array.isArray(v.selections) && v.selections.every(isChatRangeJson)))
        && (v.selectedText === undefined || typeof v.selectedText === 'string')
        && (v.selectedTextTruncated === undefined || typeof v.selectedTextTruncated === 'boolean')
        && (v.visiblePaths === undefined || (Array.isArray(v.visiblePaths) && v.visiblePaths.every(p => typeof p === 'string')))
        && (v.openTabPaths === undefined || (Array.isArray(v.openTabPaths) && v.openTabPaths.every(p => typeof p === 'string')));
}

function isChatPositionJson(value: unknown): value is ChatPositionJson {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Partial<ChatPositionJson>;
    return typeof v.line === 'number' && typeof v.character === 'number';
}

function isChatRangeJson(value: unknown): value is ChatRangeJson {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Partial<ChatRangeJson>;
    return !!v.start && !!v.end && isChatPositionJson(v.start) && isChatPositionJson(v.end);
}

function toChatRangeJson(range: vscode.Range): ChatRangeJson {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character }
    };
}

function fromChatRangeJson(range: ChatRangeJson): vscode.Range | undefined {
    if (!range?.start || !range?.end) {
        return undefined;
    }
    if (!Number.isFinite(range.start.line) || !Number.isFinite(range.start.character) || !Number.isFinite(range.end.line) || !Number.isFinite(range.end.character)) {
        return undefined;
    }
    return new vscode.Range(
        new vscode.Position(range.start.line, range.start.character),
        new vscode.Position(range.end.line, range.end.character)
    );
}

function safeAsRelativePath(uri: vscode.Uri): string | undefined {
    try {
        if (!vscode.workspace.getWorkspaceFolder(uri)) {
            return undefined;
        }
        return vscode.workspace.asRelativePath(uri, false);
    } catch {
        return undefined;
    }
}

function getWorkspacePathInfo(uri: vscode.Uri): { displayPath?: string; workspaceFolderName?: string; workspaceRelativePath?: string } {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
        // Privacy-first: do not expose absolute paths for non-workspace resources.
        return {};
    }
    // `includeWorkspaceFolder=true` prefixes with the folder name in multi-root workspaces.
    const withFolder = safeAsRelativePathWithFolder(uri);
    const displayPath = withFolder ?? safeAsRelativePath(uri);

    // Best-effort: try to compute path relative to the workspace folder (without the folder name prefix).
    let rel = safeAsRelativePath(uri);
    const prefix = folder.name.replace(/\\/g, '/') + '/';
    if (withFolder) {
        const normalized = withFolder.replace(/\\/g, '/');
        if (normalized.startsWith(prefix)) {
            rel = normalized.slice(prefix.length);
        }
    }
    return {
        displayPath,
        workspaceFolderName: folder.name,
        workspaceRelativePath: rel
    };
}

function safeAsRelativePathWithFolder(uri: vscode.Uri): string | undefined {
    try {
        if (!vscode.workspace.getWorkspaceFolder(uri)) {
            return undefined;
        }
        return vscode.workspace.asRelativePath(uri, true);
    } catch {
        return undefined;
    }
}

function resolveContextCandidateUris(item: Pick<ChatContextItemJson, 'path' | 'workspaceFolderName' | 'workspaceRelativePath'>): vscode.Uri[] {
    const candidates: vscode.Uri[] = [];

    // Privacy/portability: always reconstruct the URI from the receiver's workspace.
    const rel = item.workspaceRelativePath || item.path;

    const relSegments = splitAndSanitizeRelativePath(rel);
    if (!relSegments.length) {
        return candidates;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
        return candidates;
    }

    // If we know which workspace folder the sender used, prefer that.
    if (typeof item.workspaceFolderName === 'string' && item.workspaceFolderName) {
        const match = folders.find(f => f.name === item.workspaceFolderName);
        if (match) {
            candidates.push(vscode.Uri.joinPath(match.uri, ...relSegments));
            return candidates;
        }
    }

    // Multi-root heuristic: handle `folderName/path/to/file` if sender put it in `path`.
    if (typeof rel === 'string') {
        for (const folder of folders) {
            const prefix = folder.name.replace(/\\/g, '/') + '/';
            const relNorm = rel.replace(/\\/g, '/');
            if (relNorm.startsWith(prefix)) {
                const segs = splitAndSanitizeRelativePath(relNorm.slice(prefix.length));
                if (segs.length) {
                    candidates.push(vscode.Uri.joinPath(folder.uri, ...segs));
                    return candidates;
                }
            }
        }
    }

    // Last resort: try all workspace folders.
    for (const folder of folders) {
        candidates.push(vscode.Uri.joinPath(folder.uri, ...relSegments));
    }

    return candidates;
}

function splitAndSanitizeRelativePath(path: string | undefined): string[] {
    if (!path) {
        return [];
    }
    const normalized = String(path).replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/').filter(Boolean);
    // Prevent path traversal; this should only ever be workspace-relative.
    if (segments.some(s => s === '.' || s === '..')) {
        return [];
    }
    return segments;
}

function truncateText(text: string, maxChars: number): { content: string; truncated: boolean } {
    if (typeof text !== 'string') {
        return { content: '', truncated: false };
    }
    if (text.length <= maxChars) {
        return { content: text, truncated: false };
    }
    return { content: text.slice(0, maxChars), truncated: true };
}

function truncateForSingleLineLabel(text: string, maxChars: number): string {
    const normalized = String(text ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function formatTimestampForFilename(ts: number): string {
    // Windows filenames cannot contain ':'; also avoid '.'.
    return new Date(ts).toISOString().replace(/[:.]/g, '-');
}

function formatTimestampForDisplay(ts: number): string {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return '';
    }
}
