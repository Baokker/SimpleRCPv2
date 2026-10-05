// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable, postConstruct } from 'inversify';
import type { CaptureSuggestion, KnowledgeAnchor, KnowledgeCard, KnowledgeAssociationLevel, KnowledgeCardType } from 'open-collaboration-knowledge';
import {
    LatestSchemaVersion,
    WorkspaceKnowledgeCardsFolderName,
    WorkspaceKnowledgeFolderName,
    WorkspaceRootFolderName,
    isCaptureSuggestion,
    normalizeWorkspaceRelativePath,
    sha256Hex,
    shouldTriggerCapture
} from 'open-collaboration-knowledge';
import { nanoid } from 'nanoid';
import { ExtensionContext } from '../inversify.js';
import { CollaborationRoomService } from '../collaboration-room-service.js';
import type { CollaborationInstance } from '../collaboration-instance.js';
import { KnowledgeInboxStore } from './knowledge-inbox-store.js';
import { KnowledgeStore } from './knowledge-store.js';
import { ActivityIntensity } from './activity-intensity.js';
import type { ChatContextItemJson, ChatMessageJson } from '../collaboration-chat-view.js';
import { CollaborationChatViewProvider } from '../collaboration-chat-view.js';
import { openCaptureSuggestionEditor } from './knowledge-capture-editor.js';
import { KnowledgeLLMBridge } from './knowledge-llm-bridge.js';
import { inferDefaultAssociationLevel, inferSmallestContainingSymbolForRange, type SymbolCandidate } from './anchor-inference.js';
import { KnowledgeRAGBridge } from './knowledge-rag-bridge.js';
import { KnowledgeCardService } from './knowledge-service.js';

type SuggestionEvidence = Record<string, unknown>;

interface DocumentEditState {
    lastEditAt: number;
    lastEditRange?: vscode.Range;
    lastTodoCount?: number;
    todoLocations?: Array<{ line: number; col: number }>;
    todoCooldownUntil?: number;
    lastSavedText?: string;
    lastSavedTodoCount?: number;
    lastSavedTodoLines?: Array<{ line: number; col: number; token: string; text: string }>;
    magicCooldownUntil?: number;
    magicSavedKeys?: Set<string>;
    diagnosticsFixedTimer?: ReturnType<typeof setTimeout>;
    diagnosticsFixedAttempts?: number;
    diagnosticsPrevErrors?: number;
    diagnosticsLastErrors?: Array<{ message: string; source?: string; code?: string | number }>;
    diagnosticsErrorSnippets?: Array<{ message: string; source?: string; code?: string | number; line: number; snippet: string }>;
    diagnosticsTextAtErrorStart?: string;
    diagnosticsTextAtErrorStartTruncated?: boolean;
    diagnosticsErrorSince?: number;
    diagnosticsEditRanges?: Array<{ startLine: number; endLine: number; at: number }>;
    diagnosticsEditChars?: number;
    rollback?: {
        lastHash?: string;
        lastLength?: number;
        lastTextSnapshot?: string;
        lastTextSnapshotTruncated?: boolean;
        prevTextSnapshot?: string;
        prevTextSnapshotTruncated?: boolean;
        deletionCandidate?: {
            oldHash: string;
            at: number;
            range?: vscode.Range;
            removedChars?: number;
            insertedChars?: number;
            beforeText?: string;
            beforeTextTruncated?: boolean;
            afterText?: string;
            afterTextTruncated?: boolean;
            beforeAfter?: { startLine: number; endLine: number; before: string; after: string };
        };
        pendingHashTimer?: ReturnType<typeof setTimeout>;
        cooldownUntil?: number;
    };
    todoScanTimer?: ReturnType<typeof setTimeout>;
}

const CHAT_WINDOW_MS = 5 * 60_000;
const CHAT_COOLDOWN_MS = 5 * 60_000;

@injectable()
export class KnowledgeCaptureService implements vscode.Disposable {

    @inject(ExtensionContext)
    private readonly context: vscode.ExtensionContext;

    @inject(CollaborationRoomService)
    private readonly roomService: CollaborationRoomService;

    @inject(CollaborationChatViewProvider)
    private readonly chatView: CollaborationChatViewProvider;

    @inject(KnowledgeInboxStore)
    private readonly inbox: KnowledgeInboxStore;

    @inject(KnowledgeLLMBridge)
    private readonly llmBridge: KnowledgeLLMBridge;

    @inject(KnowledgeRAGBridge)
    private readonly ragBridge: KnowledgeRAGBridge;

    @inject(KnowledgeCardService)
    private readonly knowledgeCardService: KnowledgeCardService;

    private readonly store = new KnowledgeStore();
    private readonly activity = new ActivityIntensity();

    private instance: CollaborationInstance | undefined;
    private readonly toDispose: vscode.Disposable[] = [];

    private readonly docState = new Map<string, DocumentEditState>();
    private chatBuffer: ChatMessageJson[] = [];
    private chatCooldownUntil = 0;
    private readonly packageJsonHistory = new Map<string, { at: number; deps: Set<string>; text?: string }>();

    private pendingNotifyTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingNotifyCount = 0;
    private lastNotifyAt = 0;

    private readonly warningCooldownMs = 5 * 60_000;
    private readonly warnedFilesAt = new Map<string, number>();
    private readonly warnedCardsAt = new Map<string, number>();
    private warningGlobCacheKey = '';
    private warningGlobMatchers: RegExp[] = [];

    @postConstruct()
    protected init(): void {
        // Initialize baselines for already opened docs (avoid first-save false positives).
        for (const doc of vscode.workspace.textDocuments) {
            this.ensureBaselines(doc);
        }
        this.toDispose.push(
            this.roomService.onDidJoinRoom(instance => {
                this.instance = instance;
                instance.onDidDispose(() => {
                    if (this.instance === instance) {
                        this.instance = undefined;
                    }
                });
            }),
            vscode.workspace.onDidOpenTextDocument(doc => this.ensureBaselines(doc)),
            vscode.workspace.onDidChangeTextDocument(e => this.onTextChanged(e)),
            vscode.window.onDidChangeTextEditorSelection(() => this.activity.recordCursorMove()),
            vscode.window.onDidChangeActiveTextEditor(() => this.activity.recordFileSwitch()),
            vscode.workspace.onDidSaveTextDocument(doc => void this.onDidSaveTextDocument(doc)),
            vscode.languages.onDidChangeDiagnostics(e => void this.onDidChangeDiagnostics(e.uris)),
            this.chatView.onDidAddMessage(msg => void this.onChatMessage(msg))
        );
        this.context.subscriptions.push(this);
    }

    dispose(): void {
        if (this.pendingNotifyTimer) {
            clearTimeout(this.pendingNotifyTimer);
            this.pendingNotifyTimer = undefined;
        }
        for (const st of this.docState.values()) {
            if (st.todoScanTimer) {
                clearTimeout(st.todoScanTimer);
            }
            if (st.rollback?.pendingHashTimer) {
                clearTimeout(st.rollback.pendingHashTimer);
            }
            if (st.diagnosticsFixedTimer) {
                clearTimeout(st.diagnosticsFixedTimer);
            }
        }
        for (const d of this.toDispose) {
            d.dispose();
        }
        this.toDispose.length = 0;
    }

    async openInbox(): Promise<void> {
        await vscode.commands.executeCommand('oct.knowledgeInboxView.focus');
    }

    async captureFromChat(): Promise<void> {
        if (!this.instance) {
            vscode.window.showInformationMessage(vscode.l10n.t('Join a collaboration session to generate a knowledge card from chat messages.'));
            return;
        }
        const all = this.chatView.getMessagesSnapshot();
        if (!all.length) {
            vscode.window.showInformationMessage(vscode.l10n.t('No chat messages in this session yet.'));
            return;
        }

        const picked = await vscode.window.showQuickPick(
            all.map((m): (vscode.QuickPickItem & { messageId: string }) => ({
                messageId: m.id,
                label: `${m.userName}: ${truncateForSingleLineLabel(m.text, 120)}`,
                description: formatTimestampForDisplay(m.timestamp),
                detail: m.context?.length ? vscode.l10n.t('{0} context item(s)', m.context.length) : undefined
            })),
            {
                canPickMany: true,
                title: vscode.l10n.t('Select chat messages to capture'),
                placeHolder: vscode.l10n.t('Choose one or more messages from this chat session')
            }
        );

        if (!picked || !picked.length) {
            return;
        }

        const ids = new Set(picked.map(p => p.messageId));
        const selected = all.filter(m => ids.has(m.id));
        const selectedLimited = selected.length > 20 ? selected.slice(-20) : selected;

        const suggestedAnchors = pickAnchorFromChatMessages(selectedLimited);
        const folder = resolveFolderForSuggestion(suggestedAnchors?.[0]) ?? vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            vscode.window.showErrorMessage(vscode.l10n.t('Open a workspace folder to save knowledge cards.'));
            return;
        }

        const now = Date.now();
        const suggestion: CaptureSuggestion = {
            id: nanoid(16),
            triggerType: 'chat.dense',
            createdAt: now,
            suggestedType: 'context',
            suggestedTitle: 'Summarize selected chat messages',
            suggestedSummary: 'User-selected chat messages with code context from the collaboration chat.',
            suggestedAnchors,
            evidence: { chatMessages: sanitizeChatMessagesForEvidence(selectedLimited) }
        };

