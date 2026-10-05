import * as vscode from 'vscode';

export const AnchorPickContextKey = 'oct.knowledge.anchorPickMode';
export const AnchorPickConfirmCommand = 'oct.knowledge.anchorPick.confirm';
export const AnchorPickCancelCommand = 'oct.knowledge.anchorPick.cancel';

export interface AnchorPickResult {
    uri: vscode.Uri;
    selection: vscode.Selection;
}

export interface AnchorPickModeArgs {
    folder: vscode.WorkspaceFolder;
    currentAnchor?: { uri: vscode.Uri; range: vscode.Range };
    onConfirm: (result: AnchorPickResult) => Promise<void> | void;
    onCancel?: () => void;
}

let active: AnchorPickSession | undefined;

export function startAnchorPickMode(args: AnchorPickModeArgs): void {
    if (active) {
        active.cancel(true);
    }
    active = new AnchorPickSession(args);
    void active.start();
}

export function isAnchorPickModeActive(): boolean {
    return !!active;
}

export async function confirmAnchorPick(): Promise<void> {
    if (!active) {
        return;
    }
    await active.confirm();
}

export function cancelAnchorPick(): void {
    active?.cancel(false);
}

class AnchorPickSession implements vscode.Disposable {
    private readonly toDispose: vscode.Disposable[] = [];
    private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    private readonly codeLensProvider = new AnchorPickCodeLensProvider(() => active, this.onDidChangeCodeLensesEmitter.event);
    private progressDone: (() => void) | undefined;
    private statusConfirm: vscode.StatusBarItem | undefined;
    private statusCancel: vscode.StatusBarItem | undefined;
    private currentDecoration: vscode.TextEditorDecorationType | undefined;
    private pickedDecoration: vscode.TextEditorDecorationType | undefined;

    private picked: AnchorPickResult | undefined;

    constructor(private readonly args: AnchorPickModeArgs) { }

