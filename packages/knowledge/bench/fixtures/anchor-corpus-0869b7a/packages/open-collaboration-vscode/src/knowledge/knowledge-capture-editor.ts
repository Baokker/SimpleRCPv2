import * as vscode from 'vscode';
import type { KnowledgeAnchor, KnowledgeAssociationLevel, KnowledgeCardType } from 'open-collaboration-knowledge';
import { getPinHtml } from './pin-webview.js';
import {
    inferDefaultAssociationLevel,
    inferSmallestContainingSymbolForRange,
    safeWorkspaceRelativePathInFolder
} from './anchor-inference.js';
import { cancelAnchorPick, startAnchorPickMode } from './anchor-pick-mode.js';

export interface CaptureEditorInit {
    folder: vscode.WorkspaceFolder;
    currentAnchor?: { uri: vscode.Uri; range: vscode.Range };
    fileInfo: string;
    code: string;
    codeHelp?: string;
    defaultAssociationLevel: KnowledgeAssociationLevel;
    hasSymbol?: boolean;
    symbolLabel?: string;
    defaultTitle: string;
    defaultType: KnowledgeCardType;
    defaultTags?: string;
    defaultSummary?: string;
    defaultContent?: string;
}

export interface CaptureEditorAnchorOverride {
    workspaceRelativePath: string;
    rangeAtCapture?: KnowledgeAnchor['rangeAtCapture'];
    snapshot: KnowledgeAnchor['snapshot'];
}

export interface CaptureEditorResult {
    type: KnowledgeCardType;
    title: string;
    tags: string[];
    summary: string;
    content: string;
    associationLevel: KnowledgeAssociationLevel;
    anchorOverride?: CaptureEditorAnchorOverride;
}

export async function openCaptureSuggestionEditor(init: CaptureEditorInit): Promise<CaptureEditorResult | undefined> {
    const panel = vscode.window.createWebviewPanel(
        'oct.knowledge.capture.edit',
        vscode.l10n.t('Review capture suggestion'),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true }
    );

    const webview = panel.webview;
    const nonce = getNonce();
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} https:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`
    ].join('; ');
    webview.html = getPinHtml(csp, nonce);

    let anchorState = {
        fileInfo: init.fileInfo,
        code: init.code,
        codeHelp: init.codeHelp ?? '',
        defaultAssociationLevel: init.defaultAssociationLevel,
        hasSymbol: init.hasSymbol ?? false,
        symbolLabel: init.symbolLabel ?? '函数/类（未识别）'
    };

    const makeInitPayload = () => ({
        type: 'init' as const,
        payload: {
            ...anchorState,
            defaultTitle: init.defaultTitle,
            defaultType: init.defaultType,
            defaultTags: init.defaultTags ?? '',
            defaultSummary: init.defaultSummary ?? '',
            defaultContent: init.defaultContent ?? '',
            enableAiRefine: false,
            aiBusy: false
        }
    });

    return await new Promise(resolve => {
        let anchorOverride: CaptureEditorAnchorOverride | undefined;

        const sub = webview.onDidReceiveMessage((message: any) => {
            if (!message) {
                return;
            }
            if (message.type === 'ready') {
                void webview.postMessage(makeInitPayload());
                return;
            }
            if (message.type === 'changeCode') {
                startAnchorPickMode({
                    folder: init.folder,
                    currentAnchor: init.currentAnchor,
                    onConfirm: async picked => {
                        const doc = await vscode.workspace.openTextDocument(picked.uri);
                        const selection = picked.selection;
                        const workspaceRelativePath = safeWorkspaceRelativePathInFolder(init.folder, doc.uri);
                        if (!workspaceRelativePath) {
                            throw new Error('Failed to compute workspace-relative path for this file.');
                        }
                        const rawSelectionText = doc.getText(selection);
                        const { content: selectionText, truncated } = truncateText(rawSelectionText, 50_000);
                        const symbol = await inferSmallestContainingSymbolForRange(init.folder, doc.uri, selection);
                        const defaultAssociationLevel = inferDefaultAssociationLevel(doc, selection, symbol);
                        const fileInfo = `${workspaceRelativePath} (lines ${selection.start.line + 1}-${selection.end.line + 1})`;
                        const codeHelp = truncated ? 'Selection was truncated to 50k characters.' : '';
                        const symbolLabel = symbol ? `函数/类（自动识别到：${symbol.label}）` : '函数/类（未识别）';

                        anchorOverride = {
                            workspaceRelativePath,
                            rangeAtCapture: {
                                start: { line: selection.start.line, character: selection.start.character },
                                end: { line: selection.end.line, character: selection.end.character }
                            },
                            snapshot: { text: selectionText, truncated: truncated || undefined }
                        };

                        anchorState = {
                            fileInfo,
                            code: selectionText,
                            codeHelp,
                            defaultAssociationLevel,
                            hasSymbol: !!symbol,
                            symbolLabel
                        };
                        void webview.postMessage({
                            type: 'anchorUpdate',
                            payload: {
                                fileInfo,
                                code: selectionText,
                                codeHelp,
                                defaultAssociationLevel,
                                hasSymbol: !!symbol,
                                symbolLabel
                            }
                        });
                    }
                });
                void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                return;
            }
            if (message.type === 'cancel') {
                panel.dispose();
                resolve(undefined);
                return;
            }
            if (message.type !== 'save') {
                return;
            }
            const type = message.payload?.type;
            const title = String(message.payload?.title ?? '').trim();
            const tagsRaw = String(message.payload?.tags ?? '');
            const summary = String(message.payload?.summary ?? '').trim();
            const content = String(message.payload?.content ?? '').trim();
            const associationLevel = message.payload?.associationLevel;

            if (type !== 'decision' && type !== 'constraint' && type !== 'risk' && type !== 'context' && type !== 'negative' && type !== 'tutorial') {
                vscode.window.showErrorMessage(vscode.l10n.t('Please choose a type.'));
                return;
            }
            if (!title) {
                vscode.window.showErrorMessage(vscode.l10n.t('Please enter a title.'));
                return;
            }
            if (!summary) {
                vscode.window.showErrorMessage(vscode.l10n.t('Please enter a summary.'));
                return;
            }
            if (!content) {
                vscode.window.showErrorMessage(vscode.l10n.t('Please enter content.'));
                return;
            }
            if (associationLevel !== 'block' && associationLevel !== 'symbol' && associationLevel !== 'file') {
                vscode.window.showErrorMessage(vscode.l10n.t('Invalid association level.'));
                return;
            }
            panel.dispose();
            resolve({
                type,
                title,
                tags: parseTags(tagsRaw),
                summary,
                content,
                associationLevel,
                anchorOverride
            });
        });
        panel.onDidDispose(() => {
            cancelAnchorPick();
            sub.dispose();
        });
    });
}

function parseTags(raw: string): string[] {
    return String(raw ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 24);
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

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 16; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
