// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as vscode from 'vscode';
import { injectable, postConstruct } from 'inversify';
import { WorkspaceKnowledgeCardsFolderName, WorkspaceKnowledgeFolderName, WorkspaceRootFolderName, buildKnowledgeGuideItems, buildKnowledgeTimelineItems, isKnowledgeCard, normalizeWorkspaceRelativePath } from 'open-collaboration-knowledge';
import type { KnowledgeCard } from 'open-collaboration-knowledge';
import { KnowledgeStore } from './knowledge-store.js';
import { safeWorkspaceRelativePathInFolder } from './anchor-inference.js';

export type KnowledgeCardsTreeNode = CardsMessageNode | CardsGroupNode | CardsCardNode;

export interface CardsMessageNode {
    kind: 'message';
    message: string;
}

export interface CardsGroupNode {
    kind: 'group';
    group: 'currentFile' | 'otherFiles';
    label: string;
    folder: vscode.WorkspaceFolder;
    cards: CardsCardNode[];
}

export interface CardsCardNode {
    kind: 'card';
    folder: vscode.WorkspaceFolder;
    uri: vscode.Uri;
    card: KnowledgeCard;
    isCurrentFile: boolean;
}

@injectable()
export class KnowledgeCardsView implements vscode.Disposable, vscode.TreeDataProvider<KnowledgeCardsTreeNode> {

    private readonly store = new KnowledgeStore();

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | KnowledgeCardsTreeNode>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private lastActiveCodeUri: vscode.Uri | undefined;
    private readonly toDispose: vscode.Disposable[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];