        await this.runAiDraftFlow(folder, suggestion);
    }

    async acceptSuggestion(folder: vscode.WorkspaceFolder, suggestionUri: vscode.Uri): Promise<void> {
        const suggestion = await readSuggestionFromUri(suggestionUri);
        if (!suggestion) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to read capture suggestion.'));
            return;
        }
        const card = await this.createDraftCardFromSuggestion(folder, suggestion, undefined);
        if (!card) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create knowledge card from suggestion.'));
            return;
        }
        const saved = await this.saveKnowledgeCard(folder, card);
        if (!saved) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save knowledge card.'));
            return;
        }
        await this.inbox.delete(folder, suggestionUri);
        vscode.window.showInformationMessage(vscode.l10n.t('Knowledge draft created: {0}', saved.fsPath));
    }

    async editSuggestion(folder: vscode.WorkspaceFolder, suggestionUri: vscode.Uri): Promise<void> {
        const suggestion = await readSuggestionFromUri(suggestionUri);
        if (!suggestion) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to read capture suggestion.'));
            return;
        }
        const init = await buildEditorInit(folder, suggestion);
        const edited = await openCaptureSuggestionEditor(init);
        if (!edited) {
            return;
        }
        const card = await this.createDraftCardFromSuggestion(folder, suggestion, edited);
        if (!card) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create knowledge card from suggestion.'));
            return;
        }
        const saved = await this.saveKnowledgeCard(folder, card);
        if (!saved) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save knowledge card.'));
            return;
        }
        await this.inbox.delete(folder, suggestionUri);
        vscode.window.showInformationMessage(vscode.l10n.t('Knowledge draft created: {0}', saved.fsPath));
    }

    async discardSuggestion(folder: vscode.WorkspaceFolder, suggestionUri: vscode.Uri): Promise<void> {
        const ok = await this.inbox.delete(folder, suggestionUri);
        if (!ok) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to discard suggestion.'));
        }
    }

    async aiDraftSuggestion(folder: vscode.WorkspaceFolder, suggestionUri: vscode.Uri): Promise<void> {
        const suggestion = await readSuggestionFromUri(suggestionUri);
        if (!suggestion) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to read capture suggestion.'));
            return;
        }
        await this.runAiDraftFlow(folder, suggestion, suggestionUri);
    }

    private async runAiDraftFlow(folder: vscode.WorkspaceFolder, suggestion: CaptureSuggestion, suggestionUriToDelete?: vscode.Uri): Promise<void> {
        const model = vscode.workspace.getConfiguration().get<string>('oct.knowledge.llm.model') ?? 'gpt-5-medium';
        const evidence = await this.buildEvidenceForLLM(folder, suggestion);
        const taskHints = buildLLMTaskHints(suggestion.triggerType);
        const mustMention = buildLLMMustMention(suggestion.triggerType, evidence);

        let draft: any;
        try {
            draft = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Generating AI knowledge draft...'),
                    cancellable: false
                },
                async () => await this.llmBridge.extractDraft(
                    {
                        triggerType: suggestion.triggerType,
                        suggestedTitle: suggestion.suggestedTitle,
                        suggestedSummary: suggestion.suggestedSummary,
                        anchors: suggestion.suggestedAnchors ?? [],
                        evidence,
                        projectHints: { taskHints, mustMention }
                    },
                    model
                )
            );
        } catch (err: any) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to generate AI draft: {0}', String(err?.message ?? err ?? 'Unknown error')));
            return;
        }

        const init = await buildEditorInit(folder, suggestion);
        init.defaultType = (draft?.type ?? init.defaultType) as any;
        init.defaultTitle = typeof draft?.title === 'string' && draft.title.trim() ? draft.title.trim() : init.defaultTitle;
        const tags = Array.isArray(draft?.tags) ? draft.tags.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 24) : [];
        if (tags.length) {
            init.defaultTags = tags.join(', ');
        }
        const summary = typeof draft?.summary === 'string' ? draft.summary.trim() : '';
        if (summary) {
            init.defaultSummary = summary;
        }
        const content = typeof draft?.content === 'string' ? draft.content.trim() : '';
        if (content) {
            init.defaultContent = content;
        }
        init.codeHelp = formatAIDraftHelp(draft);

        const edited = await openCaptureSuggestionEditor(init);
        if (!edited) {
            return;
        }

        const card = await this.createDraftCardFromSuggestion(folder, suggestion, edited);
        if (!card) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create knowledge card from suggestion.'));
            return;
        }
        card.source = 'ai';
        if (typeof draft?.confidence === 'number') {
            card.confidence = draft.confidence;
        }

        const saved = await this.saveKnowledgeCard(folder, card);
        if (!saved) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to save knowledge card.'));
            return;
        }
        if (suggestionUriToDelete) {
            await this.inbox.delete(folder, suggestionUriToDelete);
        }
        vscode.window.showInformationMessage(vscode.l10n.t('Knowledge draft created: {0}', saved.fsPath));
    }

    private async buildEvidenceForLLM(folder: vscode.WorkspaceFolder, suggestion: CaptureSuggestion): Promise<SuggestionEvidence> {
        const evidence: SuggestionEvidence = { ...(suggestion.evidence ?? {}) };

        if (suggestion.triggerType === 'packageJson.dependencySwitch') {
            const depUsages = (evidence as any)?.dependencyUsages;
            if (!depUsages || typeof depUsages !== 'object') {
                const added = Array.isArray((evidence as any)?.added) ? ((evidence as any).added as unknown[]).filter(x => typeof x === 'string') as string[] : [];
                const removed = Array.isArray((evidence as any)?.removed) ? ((evidence as any).removed as unknown[]).filter(x => typeof x === 'string') as string[] : [];
                const usageDeps = [...new Set([...added, ...removed])].slice(0, 6);
                const usagePairs = await Promise.all(usageDeps.map(async dep => {
                    const hits = await withTimeout(findDependencyUsages(folder, dep, 8), 2500).catch(() => []);
                    return [dep, hits] as const;
                }));
                const dependencyUsages: Record<string, Array<{ file: string; line: number; preview: string }>> = {};
                for (const [dep, hits] of usagePairs) {
                    if (hits.length) {
                        dependencyUsages[dep] = hits;
                    }
                }
                (evidence as any).dependencyUsages = dependencyUsages;
            }
        }

        if (suggestion.triggerType === 'diagnostics.fixed') {
            // Best-effort: add the current anchor code snippets again (helps the LLM focus).
            const anchors = suggestion.suggestedAnchors ?? [];
            (evidence as any).anchorSnapshots = anchors.slice(0, 3).map(a => ({
                file: a.file?.workspaceRelativePath,
                associationLevel: a.associationLevel,
                rangeAtCapture: a.rangeAtCapture,
                snapshot: a.snapshot?.text
            }));
        }

        if (suggestion.triggerType === 'chat.dense') {
            const msgs = Array.isArray((evidence as any)?.chatMessages) ? (evidence as any).chatMessages as any[] : [];
            const contexts = msgs.flatMap(m => Array.isArray(m?.context) ? m.context : []).slice(0, 12);
            (evidence as any).chatContextItems = contexts.map(c => ({
                workspaceRelativePath: c?.workspaceRelativePath,
                kind: c?.kind,
                range: c?.range,
                languageId: c?.languageId,
                content: c?.content,
                truncated: c?.truncated
            }));
            (evidence as any).chatEditorStates = msgs.slice(-8).map(m => ({
                messageId: m?.id,
                userName: m?.userName,
                timestamp: m?.timestamp,
                editorState: {
                    activePath: m?.editorState?.activePath,
                    selectedText: m?.editorState?.selectedText,
                    selectedTextTruncated: m?.editorState?.selectedTextTruncated,
                    cursor: m?.editorState?.cursor,
                    selections: m?.editorState?.selections
                }
            }));
        }

        return evidence;
    }

    private shouldCaptureNow(): boolean {
        if (!this.inbox.isCaptureEnabled()) {
            return false;
        }
        if (this.inbox.isHostOnly() && this.instance && !this.instance.host) {
            return false;
        }
        return true;
    }

    private shouldWarnNow(): boolean {
        if (vscode.env.uiKind === vscode.UIKind.Web) {
            return false;
        }
        const hasNode = typeof process === 'object' && !!process?.versions?.node;
        if (!hasNode) {
            return false;
        }
        const cfg = vscode.workspace.getConfiguration();
        const ragEnabled = cfg.get<boolean>('oct.knowledge.rag.enabled') ?? true;
        const warningsEnabled = cfg.get<boolean>('oct.knowledge.rag.warnings.enabled') ?? true;
        return ragEnabled && warningsEnabled;
    }

    private onTextChanged(e: vscode.TextDocumentChangeEvent): void {
        if (!this.shouldCaptureNow()) {
            return;
        }
        const doc = e.document;
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'oct') {
            return;
        }
        this.activity.recordEdit();
        const key = doc.uri.toString(true);
        const st: DocumentEditState = this.docState.get(key) ?? { lastEditAt: 0 };
        st.lastEditAt = Date.now();
        st.lastEditRange = mergeChangeRanges(st.lastEditRange, e.contentChanges);
        this.docState.set(key, st);

        if (st.diagnosticsErrorSince && (st.diagnosticsPrevErrors ?? 0) > 0) {
            const now = Date.now();
            st.diagnosticsEditRanges ??= [];
            for (const ch of e.contentChanges) {
                const startLine = Math.max(0, ch.range.start.line);
                const endLine = Math.max(startLine, ch.range.end.line);
                st.diagnosticsEditRanges.push({ startLine, endLine, at: now });
            }
            st.diagnosticsEditChars = (st.diagnosticsEditChars ?? 0) + estimateEditMagnitude(e.contentChanges);
            // Keep memory bounded.
            if (st.diagnosticsEditRanges.length > 200) {
                st.diagnosticsEditRanges.splice(0, st.diagnosticsEditRanges.length - 200);
            }
            this.docState.set(key, st);
        }
        void this.maybeTrackRollback(doc, e.contentChanges, st);
    }

    private async onDidSaveTextDocument(doc: vscode.TextDocument): Promise<void> {
        const captureEnabled = this.shouldCaptureNow();
        const warnEnabled = this.shouldWarnNow();
        if (!captureEnabled && !warnEnabled) {
            return;
        }
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'oct') {
            return;
        }
        const key = doc.uri.toString(true);
        const st: DocumentEditState = this.docState.get(key) ?? { lastEditAt: 0 };
        this.docState.set(key, st);

        const prevSavedText = st.lastSavedText;
        if (captureEnabled) {
            await this.maybeTriggerTodoClearedOnSave(doc, st);
            await this.maybeTriggerMagicNumbersOnSave(doc, st);
        }

        const savedText = truncateText(doc.getText(), 120_000).content;
        if (warnEnabled) {
            await this.maybeTriggerPitfallWarningsOnSave(doc, prevSavedText, savedText);
        }

        // Update baselines after save-trigger checks.
        st.lastSavedText = savedText;
        const savedTodos = findTodoLines(savedText, 50);
        st.lastSavedTodoCount = savedTodos.length;
        st.lastSavedTodoLines = savedTodos.slice(0, 20);
        this.docState.set(key, st);
        const path = (doc.uri.scheme === 'oct' ? doc.uri.path : doc.uri.fsPath).toLowerCase();
        if (!path.endsWith('package.json') && !path.endsWith('/package.json')) {
            return;
        }
        await this.maybeTriggerDependencySwitch(doc, { captureEnabled, warnEnabled });
    }

    private async onDidChangeDiagnostics(uris: readonly vscode.Uri[]): Promise<void> {
        if (!this.shouldCaptureNow()) {
            return;
        }
        for (const uri of uris) {
            if (uri.scheme !== 'file' && uri.scheme !== 'oct') {
                continue;
            }
            const key = uri.toString(true);
            const st: DocumentEditState = this.docState.get(key) ?? { lastEditAt: 0 };
            const diags = vscode.languages.getDiagnostics(uri);
            const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
            const prev = st.diagnosticsPrevErrors ?? 0;
            const now = Date.now();
            if (prev === 0 && errors.length > 0) {
                st.diagnosticsErrorSince = now;
                st.diagnosticsEditRanges = [];
                st.diagnosticsEditChars = 0;
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const text = doc.getText();
                    const truncated = truncateText(text, 120_000);
                    st.diagnosticsTextAtErrorStart = truncated.content;
                    st.diagnosticsTextAtErrorStartTruncated = truncated.truncated;
                    st.diagnosticsErrorSnippets = errors.slice(0, 4).map(d => {
                        const line = clampLine(doc, d.range.start.line);
                        return {
                            message: d.message,
                            source: d.source,
                            code: typeof d.code === 'object' ? (d.code as any)?.value : d.code,
                            line,
                            snippet: extractSurroundingLines(doc, line, 2)
                        };
                    });
                } catch {
                    // ignore
                }
            }
            st.diagnosticsPrevErrors = errors.length;
            if (errors.length > 0) {
                st.diagnosticsLastErrors = errors.slice(0, 6).map(d => ({
                    message: d.message,
                    source: d.source,
                    code: typeof d.code === 'object' ? (d.code as any)?.value : d.code
                }));
            }
            this.docState.set(key, st);
            if (prev > 0 && errors.length === 0) {
                this.scheduleDiagnosticsFixed(uri, st);
            }
            if (errors.length > 0 && prev === 0) {
                st.diagnosticsFixedAttempts = 0;
            }
            // Keep `diagnosticsErrorSince` until the delayed fixed-check runs.
        }
    }

    private async onChatMessage(message: ChatMessageJson): Promise<void> {
        if (!this.shouldCaptureNow()) {
            return;
        }
        this.chatBuffer.push(message);
        const now = Date.now();
        const cutoff = now - CHAT_WINDOW_MS;
        this.chatBuffer = this.chatBuffer.filter(m => m.timestamp >= cutoff);
        if (now < this.chatCooldownUntil) {
            return;
        }
        const windowMs = this.chatBuffer.length ? now - this.chatBuffer[0].timestamp : Infinity;
        if (!shouldTriggerCapture({ triggerType: 'chat.dense', messageCount: this.chatBuffer.length, windowMs })) {
            return;
        }
        this.chatCooldownUntil = now + CHAT_COOLDOWN_MS;
        const action = vscode.l10n.t('Summarize as Knowledge Card');
        vscode.window.showInformationMessage(
            vscode.l10n.t('The current chat is fairly dense. Do you want to summarize it into a knowledge card?'),
            action
        ).then(selection => {
            if (selection === action) {
                void this.captureFromChat();
            }
        });
    }

    private async enqueue(folder: vscode.WorkspaceFolder, suggestion: CaptureSuggestion): Promise<void> {
        const uri = await this.inbox.write(folder, suggestion);
        if (!uri) {
            return;
        }
        this.pendingNotifyCount++;
        this.maybeNotify();
    }

    private maybeNotify(): void {
        if (this.pendingNotifyTimer) {
            return;
        }
        const schedule = (delayMs: number) => {
            this.pendingNotifyTimer = setTimeout(() => {
                this.pendingNotifyTimer = undefined;
                const now = Date.now();
                const level = this.activity.level(now);
                const idle = this.activity.isIdle(now);
                if (level === 'high' && !idle) {
                    this.maybeNotify();
                    return;
                }
                if (now - this.lastNotifyAt < 15_000) {
                    this.maybeNotify();
                    return;
                }
                const count = this.pendingNotifyCount;
                this.pendingNotifyCount = 0;
                this.lastNotifyAt = now;
                const open = vscode.l10n.t('Open Inbox');
                vscode.window.showInformationMessage(vscode.l10n.t('New knowledge capture suggestions: {0}', count), open).then(sel => {
                    if (sel === open) {
                        void this.openInbox();
                    }
                });
            }, delayMs);
        };
        const now = Date.now();
        const level = this.activity.level(now);
        const idle = this.activity.isIdle(now);
        schedule(level === 'high' && !idle ? 5_000 : 800);
    }

    private async maybeTriggerTodoClearedOnSave(doc: vscode.TextDocument, st: DocumentEditState): Promise<void> {
        const now = Date.now();
        if (st.todoCooldownUntil && now < st.todoCooldownUntil) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) {
            return;
        }
        const rel = safeWorkspaceRelativePath(doc.uri);
        if (!rel) {
            return;
        }

        const prevText = st.lastSavedText;
        const prevTodos = (prevText ? findTodoLines(prevText, 50) : (st.lastSavedTodoLines ?? []));
        const prevCount = st.lastSavedTodoCount ?? prevTodos.length;

        const nextText = doc.getText();
        if (nextText.length > 800_000) {
            return;
        }
        const nextTodos = findTodoLines(nextText, 50);
        if (!shouldTriggerCapture({ triggerType: 'todo.cleared', beforeTodos: prevCount, afterTodos: nextTodos.length })) {
            return;
        }

        const diff = prevText ? computeChangedRangeLines(prevText, nextText) : undefined;
        const diffRange = diff
            ? new vscode.Range(new vscode.Position(diff.startLine, 0), doc.lineAt(clampLine(doc, diff.endLine)).range.end)
            : pickBestTodoRange(doc, prevTodos.map(t => ({ line: t.line, col: t.col })), st.lastEditRange);
        const narrowed = narrowRangeIfTooLarge(doc, diffRange, 6000);
        const snapshot = narrowed ? doc.getText(narrowed) : truncateText(nextText, 2000).content;

        const anchor = basicAnchor({
            anchorId: nanoid(16) + '-a',
            folder,
            rel,
            associationLevel: narrowed ? 'block' : 'file',
            range: narrowed,
            snapshot
        });

        const evidence: SuggestionEvidence = {
            file: normalizeWorkspaceRelativePath(rel),
            todo: {
                beforeCount: prevCount,
                afterCount: nextTodos.length,
                before: prevTodos.slice(0, 20).map(t => ({ line: t.line + 1, token: t.token, text: t.text }))
            },
            diff: prevText && diff
                ? {
                    startLine: diff.startLine + 1,
                    endLine: diff.endLine + 1,
                    before: sliceLines(prevText, diff.startLine, diff.endLine, 4000),
                    after: sliceLines(nextText, diff.startLine, diff.endLine, 4000)
                }
                : undefined
        };

        st.todoCooldownUntil = Date.now() + 5 * 60_000;
        await this.enqueue(folder, {
            id: nanoid(16),
            triggerType: 'todo.cleared',
            createdAt: Date.now(),
            suggestedType: 'tutorial',
            suggestedTitle: `TODOs cleared in ${basename(rel)}`,
            suggestedSummary: 'TODO/FIXME markers were cleared on save. Consider capturing what changed and why it resolved the TODOs.',
            suggestedAnchors: [anchor],
            evidence
        });
    }

    private async maybeTriggerMagicNumbersOnSave(doc: vscode.TextDocument, st: DocumentEditState): Promise<void> {
        const now = Date.now();
        if (!isTsJsLanguage(String(doc.languageId ?? ''))) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) {
            return;
        }
        const rel = safeWorkspaceRelativePath(doc.uri);
        if (!rel) {
            return;
        }
        const occ = findMagicNumberOccurrences(doc);
        const nextKeys = new Set(occ.map(o => o.key));

        const prevKeys = st.magicSavedKeys;
        st.magicSavedKeys = nextKeys;
        this.docState.set(doc.uri.toString(true), st);

        if (!prevKeys) {
            // Baseline only; don't suggest on first observation.
            return;
        }

        const added = occ.filter(o => !prevKeys.has(o.key));
        if (!shouldTriggerCapture({ triggerType: 'magicNumber.added', addedMagicNumbers: added.length })) {
            return;
        }

        const fullText = doc.getText();
        const uniqueNumbersAll = [...new Set(added.map(a => a.number))];
        const usage = uniqueNumbersAll.slice(0, 6).map(num => ({
            number: num,
            occurrences: findNumberOccurrences(fullText, num, 20).map(line => ({
                line: line.line + 1,
                text: line.text,
                context: line.context
            }))
        }));

        const evidence: SuggestionEvidence = {
            file: normalizeWorkspaceRelativePath(rel),
            added: added.slice(0, 10).map(a => ({ line: a.line + 1, number: a.number, lineText: a.lineText })),
            usage
        };

        if (st.magicCooldownUntil && now < st.magicCooldownUntil) {
            return;
        }

        const anchors = added.slice(0, 3).map(a => {
            const range = new vscode.Range(new vscode.Position(a.line, 0), doc.lineAt(a.line).range.end);
            return basicAnchor({
                anchorId: nanoid(16) + '-a',
                folder,
                rel,
                associationLevel: 'block',
                range,
                snapshot: a.lineText
            });
        });

        const uniqueNumbers = [...new Set(added.map(a => a.number))].slice(0, 4);
        const title = uniqueNumbers.length === 1
            ? `Explain magic number ${uniqueNumbers[0]}`
            : `Explain magic numbers ${uniqueNumbers.join(', ')}`;

        st.magicCooldownUntil = now + 2 * 60_000;
        await this.enqueue(folder, {
            id: nanoid(16),
            triggerType: 'magicNumber.added',
            createdAt: now,
            suggestedType: 'constraint',
            suggestedTitle: title,
            suggestedSummary: 'New hard-coded numbers were added without nearby comments. Consider documenting what they mean or extracting them into named constants.',
            suggestedAnchors: anchors,
            evidence
        });
    }

    private async maybeTriggerDependencySwitch(_doc: vscode.TextDocument, opts: { captureEnabled: boolean; warnEnabled: boolean }): Promise<void> {
        const doc = _doc;
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) {
            return;
        }
        const rel = safeWorkspaceRelativePath(doc.uri);
        if (!rel) {
            return;
        }
        const text = doc.getText();
        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            return;
        }
        const depsObj = { ...(json?.dependencies ?? {}), ...(json?.devDependencies ?? {}) };
        const deps = new Set(Object.keys(depsObj).filter(Boolean));
        const key = folder.uri.toString(true) + '::' + normalizeWorkspaceRelativePath(rel);
        const prev = this.packageJsonHistory.get(key);
        this.packageJsonHistory.set(key, { at: Date.now(), deps, text });
        if (!prev) {
            return;
        }
        const now = Date.now();
        const added = [...deps].filter(d => !prev.deps.has(d));
        const removed = [...prev.deps].filter(d => !deps.has(d));
        if (!shouldTriggerCapture({
            triggerType: 'packageJson.dependencySwitch',
            dependencyChanges: added.length + removed.length,
            dependencyAgeMs: now - prev.at
        })) {
            return;
        }
        const usageDeps = [...new Set([...added, ...removed])].slice(0, 6);
        const usagePairs = await Promise.all(usageDeps.map(async dep => {
            const hits = await withTimeout(findDependencyUsages(folder, dep, 8), 2500).catch(() => []);
            return [dep, hits] as const;
        }));
        const dependencyUsages: Record<string, Array<{ file: string; line: number; preview: string }>> = {};
        for (const [dep, hits] of usagePairs) {
            if (hits.length) {
                dependencyUsages[dep] = hits;
            }
        }
        const diff = prev.text
            ? computeChangedRangeLines(prev.text, text)
            : undefined;
        const evidence: SuggestionEvidence = {
            file: normalizeWorkspaceRelativePath(rel),
            added,
            removed,
            dependencyUsages,
            diff: prev.text && diff
                ? {
                    startLine: diff.startLine + 1,
                    endLine: diff.endLine + 1,
                    before: sliceLines(prev.text, diff.startLine, diff.endLine, 4000),
                    after: sliceLines(text, diff.startLine, diff.endLine, 4000)
                }
                : undefined
        };
        const range = diff
            ? new vscode.Range(new vscode.Position(diff.startLine, 0), doc.lineAt(clampLine(doc, diff.endLine)).range.end)
            : undefined;
        const narrowed = narrowRangeIfTooLarge(doc, range, 4000);
        const anchor = basicAnchor({
            anchorId: nanoid(16) + '-a',
            folder,
            rel,
            associationLevel: narrowed ? 'block' : 'file',
            range: narrowed,
            snapshot: narrowed ? doc.getText(narrowed) : truncateText(text, 2000).content
        });

        if (opts.warnEnabled) {
            await this.maybeWarnFromDependencySwitch(folder, rel, added, removed, evidence.diff);
        }

        if (opts.captureEnabled) {
            await this.enqueue(folder, {
                id: nanoid(16),
                triggerType: 'packageJson.dependencySwitch',
                createdAt: now,
                suggestedType: 'decision',
                suggestedTitle: 'Dependency change rationale',
                suggestedSummary: 'Dependencies changed in package.json. Consider capturing why the dependency set was adjusted.',
                suggestedAnchors: [anchor],
                evidence
            });
        }
    }

    private async maybeTriggerPitfallWarningsOnSave(
        doc: vscode.TextDocument,
        previousSavedText: string | undefined,
        currentSavedText: string
    ): Promise<void> {
        if (!this.shouldWarnNow()) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) {
            return;
        }
        const rel = safeWorkspaceRelativePath(doc.uri);
        if (!rel) {
            return;
        }
        const lower = rel.toLowerCase();
        if (lower.endsWith('package.json') || lower.endsWith('/package.json')) {
            return;
        }
        if (!this.isConfigFileForWarnings(rel)) {
            return;
        }

        const diff = previousSavedText
            ? computeChangedRangeLines(previousSavedText, currentSavedText)
            : undefined;

        const queryLines: string[] = [];
        queryLines.push(`Config file changed: ${normalizeWorkspaceRelativePath(rel)}`);
        if (diff && previousSavedText) {
            queryLines.push(`Changed lines: ${diff.startLine + 1}-${diff.endLine + 1}`);
            queryLines.push('--- BEFORE ---');
            queryLines.push(sliceLines(previousSavedText, diff.startLine, diff.endLine, 4000));
            queryLines.push('--- AFTER ---');
            queryLines.push(sliceLines(currentSavedText, diff.startLine, diff.endLine, 4000));
        } else {
            queryLines.push('--- FILE (truncated) ---');
            queryLines.push(truncateText(currentSavedText, 4000).content);
        }

        await this.runPitfallWarningSearch(folder, rel, queryLines.join('\n'));
    }

    private async maybeWarnFromDependencySwitch(
        folder: vscode.WorkspaceFolder,
        rel: string,
        added: string[],
        removed: string[],
        diff: any
    ): Promise<void> {
        if (!this.shouldWarnNow()) {
            return;
        }
        const queryLines: string[] = [];
        queryLines.push(`package.json dependency change: ${normalizeWorkspaceRelativePath(rel)}`);
        if (added.length) {
            queryLines.push(`added: ${added.slice(0, 30).join(', ')}`);
        }
        if (removed.length) {
            queryLines.push(`removed: ${removed.slice(0, 30).join(', ')}`);
        }
        if (diff && typeof diff === 'object') {
            const before = String((diff as any).before ?? '');
            const after = String((diff as any).after ?? '');
            if (before.trim() || after.trim()) {
                queryLines.push('--- BEFORE ---');
                queryLines.push(before.slice(0, 4000));
                queryLines.push('--- AFTER ---');
                queryLines.push(after.slice(0, 4000));
            }
        }
        await this.runPitfallWarningSearch(folder, rel, queryLines.join('\n'));
    }

    private async runPitfallWarningSearch(folder: vscode.WorkspaceFolder, rel: string, query: string): Promise<void> {
        const cfg = vscode.workspace.getConfiguration();
        const threshold = cfg.get<number>('oct.knowledge.rag.warnings.threshold') ?? 0.8;

        const now = Date.now();
        const normalizedRel = normalizeWorkspaceRelativePath(rel);
        const fileKey = folder.uri.toString(true) + '::' + normalizedRel;
        const lastFileAt = this.warnedFilesAt.get(fileKey) ?? 0;
        if (now - lastFileAt < this.warningCooldownMs) {
            return;
        }

        const results = await withTimeout(this.ragBridge.search({
            workspaceFolder: folder,
            query,
            topK: 3,
            activeFile: normalizedRel,
            filters: { types: ['negative', 'risk', 'constraint'] }
        }), 4500).catch(() => []);
        if (!results.length) {
            return;
        }

        const best = results[0];
        const eligible = best.mode === 'vector'
            ? best.score >= threshold
            : best.score >= 1.0;
        if (!eligible) {
            return;
        }

        const lastCardAt = this.warnedCardsAt.get(best.cardId) ?? 0;
        if (now - lastCardAt < this.warningCooldownMs) {
            return;
        }

        this.warnedFilesAt.set(fileKey, now);
        this.warnedCardsAt.set(best.cardId, now);

        const title = best.title?.trim() ? best.title.trim() : best.cardId;
        const detail = best.summary?.trim() ? best.summary.trim() : `Matched ${best.type} knowledge card (${best.mode}, score=${best.score.toFixed(2)}).`;
        const viewLabel = vscode.l10n.t('View card');
        const dismissLabel = vscode.l10n.t('Dismiss');
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('Potential pitfall: {0}', title),
            { detail, modal: false },
            viewLabel,
            dismissLabel
        );
        if (choice === viewLabel) {
            await this.openKnowledgeCardById(folder, best.cardId);
        }
    }

    private async openKnowledgeCardById(folder: vscode.WorkspaceFolder, cardId: string): Promise<void> {
        const id = String(cardId ?? '').trim();
        if (!id) {
            return;
        }
        const uri = vscode.Uri.joinPath(
            folder.uri,
            WorkspaceRootFolderName,
            WorkspaceKnowledgeFolderName,
            WorkspaceKnowledgeCardsFolderName,
            `card-${id}.json`
        );
        await this.knowledgeCardService.openKnowledgeCardEditor(folder, uri);
    }

    private isConfigFileForWarnings(workspaceRelativePath: string): boolean {
        const normalized = normalizeWorkspaceRelativePath(workspaceRelativePath).toLowerCase();
        if (!normalized) {
            return false;
        }
        const matchers = this.getWarningGlobMatchers();
        if (!matchers.length) {
            return false;
        }
        return matchers.some(re => re.test(normalized));
    }

    private getWarningGlobMatchers(): RegExp[] {
        const cfg = vscode.workspace.getConfiguration();
        const patterns = (cfg.get<string[]>('oct.knowledge.rag.warnings.configFiles') ?? []).map(s => String(s ?? '').trim()).filter(Boolean);
        const key = patterns.join('\n');
        if (key === this.warningGlobCacheKey && this.warningGlobMatchers.length) {
            return this.warningGlobMatchers;
        }
        this.warningGlobCacheKey = key;
        this.warningGlobMatchers = patterns.map(p => globToRegExp(p)).filter(Boolean);
        return this.warningGlobMatchers;
    }

    private async maybeTriggerDiagnosticsFixed(_uri: vscode.Uri, _st: DocumentEditState): Promise<void> {
        const uri = _uri;
        const st = _st;
        const now = Date.now();
        const errorSince = st.diagnosticsErrorSince;
        if (!errorSince) {
            return;
        }
        const edits = (st.diagnosticsEditRanges ?? []).filter(r => r.at >= errorSince);
        const editChars = st.diagnosticsEditChars ?? 0;
        if (!edits.length || !shouldTriggerCapture({
            triggerType: 'diagnostics.fixed',
            previousErrors: 1,
            currentErrors: 0,
            errorAgeMs: now - errorSince,
            editChars,
            lastEditAgeMs: st.lastEditAt ? now - st.lastEditAt : Infinity
        })) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            return;
        }
        const rel = safeWorkspaceRelativePath(uri);
        if (!rel) {
            return;
        }

        const merged = mergeLineRanges(edits.map(e => ({ startLine: e.startLine, endLine: e.endLine })));
        const ranges = merged.length > 3 ? [{ startLine: merged[0].startLine, endLine: merged[merged.length - 1].endLine }] : merged;

        const doc = await vscode.workspace.openTextDocument(uri);
        const currentText = doc.getText();
        const anchors = ranges.map((r, idx) => {
            const startLine = clampLine(doc, r.startLine);
            const endLine = clampLine(doc, r.endLine);
            const range = new vscode.Range(new vscode.Position(startLine, 0), doc.lineAt(endLine).range.end);
            const text = truncateText(doc.getText(range), 4000).content;
            return basicAnchor({
                anchorId: `${nanoid(16)}-a${idx + 1}`,
                folder,
                rel,
                associationLevel: 'block',
                range,
                snapshot: text
            });
        });

        const beforeText = st.diagnosticsTextAtErrorStart;
        const beforeAfter = beforeText
            ? (() => {
                const diff = computeChangedRangeLines(beforeText, currentText);
                if (!diff) {
                    return undefined;
                }
                return {
                    startLine: diff.startLine + 1,
                    endLine: diff.endLine + 1,
                    before: sliceLines(beforeText, diff.startLine, diff.endLine, 6000),
                    after: sliceLines(currentText, diff.startLine, diff.endLine, 6000),
                    truncated: !!st.diagnosticsTextAtErrorStartTruncated
                };
            })()
            : undefined;

        const evidence: SuggestionEvidence = {
            file: normalizeWorkspaceRelativePath(rel),
            lastErrors: st.diagnosticsLastErrors ?? [],
            errorSnippets: st.diagnosticsErrorSnippets ?? [],
            errorAgeMs: now - errorSince,
            editedRanges: ranges.map(r => ({ startLine: r.startLine + 1, endLine: r.endLine + 1 })),
            editChars,
            beforeAfter
        };
        await this.enqueue(folder, {
            id: nanoid(16),
            triggerType: 'diagnostics.fixed',
            createdAt: now,
            suggestedType: 'tutorial',
            suggestedTitle: `Fixed errors in ${basename(rel)}`,
            suggestedSummary: 'Diagnostics errors were present for a while and then dropped to zero after edits. Consider capturing what fixed the issue.',
            suggestedAnchors: anchors,
            evidence
        });
        st.diagnosticsErrorSince = undefined;
        st.diagnosticsEditRanges = [];
        st.diagnosticsEditChars = 0;
        st.diagnosticsErrorSnippets = undefined;
        st.diagnosticsTextAtErrorStart = undefined;
        st.diagnosticsTextAtErrorStartTruncated = undefined;
    }

    private scheduleDiagnosticsFixed(uri: vscode.Uri, st: DocumentEditState): void {
        if (st.diagnosticsFixedTimer) {
            clearTimeout(st.diagnosticsFixedTimer);
        }
        const attempts = st.diagnosticsFixedAttempts ?? 0;
        st.diagnosticsFixedAttempts = attempts;
        const run = async () => {
            const now = Date.now();
            const key = uri.toString(true);
            const current = this.docState.get(key) ?? st;
            const diags = vscode.languages.getDiagnostics(uri);
            const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
            if (errors.length > 0) {
                current.diagnosticsFixedTimer = undefined;
                current.diagnosticsFixedAttempts = 0;
                this.docState.set(key, current);
                return;
            }
            if (!this.activity.isIdle(now)) {
                const nextAttempts = (current.diagnosticsFixedAttempts ?? 0) + 1;
                current.diagnosticsFixedAttempts = nextAttempts;
                if (nextAttempts >= 8) {
                    current.diagnosticsFixedTimer = undefined;
                    this.docState.set(key, current);
                    return;
                }
                this.docState.set(key, current);
                this.scheduleDiagnosticsFixed(uri, current);
                return;
            }
            current.diagnosticsFixedTimer = undefined;
            this.docState.set(key, current);
            await this.maybeTriggerDiagnosticsFixed(uri, current);
        };
        st.diagnosticsFixedTimer = setTimeout(() => void run(), 1_200);
        this.docState.set(uri.toString(true), st);
    }

    private ensureBaselines(doc: vscode.TextDocument): void {
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'oct') {
            return;
        }
        const key = doc.uri.toString(true);
        const st: DocumentEditState = this.docState.get(key) ?? { lastEditAt: 0 };
        if (!st.lastSavedText) {
            const text = doc.getText();
            st.lastSavedText = truncateText(text, 120_000).content;
            const todos = findTodoLines(st.lastSavedText, 50);
            st.lastSavedTodoCount = todos.length;
            st.lastSavedTodoLines = todos.slice(0, 20);
        }
        if (isTsJsLanguage(String(doc.languageId ?? '')) && !st.magicSavedKeys) {
            const occ = findMagicNumberOccurrences(doc);
            st.magicSavedKeys = new Set(occ.map(o => o.key));
        }
        this.docState.set(key, st);
    }

    private async maybeTrackRollback(_doc: vscode.TextDocument, _changes: readonly vscode.TextDocumentContentChangeEvent[], _st: DocumentEditState): Promise<void> {
        const doc = _doc;
        const changes = _changes;
        const st = _st;
        const now = Date.now();

        st.rollback ??= {};
        const rb = st.rollback;
        if (rb.cooldownUntil && now < rb.cooldownUntil) {
            return;
        }

        const removedChars = changes.reduce((sum, c) => sum + (c.rangeLength ?? 0), 0);
        const insertedChars = changes.reduce((sum, c) => sum + String(c.text ?? '').length, 0);
        const deletedLines = Math.max(0, ...changes.map(c => c.range.end.line - c.range.start.line));
        const bigDelete = shouldTriggerCapture({
            triggerType: 'rollback.detected',
            netDeletedChars: removedChars - insertedChars,
            deletedLines,
            restoredOriginalHash: true,
            intermediateHashChanged: true,
            rollbackAgeMs: 0
        });
        const deleteRange = mergeChangeRanges(undefined, changes);

        const afterText = truncateText(doc.getText(), 120_000);
        const beforeText = rb.prevTextSnapshot ?? rb.lastTextSnapshot;
        const beforeTruncated = rb.prevTextSnapshot ? !!rb.prevTextSnapshotTruncated : !!rb.lastTextSnapshotTruncated;
        const diff = (beforeText && !beforeTruncated && !afterText.truncated)
            ? computeChangedRangeLines(beforeText, afterText.content)
            : undefined;

        if (bigDelete && rb.lastHash) {
            rb.deletionCandidate = {
                oldHash: rb.lastHash,
                at: now,
                range: deleteRange,
                removedChars,
                insertedChars,
                beforeText,
                beforeTextTruncated: beforeTruncated,
                afterText: afterText.content,
                afterTextTruncated: afterText.truncated,
                beforeAfter: (beforeText && diff)
                    ? {
                        startLine: diff.startLine + 1,
                        endLine: diff.endLine + 1,
                        before: sliceLines(beforeText, diff.startLine, diff.endLine, 6000),
                        after: sliceLines(afterText.content, diff.startLine, diff.endLine, 6000)
                    }
                    : undefined
            };
        }

        rb.prevTextSnapshot = afterText.content;
        rb.prevTextSnapshotTruncated = afterText.truncated;

        rb.lastLength = doc.getText().length;
        if (rb.pendingHashTimer) {
            clearTimeout(rb.pendingHashTimer);
        }
        if (doc.getText().length > 250_000) {
            return;
        }

        rb.pendingHashTimer = setTimeout(async () => {
            rb.pendingHashTimer = undefined;
            let newHash: string;
            try {
                const currentText = doc.getText();
                const snap = truncateText(currentText, 120_000);
                rb.lastTextSnapshot = snap.content;
                rb.lastTextSnapshotTruncated = snap.truncated;
                newHash = await sha256Hex(currentText);
            } catch {
                return;
            }
            const prevHash = rb.lastHash;
            rb.lastHash = newHash;
            st.rollback = rb;
            this.docState.set(doc.uri.toString(true), st);

            const cand = rb.deletionCandidate;
            if (!cand) {
                return;
            }
            const rollbackAgeMs = Date.now() - cand.at;
            if (rollbackAgeMs > 5 * 60_000) {
                rb.deletionCandidate = undefined;
                return;
            }
            const shouldTriggerRollback = shouldTriggerCapture({
                triggerType: 'rollback.detected',
                netDeletedChars: (cand.removedChars ?? 0) - (cand.insertedChars ?? 0),
                deletedLines: cand.range ? cand.range.end.line - cand.range.start.line : 0,
                restoredOriginalHash: newHash === cand.oldHash,
                intermediateHashChanged: !!prevHash && prevHash !== cand.oldHash,
                rollbackAgeMs
            });
            if (shouldTriggerRollback && newHash === cand.oldHash && prevHash && prevHash !== cand.oldHash) {
                const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
                if (!folder) {
                    return;
                }
                const rel = safeWorkspaceRelativePath(doc.uri);
                if (!rel) {
                    return;
                }
                const range = cand.range ?? st.lastEditRange;
                const snapshot = range ? doc.getText(range) : truncateText(doc.getText(), 2000).content;
                const anchor = basicAnchor({
                    anchorId: nanoid(16) + '-a',
                    folder,
                    rel,
                    associationLevel: range ? 'block' : 'file',
                    range,
                    snapshot
                });
                const evidence: SuggestionEvidence = {
                    file: normalizeWorkspaceRelativePath(rel),
                    deletedAt: cand.at,
                    restoredAt: Date.now(),
                    deletion: {
                        removedChars: cand.removedChars,
                        insertedChars: cand.insertedChars
                    },
                    beforeAfter: cand.beforeAfter,
                    snapshots: {
                        beforeDelete: typeof cand.beforeText === 'string' ? cand.beforeText.slice(0, 8000) : undefined,
                        afterDelete: typeof cand.afterText === 'string' ? cand.afterText.slice(0, 8000) : undefined,
                        beforeDeleteTruncated: !!cand.beforeTextTruncated,
                        afterDeleteTruncated: !!cand.afterTextTruncated
                    }
                };
                rb.cooldownUntil = Date.now() + 5 * 60_000;
                rb.deletionCandidate = undefined;
                await this.enqueue(folder, {
                    id: nanoid(16),
                    triggerType: 'rollback.detected',
                    createdAt: Date.now(),
                    suggestedType: 'risk',
                    suggestedTitle: `Rollback detected in ${basename(rel)}`,
                    suggestedSummary: 'A large deletion was reverted shortly afterwards. Consider capturing what happened and why the rollback was needed.',
                    suggestedAnchors: [anchor],
                    evidence
                });
            }
        }, 500);
    }

    private async createDraftCardFromSuggestion(
        folder: vscode.WorkspaceFolder,
        suggestion: CaptureSuggestion,
        edited: {
            type: KnowledgeCardType;
            title: string;
            tags: string[];
            summary: string;
            content: string;
            associationLevel: KnowledgeAssociationLevel;
            anchorOverride?: { workspaceRelativePath: string; rangeAtCapture?: KnowledgeAnchor['rangeAtCapture']; snapshot: KnowledgeAnchor['snapshot'] };
        } | undefined
    ): Promise<KnowledgeCard | undefined> {
        const now = Date.now();
        const rawAnchors = suggestion.suggestedAnchors ?? [];
        if (!rawAnchors.length) {
            return undefined;
        }
        const anchors = await rebuildAnchors(folder, suggestion, edited?.associationLevel, edited?.anchorOverride);
        if (!anchors.length) {
            return undefined;
        }
        const relatedChatMessageIds = extractChatMessageIdsFromEvidence(suggestion.evidence);
        return {
            schemaVersion: LatestSchemaVersion,
            id: suggestion.id,
            type: edited?.type ?? suggestion.suggestedType ?? 'context',
            title: edited?.title ?? suggestion.suggestedTitle ?? `[${suggestion.triggerType}]`,
            summary: edited?.summary ?? suggestion.suggestedSummary ?? '',
            content: edited?.content ?? defaultContentFromSuggestion(suggestion),
            source: 'event',
            status: 'draft',
            tags: edited?.tags ?? [],
            confidence: suggestion.confidence,
            createdAt: now,
            updatedAt: now,
            metadata: relatedChatMessageIds.length ? { relatedChatMessageIds } : {},
            anchors,
            evolution: [{ at: now, action: 'created' }]
        };
    }

    private async saveKnowledgeCard(folder: vscode.WorkspaceFolder, card: KnowledgeCard): Promise<vscode.Uri | undefined> {
        try {
            const dir = await this.store.ensureCardsDirectory(folder);
            const uri = vscode.Uri.joinPath(dir, `card-${card.id}.json`);
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(card, undefined, 2)));
            return uri;
        } catch {
            return undefined;
        }
    }
}

