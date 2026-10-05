import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { ExtensionContext } from '../inversify.js';
import { SecretStorage } from '../secret-storage.js';
import type {
    KnowledgeCardDraftV2,
    KnowledgeExtractionInput,
    KnowledgeFieldRefinementInput,
    KnowledgeFieldRefinementResult
} from 'open-collaboration-agent';

type Provider = 'openai' | 'anthropic';

@injectable()
export class KnowledgeLLMBridge {

    @inject(ExtensionContext)
    private readonly context: vscode.ExtensionContext;

    @inject(SecretStorage)
    private readonly secretStorage: SecretStorage;

    async extractDraft(input: KnowledgeExtractionInput, model: string): Promise<KnowledgeCardDraftV2> {
        return await this.runWorker<KnowledgeCardDraftV2>({
            task: 'extractDraft',
            input,
            model
        });
    }

    async refineField(input: KnowledgeFieldRefinementInput, model: string): Promise<KnowledgeFieldRefinementResult> {
        return await this.runWorker<KnowledgeFieldRefinementResult>({
            task: 'refineField',
            input,
            model
        });
    }

    private async runWorker<T>(args: {
        task: 'extractDraft' | 'refineField';
        input: KnowledgeExtractionInput | KnowledgeFieldRefinementInput;
        model: string;
    }): Promise<T> {
        if (vscode.env.uiKind === vscode.UIKind.Web) {
            throw new Error('LLM drafting is not supported in VS Code Web.');
        }
        const hasNode = typeof process === 'object' && !!process?.versions?.node;
        if (!hasNode) {
            throw new Error('LLM drafting requires the desktop (Node) extension host.');
        }

        const provider: Provider = args.model.startsWith('claude-') ? 'anthropic' : 'openai';
        const apiKey = await this.resolveApiKey(provider);
        if (!apiKey) {
            const envVars = provider === 'anthropic'
                ? ['ANTHROPIC_API_KEY']
                : ['OPENAI_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY'];
            throw new Error(`Missing API key. Run "Open Collaboration Tools: Set LLM API Key" or set ${envVars.join(' / ')}.`);
        }

        const workerPath = this.context.asAbsolutePath('dist/knowledge-llm-worker.js');
        // Avoid a static import so the web build doesn't try to bundle node builtins.
        const importWorkerThreads = new Function('return import("node:worker_threads")') as () => Promise<any>;
        const workerThreads: any = await importWorkerThreads();
        const Worker: any = workerThreads?.Worker;
        if (!Worker) {
            throw new Error('worker_threads is not available in this environment.');
        }

        const cfg = vscode.workspace.getConfiguration();
        const openaiBaseUrl = (cfg.get<string>('oct.knowledge.llm.openai.baseUrl') ?? 'https://api.openai.com/v1').trim();
        const openaiTimeoutMs = cfg.get<number>('oct.knowledge.llm.openai.timeoutMs') ?? 30_000;

        return await new Promise<T>((resolve, reject) => {
            const worker = new Worker(workerPath, {
                workerData: {
                    provider,
                    apiKey,
                    task: args.task,
                    model: args.model,
                    input: args.input,
                    openaiBaseUrl,
                    openaiTimeoutMs
                }
            });

            const done = (err?: unknown, value?: T) => {
                worker.removeAllListeners();
                void worker.terminate().catch(() => undefined);
                if (err) {
                    reject(err);
                } else if (value) {
                    resolve(value);
                } else {
                    reject(new Error('Unknown worker result.'));
                }
            };

            worker.on('message', (msg: any) => {
                if (!msg || typeof msg !== 'object') {
                    return;
                }
                if (msg.type === 'result') {
                    done(undefined, msg.result as T);
                } else if (msg.type === 'error') {
                    done(new Error(String(msg.error ?? 'LLM worker error')));
                }
            });
            worker.on('error', (err: any) => done(err));
            worker.on('exit', (code: number) => {
                if (code !== 0) {
                    done(new Error(`LLM worker exited with code ${code}`));
                }
            });
        });
    }

    private async resolveApiKey(provider: Provider): Promise<string | undefined> {
        const stored = await this.secretStorage.retrieveLLMApiKey(provider);
        if (stored) {
            return stored;
        }
        const env = typeof process === 'object' && process ? (process.env ?? {}) : {};
        if (provider === 'anthropic') {
            const value = env.ANTHROPIC_API_KEY;
            const trimmed = typeof value === 'string' ? value.trim() : '';
            return trimmed ? trimmed : undefined;
        }
        for (const key of ['OPENAI_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY'] as const) {
            const value = env[key];
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (trimmed) {
                return trimmed;
            }
        }
        return undefined;
    }
}