    @postConstruct()
    protected init(): void {
        this.toDispose.push(
            vscode.window.registerTreeDataProvider('oct.knowledgeCardsView', this),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.resetWatchers();
                this.refresh();
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                const uri = editor?.document?.uri;
                if (uri && (uri.scheme === 'file' || uri.scheme === 'oct')) {
                    this.lastActiveCodeUri = uri;
                    this.refresh();
                }
            })
        );

        const uri = vscode.window.activeTextEditor?.document?.uri;
        if (uri && (uri.scheme === 'file' || uri.scheme === 'oct')) {
            this.lastActiveCodeUri = uri;
        }

        this.resetWatchers();
    }

    dispose(): void {
        this.disposeWatchers();
        for (const d of this.toDispose) {
            d.dispose();
        }
        this.toDispose.length = 0;
        this.onDidChangeTreeDataEmitter.dispose();
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    async getGuideItems(): Promise<Array<CardsCardNode & { guideIndex: number }>> {
        const folder = this.resolveCurrentFolder();
        if (!folder) {
            return [];
        }
        const currentRel = normalizeWorkspaceRelativePath(this.resolveCurrentFileRel(folder) ?? '');
        const cards = await this.listCards(folder);
        return buildKnowledgeGuideItems(cards.map(item => item.card), currentRel).map((item, index) => {
            const matched = cards.find(candidate => candidate.card.id === item.card.id);
            return {
                kind: 'card' as const,
                folder,
                uri: matched?.uri ?? vscode.Uri.joinPath(folder.uri, ''),
                card: item.card,
                isCurrentFile: item.isCurrentFile,
                guideIndex: index + 1
            };
        }).filter(item => item.uri.path !== folder.uri.path);
    }

    async getTimelineItems(): Promise<Array<{
        folder: vscode.WorkspaceFolder;
        uri: vscode.Uri;
        card: KnowledgeCard;
        kind: 'created' | 'updated' | 'evolution';
        at: number;
        label: string;
    }>> {
        const folder = this.resolveCurrentFolder();
        if (!folder) {
            return [];
        }
        const currentRel = normalizeWorkspaceRelativePath(this.resolveCurrentFileRel(folder) ?? '');
        const cards = await this.listCards(folder);
        return buildKnowledgeTimelineItems(cards.map(item => item.card), currentRel).map(item => {
            const matched = cards.find(candidate => candidate.card.id === item.card.id);
            return {
                folder,
                uri: matched?.uri ?? vscode.Uri.joinPath(folder.uri, ''),
                card: item.card,
                kind: item.kind,
                at: item.at,
                label: item.label
            };
        }).filter(item => item.uri.path !== folder.uri.path);
    }

    async getChildren(element?: KnowledgeCardsTreeNode): Promise<KnowledgeCardsTreeNode[]> {
        const folder = this.resolveCurrentFolder();
        if (!folder) {
            return [{ kind: 'message', message: vscode.l10n.t('No workspace folder opened.') }];
        }

        if (!element) {
            const grouped = await this.listAndGroupCards(folder);
            if (!grouped.total) {
                return [{ kind: 'message', message: vscode.l10n.t('No knowledge cards found.') }];
            }
            const nodes: CardsGroupNode[] = [
                {
                    kind: 'group',
                    group: 'currentFile',
                    label: vscode.l10n.t('Current file'),
                    folder,
                    cards: grouped.currentFile
                },
                {
                    kind: 'group',
                    group: 'otherFiles',
                    label: vscode.l10n.t('Other files'),
                    folder,
                    cards: grouped.otherFiles
                }
            ];
            return nodes;
        }

        if (element.kind === 'group') {
            return element.cards;
        }
        return [];
    }

    getTreeItem(element: KnowledgeCardsTreeNode): vscode.TreeItem {
        if (element.kind === 'message') {
            const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'knowledgeCardsMessage';
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }

        if (element.kind === 'group') {
            const count = element.cards.length;
            const label = count ? `${element.label} (${count})` : element.label;
            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'knowledgeCardsGroup';
            item.iconPath = element.group === 'currentFile'
                ? new vscode.ThemeIcon('file')
                : new vscode.ThemeIcon('library');
            return item;
        }

        const item = new vscode.TreeItem(element.card.title, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'knowledgeCard';
        item.description = element.card.type;
        item.tooltip = formatCardTooltip(element.card);
        item.iconPath = element.isCurrentFile ? new vscode.ThemeIcon('target') : new vscode.ThemeIcon('note');
        item.command = {
            command: 'oct.knowledge.openCard',
            title: 'Open',
            arguments: [element]
        };
        return item;
    }

    private resolveCurrentFolder(): vscode.WorkspaceFolder | undefined {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (!folders.length) {
            return undefined;
        }
        if (this.lastActiveCodeUri) {
            return vscode.workspace.getWorkspaceFolder(this.lastActiveCodeUri) ?? folders[0];
        }
        return folders[0];
    }

    private resolveCurrentFileRel(folder: vscode.WorkspaceFolder): string | undefined {
        if (!this.lastActiveCodeUri) {
            return undefined;
        }
        return safeWorkspaceRelativePathInFolder(folder, this.lastActiveCodeUri);
    }

    private async listAndGroupCards(folder: vscode.WorkspaceFolder): Promise<{
        total: number;
        currentFile: CardsCardNode[];
        otherFiles: CardsCardNode[];
    }> {
        const currentRel = normalizeWorkspaceRelativePath(this.resolveCurrentFileRel(folder) ?? '');
        const cards = await this.listCards(folder);

        const currentFile: CardsCardNode[] = [];
        const otherFiles: CardsCardNode[] = [];

        for (const { uri, card } of cards) {
            const isCurrent = !!currentRel && (card.anchors ?? []).some(a => {
                const rel = normalizeWorkspaceRelativePath(a.file?.workspaceRelativePath ?? '');
                return rel === currentRel;
            });
            const node: CardsCardNode = {
                kind: 'card',
                folder,
                uri,
                card,
                isCurrentFile: isCurrent
            };
            if (isCurrent) {
                currentFile.push(node);
            } else {
                otherFiles.push(node);
            }
        }

        const byCreatedDesc = (a: CardsCardNode, b: CardsCardNode) => b.card.createdAt - a.card.createdAt;
        currentFile.sort(byCreatedDesc);
        otherFiles.sort(byCreatedDesc);

        return { total: currentFile.length + otherFiles.length, currentFile, otherFiles };
    }

    private async readCards(folder: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
        try {
            return await this.store.readCardsDirectory(folder);
        } catch (err: any) {
            const msg = String(err?.message ?? err ?? '');
            if (msg.includes('FileNotFound') || msg.includes('EntryNotFound') || msg.includes('ENOENT')) {
                return [];
            }
            return [];
        }
    }

    private async listCards(folder: vscode.WorkspaceFolder): Promise<Array<{ uri: vscode.Uri; card: KnowledgeCard }>> {
        const cardUris = await this.readCards(folder);
        const cards: Array<{ uri: vscode.Uri; card: KnowledgeCard }> = [];
        for (const uri of cardUris) {
            const card = await readCard(uri);
            if (card) {
                cards.push({ uri, card });
            }
        }
        return cards;
    }

    private resetWatchers(): void {
        this.disposeWatchers();
        const folders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of folders) {
            const pattern = new vscode.RelativePattern(
                folder,
                `${WorkspaceRootFolderName}/${WorkspaceKnowledgeFolderName}/${WorkspaceKnowledgeCardsFolderName}/*.json`
            );
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange(() => this.refresh());
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
            this.watchers.push(watcher);
        }
    }

    private disposeWatchers(): void {
        for (const w of this.watchers) {
            w.dispose();
        }
        this.watchers = [];
    }
}

async function readCard(uri: vscode.Uri): Promise<KnowledgeCard | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        return isKnowledgeCard(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function formatCardTooltip(card: KnowledgeCard): string {
    const lines: string[] = [];
    lines.push(`[${card.type}] ${card.title}`);
    if (card.summary) {
        lines.push('');
        lines.push(card.summary);
    }
    lines.push('');
    lines.push(`Updated: ${new Date(card.updatedAt).toLocaleString()}`);
    const file = card.anchors?.[0]?.file?.workspaceRelativePath;
    if (file) {
        lines.push(`File: ${normalizeWorkspaceRelativePath(file)}`);
    }
    const primaryAnchor = card.anchors?.[0];
    if (primaryAnchor?.rangeAtCapture && primaryAnchor.snapshot?.text && card.status !== 'archived') {
        lines.push('');
        lines.push('Anchor may need review if the original code can no longer be found. Use reselect anchor from the card editor.');
    }
    return lines.join('\n');
}