async function readSuggestionFromUri(uri: vscode.Uri): Promise<CaptureSuggestion | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (!isCaptureSuggestion(value)) {
            return undefined;
        }
        return value;
    } catch {
        return undefined;
    }
}

async function buildEditorInit(folder: vscode.WorkspaceFolder, s: CaptureSuggestion): Promise<{
    folder: vscode.WorkspaceFolder;
    currentAnchor?: { uri: vscode.Uri; range: vscode.Range };
    fileInfo: string;
    code: string;
    codeHelp?: string;
    defaultAssociationLevel: KnowledgeAssociationLevel;
    hasSymbol: boolean;
    symbolLabel: string;
    defaultTitle: string;
    defaultType: KnowledgeCardType;
    defaultTags?: string;
    defaultSummary?: string;
    defaultContent?: string;
}> {
    const anchor = s.suggestedAnchors?.[0];
    const file = normalizeWorkspaceRelativePath(anchor?.file?.workspaceRelativePath ?? '');
    const range = anchor?.rangeAtCapture;
    const fileInfo = range
        ? `${file} (lines ${range.start.line + 1}-${range.end.line + 1})`
        : (file || 'Capture suggestion');

    const base = {
        folder,
        currentAnchor: undefined as { uri: vscode.Uri; range: vscode.Range } | undefined,
        fileInfo,
        code: anchor?.snapshot?.text ?? '',
        codeHelp: '',
        defaultAssociationLevel: anchor?.associationLevel ?? 'block',
        hasSymbol: false,
        symbolLabel: '函数/类（未识别）',
        defaultTitle: s.suggestedTitle ?? `[${s.triggerType}]`,
        defaultType: s.suggestedType ?? 'context',
        defaultTags: '',
        defaultSummary: s.suggestedSummary ?? '',
        defaultContent: defaultContentFromSuggestion(s)
    };

    if (!file || !range) {
        return base;
    }

    const uri = vscode.Uri.joinPath(folder.uri, ...file.split('/').filter(Boolean));
    const selection = new vscode.Range(
        new vscode.Position(range.start.line, range.start.character),
        new vscode.Position(range.end.line, range.end.character)
    );

    const symbol = await inferSmallestContainingSymbolForRange(folder, uri, selection);
    let doc: vscode.TextDocument | undefined;
    try {
        doc = await vscode.workspace.openTextDocument(uri);
    } catch {
        doc = undefined;
    }

    const defaultAssociationLevel = doc
        ? inferDefaultAssociationLevel(doc, selection, symbol)
        : (symbol ? 'symbol' : 'block');

    return {
        ...base,
        currentAnchor: { uri, range: selection },
        defaultAssociationLevel,
        hasSymbol: !!symbol,
        symbolLabel: symbol ? `函数/类（自动识别到：${symbol.label}）` : '函数/类（未识别）'
    };
}

