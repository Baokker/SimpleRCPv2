import * as vscode from 'vscode';
import { normalizeWorkspaceRelativePath } from 'open-collaboration-knowledge';
import type { KnowledgeAnchor, KnowledgeAssociationLevel } from 'open-collaboration-knowledge';
import { CollaborationInstance } from '../collaboration-instance.js';

export interface SymbolCandidate {
    label: string;
    semantic: NonNullable<KnowledgeAnchor['semantic']>;
    range: vscode.Range;
}

export function inferDefaultAssociationLevel(
    doc: vscode.TextDocument,
    selection: vscode.Range,
    symbol?: SymbolCandidate
): KnowledgeAssociationLevel {
    const endOfDoc = doc.lineAt(doc.lineCount - 1).range.end;
    const coversWholeDoc = selection.start.line === 0
        && selection.start.character === 0
        && selection.end.line === endOfDoc.line
        && selection.end.character === endOfDoc.character;
    if (coversWholeDoc) {
        return 'file';
    }
    return symbol ? 'symbol' : 'block';
}

export function safeWorkspaceRelativePathInFolder(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
    try {
        if (uri.scheme === 'oct') {
            // oct:///workspaceName/workspaceFolderName/path/to/file
            const parts = uri.path.split('/').filter(Boolean);
            if (parts.length >= 3) {
                const wfName = parts[1];
                if (wfName !== folder.name) {
                    return undefined;
                }
                return normalizeWorkspaceRelativePath(parts.slice(2).join('/')) || undefined;
            }
            return undefined;
        }

        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf) {
            return undefined;
        }
        if (wf.name !== folder.name) {
            return undefined;
        }
        const rel = vscode.workspace.asRelativePath(uri, false);
        const normalized = normalizeWorkspaceRelativePath(String(rel));
        return normalized || undefined;
    } catch {
        return undefined;
    }
}

export async function inferSmallestContainingSymbolForRange(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri,
    selection: vscode.Range
): Promise<SymbolCandidate | undefined> {
    const local = await findSmallestContainingSymbol(uri, selection);
    if (local) {
        return local;
    }
    if (uri.scheme !== 'oct') {
        return undefined;
    }
    const collab = CollaborationInstance.Current;
    if (!collab || collab.host) {
        return undefined;
    }
    const hostId = collab.hostPeerId;
    if (!hostId) {
        return undefined;
    }
    const workspaceRelativePath = safeWorkspaceRelativePathInFolder(folder, uri);
    if (!workspaceRelativePath) {
        return undefined;
    }

    const response = await withTimeout(
        collab.connection.sendRequest(
            'knowledge/symbolInfo',
            hostId,
            folder.name,
            workspaceRelativePath,
            {
                start: { line: selection.start.line, character: selection.start.character },
                end: { line: selection.end.line, character: selection.end.character }
            }
        ),
        4000
    );
    if (!isSymbolInfoResponse(response)) {
        return undefined;
    }
    return {
        label: response.semantic.name,
        semantic: response.semantic,
        range: new vscode.Range(
            response.range.start.line,
            response.range.start.character,
            response.range.end.line,
            response.range.end.character
        )
    };
}

async function findSmallestContainingSymbol(uri: vscode.Uri, selection: vscode.Range): Promise<SymbolCandidate | undefined> {
    const docSymbols = await getDocumentSymbols(uri);
    return computeSmallestContainingSymbol(docSymbols, selection);
}

async function getDocumentSymbols(uri: vscode.Uri): Promise<unknown> {
    try {
        return await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
    } catch {
        return undefined;
    }
}

function computeSmallestContainingSymbol(docSymbols: unknown, selection: vscode.Range): SymbolCandidate | undefined {
    if (!docSymbols || !Array.isArray(docSymbols)) {
        return undefined;
    }
    const any = docSymbols as any[];
    if (any.length && isDocumentSymbol(any[0])) {
        const symbols = any as vscode.DocumentSymbol[];
        let best: { sym: vscode.DocumentSymbol; path: Array<{ name: string; kind: number }> } | undefined;
        const visit = (syms: vscode.DocumentSymbol[], path: Array<{ name: string; kind: number }>) => {
            for (const s of syms) {
                if (s.range.contains(selection)) {
                    const nextPath = [...path, { name: s.name, kind: s.kind }];
                    if (!best) {
                        best = { sym: s, path: nextPath };
                    } else {
                        const bestLen = best.sym.range.end.line - best.sym.range.start.line;
                        const thisLen = s.range.end.line - s.range.start.line;
                        if (thisLen <= bestLen) {
                            best = { sym: s, path: nextPath };
                        }
                    }
                    if (s.children?.length) {
                        visit(s.children, nextPath);
                    }
                }
            }
        };
        visit(symbols, []);
        if (!best) {
            return undefined;
        }
        return {
            label: best.sym.name,
            semantic: {
                path: best.path,
                name: best.sym.name,
                kind: best.sym.kind
            },
            range: best.sym.range
        };
    }

    let best: vscode.SymbolInformation | undefined;
    for (const s of any as vscode.SymbolInformation[]) {
        if (s.location.range.contains(selection)) {
            if (!best) {
                best = s;
            } else {
                const bestLen = best.location.range.end.line - best.location.range.start.line;
                const thisLen = s.location.range.end.line - s.location.range.start.line;
                if (thisLen <= bestLen) {
                    best = s;
                }
            }
        }
    }
    if (!best) {
        return undefined;
    }
    return {
        label: best.name,
        semantic: {
            path: [],
            name: best.name,
            kind: best.kind
        },
        range: best.location.range
    };
}

function isDocumentSymbol(value: unknown): value is vscode.DocumentSymbol {
    return !!value && typeof value === 'object' && 'children' in (value as any) && 'range' in (value as any);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<undefined>(resolve => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
    });
    const safe = promise.then(v => v).catch(() => undefined as any);
    return Promise.race([safe, timed]).finally(() => {
        if (timeout) {
            clearTimeout(timeout);
        }
    });
}

function isSymbolInfoResponse(
    value: unknown
): value is {
    semantic: { path: Array<{ name: string; kind: number }>; name: string; kind: number };
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
} {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as any;
    if (!v.semantic || typeof v.semantic !== 'object') {
        return false;
    }
    if (typeof v.semantic.name !== 'string' || typeof v.semantic.kind !== 'number' || !Array.isArray(v.semantic.path)) {
        return false;
    }
    if (v.semantic.path.some((p: any) => !p || typeof p.name !== 'string' || typeof p.kind !== 'number')) {
        return false;
    }
    if (!v.range || typeof v.range !== 'object') {
        return false;
    }
    if (!v.range.start || !v.range.end) {
        return false;
    }
    if (typeof v.range.start.line !== 'number' || typeof v.range.start.character !== 'number') {
        return false;
    }
    if (typeof v.range.end.line !== 'number' || typeof v.range.end.character !== 'number') {
        return false;
    }
    return true;
}