    async start(): Promise<void> {
        await vscode.commands.executeCommand('setContext', AnchorPickContextKey, true);

        const progress = deferred<void>();
        this.progressDone = progress.resolve;
        void vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: '代码片段选取模式：请在编辑器中拖选代码，按 Enter 确认，Esc 取消',
                cancellable: false
            },
            async () => await progress.promise
        );
        this.toDispose.push({ dispose: () => this.progressDone?.() });

        this.statusConfirm = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        this.statusConfirm.text = '$(check) 确认关联';
        this.statusConfirm.command = AnchorPickConfirmCommand;
        this.statusConfirm.tooltip = '确认当前选区为知识卡片锚点（Enter）';
        this.statusConfirm.show();
        this.toDispose.push(this.statusConfirm);

        this.statusCancel = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
        this.statusCancel.text = '$(close) 取消';
        this.statusCancel.command = AnchorPickCancelCommand;
        this.statusCancel.tooltip = '取消代码片段选取模式（Esc）';
        this.statusCancel.show();
        this.toDispose.push(this.statusCancel);

        this.currentDecoration = vscode.window.createTextEditorDecorationType({
            border: '1px solid rgba(255, 196, 0, 0.9)',
            borderRadius: '2px',
            backgroundColor: 'rgba(255, 196, 0, 0.12)',
            overviewRulerColor: 'rgba(255, 196, 0, 0.9)',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        this.toDispose.push(this.currentDecoration);

        this.pickedDecoration = vscode.window.createTextEditorDecorationType({
            border: '1px solid rgba(0, 120, 212, 0.9)',
            borderRadius: '2px',
            backgroundColor: 'rgba(0, 120, 212, 0.10)',
            overviewRulerColor: 'rgba(0, 120, 212, 0.9)',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        this.toDispose.push(this.pickedDecoration);

        const codeLensReg = vscode.languages.registerCodeLensProvider(
            [{ scheme: 'file' }, { scheme: 'oct' }],
            this.codeLensProvider
        );
        this.toDispose.push(codeLensReg);

        this.toDispose.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (!editor) {
                    return;
                }
                this.maybeUpdatePicked(editor, editor.selection);
                this.applyDecorations();
            }),
            vscode.window.onDidChangeVisibleTextEditors(() => this.applyDecorations()),
            vscode.window.onDidChangeTextEditorSelection(evt => {
                const selection = evt.selections?.[0];
                if (!selection) {
                    return;
                }
                this.maybeUpdatePicked(evt.textEditor, selection);
                this.applyDecorations();
            })
        );

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.maybeUpdatePicked(editor, editor.selection);
        }
        this.applyDecorations();
        this.onDidChangeCodeLensesEmitter.fire();
    }

    private maybeUpdatePicked(editor: vscode.TextEditor, selection: vscode.Selection): void {
        if (!selection || selection.isEmpty) {
            return;
        }
        const wf = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!wf || wf.name !== this.args.folder.name) {
            return;
        }
        this.picked = { uri: editor.document.uri, selection };
        this.onDidChangeCodeLensesEmitter.fire();
    }

    private applyDecorations(): void {
        const current = this.args.currentAnchor;
        const picked = this.picked;

        for (const editor of vscode.window.visibleTextEditors) {
            if (this.currentDecoration) {
                const ranges = current && sameUri(editor.document.uri, current.uri) ? [current.range] : [];
                editor.setDecorations(this.currentDecoration, ranges);
            }
            if (this.pickedDecoration) {
                const ranges = picked && sameUri(editor.document.uri, picked.uri) ? [picked.selection] : [];
                editor.setDecorations(this.pickedDecoration, ranges);
            }
        }
    }

    getPickedForDocument(docUri: vscode.Uri): AnchorPickResult | undefined {
        const picked = this.picked;
        if (!picked) {
            return undefined;
        }
        if (!sameUri(picked.uri, docUri)) {
            return undefined;
        }
        return picked;
    }

    async confirm(): Promise<void> {
        const picked = this.picked ?? this.pickFromActiveEditor();
        if (!picked) {
            vscode.window.showInformationMessage(vscode.l10n.t('Select some code first.'));
            return;
        }
        const wf = vscode.workspace.getWorkspaceFolder(picked.uri);
        if (!wf || wf.name !== this.args.folder.name) {
            vscode.window.showErrorMessage(vscode.l10n.t('Please select code from a file inside the current workspace folder.'));
            return;
        }
        try {
            await this.args.onConfirm(picked);
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to update anchor: {0}', String((err as any)?.message ?? err)));
            return;
        }
        this.dispose();
    }

    cancel(silent: boolean): void {
        try {
            if (!silent) {
                this.args.onCancel?.();
            }
        } finally {
            this.dispose();
        }
    }

    private pickFromActiveEditor(): AnchorPickResult | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const selection = editor.selection;
        if (!selection || selection.isEmpty) {
            return undefined;
        }
        return { uri: editor.document.uri, selection };
    }

    dispose(): void {
        for (const d of this.toDispose) {
            d.dispose();
        }
        this.toDispose.length = 0;
        this.progressDone?.();
        this.progressDone = undefined;
        this.onDidChangeCodeLensesEmitter.dispose();

        void vscode.commands.executeCommand('setContext', AnchorPickContextKey, false);
        if (active === this) {
            active = undefined;
        }
    }
}

class AnchorPickCodeLensProvider implements vscode.CodeLensProvider {
    constructor(
        private readonly getSession: () => AnchorPickSession | undefined,
        public readonly onDidChangeCodeLenses: vscode.Event<void>
    ) { }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const session = this.getSession();
        if (!session) {
            return [];
        }
        const picked = session.getPickedForDocument(document.uri);
        if (!picked) {
            return [];
        }
        const line = picked.selection.start.line;
        const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
        const confirm = new vscode.CodeLens(range, { title: '确认关联', command: AnchorPickConfirmCommand });
        const cancel = new vscode.CodeLens(range, { title: '取消选取', command: AnchorPickCancelCommand });
        return [confirm, cancel];
    }
}

function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
    return a.toString(true) === b.toString(true);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