function defaultContentFromSuggestion(s: CaptureSuggestion): string {
    const lines: string[] = [];
    lines.push(`# ${s.suggestedTitle ?? `[${s.triggerType}]`}`);
    if (s.suggestedSummary) {
        lines.push('');
        lines.push(s.suggestedSummary);
    }
    lines.push('');
    lines.push('## Notes');
    lines.push('- What happened?');
    lines.push('- Why does it matter?');
    lines.push('- What should future-you do?');
    lines.push('');
    lines.push('## Evidence');
    lines.push('```json');
    lines.push(safeJsonStringify(s.evidence, 4000));
    lines.push('```');
    return lines.join('\n');
}

function safeJsonStringify(value: unknown, maxChars: number): string {
    let text = '';
    try {
        text = JSON.stringify(value, undefined, 2);
    } catch {
        text = '{}';
    }
    if (text.length <= maxChars) {
        return text;
    }
    return text.slice(0, maxChars) + '\n...';
}

function buildLLMTaskHints(triggerType: string): string {
    switch (triggerType) {
        case 'diagnostics.fixed':
            return 'Use diagnostics messages and editedRanges/beforeAfter/anchorSnapshots to explain the concrete error cause and what edit fixed it. Make the summary specific (mention the actual offending token/message).';
        case 'chat.dense':
            return 'Summarize the discussion topics and outcomes. Capture concrete decisions/constraints/risks/negative lessons. Use chatContextItems to ground claims in code context.';
        case 'todo.cleared':
            return 'Use the TODO texts and diff.before/diff.after to describe what was done and why it resolves the TODO. Be specific about file/lines and the change.';
        case 'magicNumber.added':
            return 'Explain what the magic number represents based on usage snippets. If not inferable, list unknowns and propose refactoring into named constants or config.';
        case 'packageJson.dependencySwitch':
            return 'Explain what dependencies changed and where they are used (dependencyUsages). Describe rationale and implications.';
        case 'rollback.detected':
            return 'Explain what was rolled back/restored and what the affected code does (use anchor snapshot). Capture the likely reason if evidence indicates it.';
        default:
            return 'Draft a grounded knowledge card based on evidence. Be specific and cite evidence paths.';
    }
}

function buildLLMMustMention(triggerType: string, evidence: SuggestionEvidence): string[] {
    const ev: any = evidence ?? {};
    switch (triggerType) {
        case 'diagnostics.fixed': {
            const msgs: string[] = Array.isArray(ev?.lastErrors)
                ? ev.lastErrors.map((e: any) => String(e?.message ?? '').trim()).filter((s: string) => Boolean(s))
                : [];
            return msgs.slice(0, 3);
        }
        case 'todo.cleared': {
            const todos = Array.isArray(ev?.todo?.before) ? ev.todo.before : [];
            const lines: string[] = todos.map((t: any) => String(t?.text ?? '').trim()).filter((s: string) => Boolean(s));
            return lines.slice(0, 3);
        }
        case 'magicNumber.added': {
            const added = Array.isArray(ev?.added) ? ev.added : [];
            const nums: string[] = [...new Set<string>(added.map((a: any) => String(a?.number ?? '').trim()).filter((s: string) => Boolean(s)))];
            return nums.slice(0, 6);
        }
        case 'packageJson.dependencySwitch': {
            const added: string[] = Array.isArray(ev?.added) ? ev.added.map((d: any) => String(d ?? '').trim()).filter((s: string) => Boolean(s)) : [];
            const removed: string[] = Array.isArray(ev?.removed) ? ev.removed.map((d: any) => String(d ?? '').trim()).filter((s: string) => Boolean(s)) : [];
            const deps: string[] = [...new Set<string>([...added, ...removed])];
            return deps.slice(0, 8);
        }
        case 'chat.dense':
        case 'rollback.detected': {
            const file = typeof ev?.file === 'string' ? ev.file.trim() : '';
            return file ? [file] : [];
        }
        default:
            return [];
    }
}

function findTodoLines(text: string, max: number): Array<{ line: number; col: number; token: string; text: string }> {
    const out: Array<{ line: number; col: number; token: string; text: string }> = [];
    const lines = String(text ?? '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/\b(TODO|FIXME|HACK)\b/);
        if (m && typeof m.index === 'number') {
            out.push({ line: i, col: m.index, token: m[1], text: line.trim() });
            if (out.length >= max) {
                break;
            }
        }
    }
    return out;
}

function sliceLines(text: string, startLine: number, endLine: number, maxChars: number): string {
    const lines = String(text ?? '').split(/\r?\n/);
    const start = Math.max(0, Math.min(startLine, lines.length - 1));
    const end = Math.max(start, Math.min(endLine, lines.length - 1));
    let out = lines.slice(start, end + 1).join('\n');
    if (out.length > maxChars) {
        out = out.slice(0, maxChars) + '\n...';
    }
    return out;
}

function extractSurroundingLines(doc: vscode.TextDocument, line: number, radius: number): string {
    const start = clampLine(doc, line - radius);
    const end = clampLine(doc, line + radius);
    const lines: string[] = [];
    for (let i = start; i <= end; i++) {
        const text = safeLineText(doc, i);
        lines.push(`${i + 1}: ${text}`);
    }
    return lines.join('\n');
}

function findNumberOccurrences(text: string, numberText: string, maxHits: number): Array<{ line: number; text: string; context: string }> {
    const out: Array<{ line: number; text: string; context: string }> = [];
    const lines = String(text ?? '').split(/\r?\n/);
    const re = new RegExp(`\\b${escapeRegExp(numberText)}\\b`);
    for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) {
            continue;
        }
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        out.push({
            line: i,
            text: lines[i].trim(),
            context: lines.slice(contextStart, contextEnd + 1).map((l, idx) => `${contextStart + idx + 1}: ${l}`).join('\n')
        });
        if (out.length >= maxHits) {
            break;
        }
    }
    return out;
}

function escapeRegExp(text: string): string {
    return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findDependencyUsages(
    folder: vscode.WorkspaceFolder,
    dependency: string,
    maxHits: number
): Promise<Array<{ file: string; line: number; preview: string }>> {
    const out: Array<{ file: string; line: number; preview: string }> = [];
    const dep = String(dependency ?? '').trim();
    if (!dep) {
        return out;
    }

    const include = new vscode.RelativePattern(folder, '**/*.{ts,tsx,js,jsx,mjs,cjs}');
    const exclude = new vscode.RelativePattern(folder, '**/{node_modules,.git,.CoVSCode,dist,lib,out,bundle}/**');
    const pattern = new RegExp(
        `(?:from\\s+['"]${escapeRegExp(dep)}['"]|require\\(\\s*['"]${escapeRegExp(dep)}['"]\\s*\\)|import\\(\\s*['"]${escapeRegExp(dep)}['"]\\s*\\))`,
        'i'
    );

    // NOTE: Some VS Code API typings do not include `workspace.findTextInFiles`.
    // Implement a small best-effort search via findFiles + readFile.
    const uris = await vscode.workspace.findFiles(include, exclude, 160);
    for (const uri of uris) {
        if (out.length >= maxHits) {
            break;
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            // Skip very large files.
            if (bytes.byteLength > 450_000) {
                continue;
            }
            const text = new TextDecoder().decode(bytes);
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const lineText = lines[i];
                if (!pattern.test(lineText)) {
                    continue;
                }
                const rel = safeWorkspaceRelativePath(uri) ?? vscode.workspace.asRelativePath(uri, false);
                out.push({ file: normalizeWorkspaceRelativePath(String(rel ?? '')), line: i + 1, preview: lineText.trim().slice(0, 220) });
                if (out.length >= maxHits) {
                    break;
                }
            }
        } catch {
            // ignore
        }
    }

    return out.slice(0, maxHits);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeoutMs = Math.max(1, Math.floor(ms));
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        promise.then(
            v => {
                clearTimeout(timer);
                resolve(v);
            },
            e => {
                clearTimeout(timer);
                reject(e);
            }
        );
    });
}

function formatAIDraftHelp(draft: any): string {
    const citations = Array.isArray(draft?.evidenceCitations) ? draft.evidenceCitations.filter((c: any) => typeof c === 'string' && c.trim()) : [];
    const unknowns = Array.isArray(draft?.unknowns) ? draft.unknowns.filter((u: any) => typeof u === 'string' && u.trim()) : [];
    const lines: string[] = [];
    if (typeof draft?.confidence === 'number') {
        const c = Math.max(0, Math.min(1, draft.confidence));
        lines.push(`AI confidence: ${c.toFixed(2)}`);
    }
    if (citations.length) {
        lines.push(`Evidence citations: ${citations.slice(0, 6).join(', ')}`);
    }
    if (unknowns.length) {
        lines.push(`Unknowns: ${unknowns.slice(0, 4).join(' • ')}`);
    }
    return lines.join('\n');
}

async function rebuildAnchors(
    folder: vscode.WorkspaceFolder,
    s: CaptureSuggestion,
    associationOverride: KnowledgeAssociationLevel | undefined,
    anchorOverride: { workspaceRelativePath: string; rangeAtCapture?: KnowledgeAnchor['rangeAtCapture']; snapshot: KnowledgeAnchor['snapshot'] } | undefined
): Promise<KnowledgeAnchor[]> {
    const out: KnowledgeAnchor[] = [];
    const raw = s.suggestedAnchors ?? [];
    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        const first = i === 0;
        const rel = normalizeWorkspaceRelativePath((first && anchorOverride?.workspaceRelativePath) ? anchorOverride.workspaceRelativePath : (a.file?.workspaceRelativePath ?? ''));
        if (!rel) {
            continue;
        }

        const baseRangeAtCapture = (first && anchorOverride?.rangeAtCapture !== undefined) ? anchorOverride.rangeAtCapture : a.rangeAtCapture;
        const baseSnapshot = (first && anchorOverride?.snapshot) ? anchorOverride.snapshot : a.snapshot;
        const text = String(baseSnapshot?.text ?? '');

        let associationLevel: KnowledgeAssociationLevel;
        let symbol: SymbolCandidate | undefined;
        if (associationOverride) {
            associationLevel = associationOverride;
        } else {
            if (a.associationLevel === 'file' || !baseRangeAtCapture) {
                associationLevel = a.associationLevel === 'file' ? 'file' : 'block';
            } else {
                symbol = await inferSymbolForRelRange(folder, rel, baseRangeAtCapture);
                associationLevel = symbol ? 'symbol' : (a.associationLevel ?? 'block');
            }
        }

        if (associationLevel === 'symbol' && !symbol && baseRangeAtCapture) {
            symbol = await inferSymbolForRelRange(folder, rel, baseRangeAtCapture);
        }

        const rangeAtCapture = associationLevel === 'file' ? undefined : baseRangeAtCapture;
        const anchor: KnowledgeAnchor = {
            anchorId: `${s.id}-a${i + 1}`,
            file: { workspaceFolderName: folder.name, workspaceRelativePath: rel },
            associationLevel,
            rangeAtCapture,
            semantic: associationLevel === 'symbol' ? symbol?.semantic : undefined,
            snapshot: {
                text,
                truncated: baseSnapshot?.truncated,
                sha256: await safeSha256(text)
            }
        };
        const fp = await tryBuildFingerprint(folder, rel, rangeAtCapture, text);
        if (fp) {
            anchor.fingerprint = fp;
        }
        out.push(anchor);
    }
    return out;
}

async function inferSymbolForRelRange(
    folder: vscode.WorkspaceFolder,
    workspaceRelativePath: string,
    rangeAtCapture: NonNullable<KnowledgeAnchor['rangeAtCapture']>
): Promise<SymbolCandidate | undefined> {
    try {
        const segs = workspaceRelativePath.split('/').filter(Boolean);
        const uri = vscode.Uri.joinPath(folder.uri, ...segs);
        const selection = new vscode.Range(
            new vscode.Position(rangeAtCapture.start.line, rangeAtCapture.start.character),
            new vscode.Position(rangeAtCapture.end.line, rangeAtCapture.end.character)
        );
        return await inferSmallestContainingSymbolForRange(folder, uri, selection);
    } catch {
        return undefined;
    }
}

async function safeSha256(text: string): Promise<string | undefined> {
    try {
        return await sha256Hex(text);
    } catch {
        return undefined;
    }
}

function extractChatMessageIdsFromEvidence(evidence: SuggestionEvidence): string[] {
    const raw = (evidence as any)?.chatMessages;
    if (!Array.isArray(raw)) {
        return [];
    }
    const ids = raw.map(m => (m as any)?.id).filter((id: any) => typeof id === 'string' && id);
    return [...new Set(ids)].slice(0, 50);
}

async function tryBuildFingerprint(
    folder: vscode.WorkspaceFolder,
    workspaceRelativePath: string,
    rangeAtCapture: KnowledgeAnchor['rangeAtCapture'] | undefined,
    snapshotText: string
): Promise<KnowledgeAnchor['fingerprint'] | undefined> {
    try {
        const segs = workspaceRelativePath.split('/').filter(Boolean);
        const uri = vscode.Uri.joinPath(folder.uri, ...segs);
        const doc = await vscode.workspace.openTextDocument(uri);
        const docText = doc.getText();

        let startOffset = 0;
        let endOffset = 0;
        if (rangeAtCapture) {
            const range = new vscode.Range(
                new vscode.Position(rangeAtCapture.start.line, rangeAtCapture.start.character),
                new vscode.Position(rangeAtCapture.end.line, rangeAtCapture.end.character)
            );
            startOffset = doc.offsetAt(range.start);
            endOffset = doc.offsetAt(range.end);
        }
        const ctxN = 300;
        const prefix = docText.slice(Math.max(0, startOffset - ctxN), startOffset);
        const suffix = docText.slice(endOffset, Math.min(docText.length, endOffset + ctxN));
        const landmarkLines = extractLandmarkLines(snapshotText, 5);
        return { prefix, suffix, landmarkLines };
    } catch {
        return undefined;
    }
}

function extractLandmarkLines(text: string, max: number): string[] {
    const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out: string[] = [];
    for (const l of lines) {
        if (out.length >= max) {
            break;
        }
        out.push(l.length > 200 ? l.slice(0, 200) : l);
    }
    return out;
}

function mergeChangeRanges(existing: vscode.Range | undefined, changes: readonly vscode.TextDocumentContentChangeEvent[]): vscode.Range | undefined {
    let merged = existing;
    for (const ch of changes) {
        merged = merged ? merged.union(ch.range) : ch.range;
    }
    return merged;
}

function resolveFolderForSuggestion(anchor: KnowledgeAnchor | undefined): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
        return undefined;
    }
    const name = anchor?.file?.workspaceFolderName;
    if (name) {
        const match = folders.find(f => f.name === name);
        if (match) {
            return match;
        }
    }
    return folders[0];
}

function pickAnchorFromChatMessages(messages: ChatMessageJson[]): KnowledgeAnchor[] | undefined {
    const items: ChatContextItemJson[] = [];
    for (const m of messages.slice(-20)) {
        for (const c of (m.context ?? [])) {
            if (c && c.workspaceRelativePath) {
                items.push(c);
            }
        }
    }
    if (!items.length) {
        return undefined;
    }
    const selection = items.find(i => i.kind === 'selection' && i.range);
    const picked = selection ?? items.find(i => i.kind === 'file') ?? items[0];
    return [{
        anchorId: nanoid(16) + '-a',
        file: { workspaceFolderName: picked.workspaceFolderName, workspaceRelativePath: normalizeWorkspaceRelativePath(picked.workspaceRelativePath) },
        associationLevel: picked.kind === 'file' ? 'file' : 'block',
        rangeAtCapture: picked.range ? { start: picked.range.start, end: picked.range.end } : undefined,
        snapshot: { text: picked.content, truncated: picked.truncated }
    }];
}

function isTsJsLanguage(lang: string): boolean {
    return lang === 'typescript' || lang === 'typescriptreact' || lang === 'javascript' || lang === 'javascriptreact';
}

function safeWorkspaceRelativePath(uri: vscode.Uri): string | undefined {
    try {
        if (uri.scheme === 'oct') {
            const parts = uri.path.split('/').filter(Boolean);
            if (parts.length >= 3) {
                return normalizeWorkspaceRelativePath(parts.slice(2).join('/')) || undefined;
            }
            return undefined;
        }
        if (!vscode.workspace.getWorkspaceFolder(uri)) {
            return undefined;
        }
        const rel = vscode.workspace.asRelativePath(uri, false);
        const normalized = normalizeWorkspaceRelativePath(String(rel));
        return normalized || undefined;
    } catch {
        return undefined;
    }
}

function globToRegExp(pattern: string): RegExp {
    const raw = String(pattern ?? '').trim().replace(/\\/g, '/');
    if (!raw) {
        return /^$/;
    }

    let i = 0;
    let out = '^';

    // Special-case leading **/ to also match root-level files.
    if (raw.startsWith('**/')) {
        out += '(?:.*/)?';
        i = 3;
    }

    while (i < raw.length) {
        const ch = raw[i];
        if (ch === '*') {
            const next = raw[i + 1];
            if (next === '*') {
                out += '.*';
                i += 2;
                continue;
            }
            out += '[^/]*';
            i += 1;
            continue;
        }
        if (ch === '?') {
            out += '[^/]';
            i += 1;
            continue;
        }
        if (ch === '/') {
            out += '/';
            i += 1;
            continue;
        }
        if ('\\.[]{}()+-^$|'.includes(ch)) {
            out += '\\' + ch;
            i += 1;
            continue;
        }
        out += ch;
        i += 1;
    }

    out += '$';
    return new RegExp(out, 'i');
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
    const max = Math.max(1, Math.min(500, Math.floor(maxChars)));
    const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (raw.length <= max) {
        return raw;
    }
    return raw.slice(0, Math.max(0, max - 1)) + '…';
}

function formatTimestampForDisplay(timestamp: number): string {
    const date = new Date(typeof timestamp === 'number' ? timestamp : Date.now());
    return date.toLocaleString();
}

function sanitizeChatMessagesForEvidence(messages: readonly ChatMessageJson[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const limited = messages.length > 20 ? messages.slice(-20) : Array.from(messages);
    for (const m of limited) {
        const text = truncateText(String((m as any)?.text ?? ''), 2000);
        const context = Array.isArray((m as any)?.context)
            ? ((m as any).context as any[]).slice(0, 3).map(c => {
                const content = truncateText(String(c?.content ?? ''), 4000);
                return {
                    id: typeof c?.id === 'string' ? c.id : undefined,
                    kind: c?.kind,
                    path: typeof c?.path === 'string' ? c.path : undefined,
                    workspaceFolderName: typeof c?.workspaceFolderName === 'string' ? c.workspaceFolderName : undefined,
                    workspaceRelativePath: typeof c?.workspaceRelativePath === 'string' ? c.workspaceRelativePath : undefined,
                    languageId: typeof c?.languageId === 'string' ? c.languageId : undefined,
                    range: c?.range,
                    content: content.content,
                    truncated: Boolean(c?.truncated) || content.truncated || undefined,
                    createdAt: typeof c?.createdAt === 'number' ? c.createdAt : undefined
                };
            })
            : undefined;

        const selectedTextRaw = (m as any)?.editorState?.selectedText;
        const selectedText = truncateText(typeof selectedTextRaw === 'string' ? selectedTextRaw : '', 4000);

        const editorState = (m as any)?.editorState && typeof (m as any).editorState === 'object'
            ? {
                activePath: (m as any).editorState?.activePath,
                cursor: (m as any).editorState?.cursor,
                selections: (m as any).editorState?.selections,
                selectedText: selectedText.content || undefined,
                selectedTextTruncated: Boolean((m as any).editorState?.selectedTextTruncated) || selectedText.truncated || undefined
            }
            : undefined;

        out.push({
            id: typeof (m as any)?.id === 'string' ? (m as any).id : undefined,
            userName: typeof (m as any)?.userName === 'string' ? (m as any).userName : undefined,
            text: text.content,
            timestamp: typeof (m as any)?.timestamp === 'number' ? (m as any).timestamp : undefined,
            context: context?.length ? context : undefined,
            editorState
        });
    }
    return out;
}

function basename(rel: string): string {
    const norm = String(rel ?? '').replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : norm;
}

function basicAnchor(args: {
    anchorId: string;
    folder: vscode.WorkspaceFolder;
    rel: string;
    associationLevel: KnowledgeAssociationLevel;
    range: vscode.Range | undefined;
    snapshot: string;
    truncated?: boolean;
}): KnowledgeAnchor {
    const rangeAtCapture = args.range
        ? { start: { line: args.range.start.line, character: args.range.start.character }, end: { line: args.range.end.line, character: args.range.end.character } }
        : undefined;
    return {
        anchorId: args.anchorId,
        file: { workspaceFolderName: args.folder.name, workspaceRelativePath: normalizeWorkspaceRelativePath(args.rel) },
        associationLevel: args.associationLevel,
        rangeAtCapture,
        snapshot: { text: args.snapshot, truncated: args.truncated }
    };
}

function safeLineText(doc: vscode.TextDocument, line: number): string {
    try {
        return doc.lineAt(line).text;
    } catch {
        return '';
    }
}

function hasInlineCommentBeforeNumber(lineText: string, column: number): boolean {
    const prefix = lineText.slice(0, Math.max(0, Math.min(column, lineText.length)));
    if (prefix.includes('//')) {
        return true;
    }
    return prefix.includes('/*');
}

function hasCommentToken(text: string): boolean {
    const t = String(text ?? '');
    return t.includes('//') || t.includes('/*');
}

function findMagicNumberOccurrences(doc: vscode.TextDocument): Array<{ key: string; line: number; number: string; lineText: string }> {
    const out: Array<{ key: string; line: number; number: string; lineText: string }> = [];
    for (let line = 0; line < doc.lineCount; line++) {
        const prevLineText = line > 0 ? safeLineText(doc, line - 1) : '';
        if (hasCommentToken(prevLineText)) {
            continue;
        }
        const lineText = safeLineText(doc, line);
        const matches = [...lineText.matchAll(/\b\d{3,}\b/g)];
        for (const m of matches) {
            const n = m[0];
            if (n === '0' || n === '1' || n === '2') {
                continue;
            }
            const startCol = m.index ?? -1;
            if (startCol < 0) {
                continue;
            }
            const endCol = startCol + n.length;
            // Skip if number is inside a comment or has trailing comment.
            if (hasInlineCommentBeforeNumber(lineText, startCol)) {
                continue;
            }
            if (hasCommentToken(lineText.slice(endCol))) {
                continue;
            }
            out.push({ key: `${line}:${startCol}:${n}`, line, number: n, lineText });
            if (out.length >= 100) {
                return out;
            }
        }
    }
    return out;
}

function pickBestTodoRange(
    doc: vscode.TextDocument,
    prevLocations: Array<{ line: number; col: number }>,
    lastEditRange: vscode.Range | undefined
): vscode.Range | undefined {
    if (!prevLocations.length) {
        return lastEditRange;
    }
    const targetLine = lastEditRange?.start.line ?? prevLocations[0].line;
    let best = prevLocations[0];
    let bestDist = Math.abs(best.line - targetLine);
    for (const loc of prevLocations) {
        const dist = Math.abs(loc.line - targetLine);
        if (dist < bestDist) {
            best = loc;
            bestDist = dist;
        }
    }
    if (best.line < 0 || best.line >= doc.lineCount) {
        return lastEditRange;
    }
    return new vscode.Range(new vscode.Position(best.line, 0), doc.lineAt(best.line).range.end);
}

function computeChangedRangeLines(prevText: string, nextText: string): { startLine: number; endLine: number } | undefined {
    const a = String(prevText ?? '').split(/\r?\n/);
    const b = String(nextText ?? '').split(/\r?\n/);
    const minLen = Math.min(a.length, b.length);
    let start = 0;
    while (start < minLen && a[start] === b[start]) {
        start++;
    }
    if (start === a.length && start === b.length) {
        return undefined;
    }
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA--;
        endB--;
    }
    return { startLine: Math.max(0, start), endLine: Math.max(0, endB) };
}

function narrowRangeIfTooLarge(doc: vscode.TextDocument, range: vscode.Range | undefined, maxChars: number): vscode.Range | undefined {
    if (!range) {
        return undefined;
    }
    try {
        const text = doc.getText(range);
        if (text.length <= maxChars) {
            return range;
        }
        const line = range.start.line;
        if (line < 0 || line >= doc.lineCount) {
            return undefined;
        }
        return new vscode.Range(new vscode.Position(line, 0), doc.lineAt(line).range.end);
    } catch {
        return undefined;
    }
}

function estimateEditMagnitude(changes: readonly vscode.TextDocumentContentChangeEvent[]): number {
    let sum = 0;
    for (const ch of changes) {
        const inserted = String(ch.text ?? '').length;
        const removed = ch.rangeLength ?? 0;
        sum += Math.max(inserted, removed);
    }
    return sum;
}

function mergeLineRanges(ranges: Array<{ startLine: number; endLine: number }>): Array<{ startLine: number; endLine: number }> {
    const normalized = ranges
        .map(r => ({ startLine: Math.min(r.startLine, r.endLine), endLine: Math.max(r.startLine, r.endLine) }))
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    const out: Array<{ startLine: number; endLine: number }> = [];
    for (const r of normalized) {
        const last = out[out.length - 1];
        if (!last) {
            out.push({ ...r });
            continue;
        }
        if (r.startLine <= last.endLine + 1) {
            last.endLine = Math.max(last.endLine, r.endLine);
        } else {
            out.push({ ...r });
        }
    }
    return out;
}

function clampLine(doc: vscode.TextDocument, line: number): number {
    if (line < 0) {
        return 0;
    }
    if (line >= doc.lineCount) {
        return Math.max(0, doc.lineCount - 1);
    }
    return line;
}
