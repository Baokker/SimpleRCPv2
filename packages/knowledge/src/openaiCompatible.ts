import type { LlmClient, LlmUsage } from './client.js';

export interface OpenAICompatibleOptions { baseUrl: string; apiKey?: string; model: string; embeddingModel?: string; timeoutMs?: number; fetch?: typeof fetch; }

export function createOpenAICompatibleClient(options: OpenAICompatibleOptions): LlmClient {
    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    const requestFetch = options.fetch ?? globalThis.fetch;
    const client: LlmClient = {
        complete: async request => {
            const payload = {
                model: request.model || options.model,
                messages: request.messages,
                ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
                ...(request.responseFormat ? { response_format: request.responseFormat } : {})
            };
            const body = await requestJson(`${baseUrl}/chat/completions`, payload, options, request.timeoutMs, requestFetch);
            const choice = body.choices?.[0];
            const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
            if (!text) throw new Error('OpenAI compatible response did not contain choices[0].message.content');
            return { text, usage: normalizeUsage(body.usage) };
        }
    };
    const embeddingModel = options.embeddingModel?.trim();
    if (embeddingModel) {
        client.embed = async texts => {
            const body = await requestJson(`${baseUrl}/embeddings`, { model: embeddingModel, input: texts }, options, options.timeoutMs, requestFetch);
            if (!Array.isArray(body.data)) throw new Error('OpenAI compatible embedding response did not contain data');
            return body.data.map((item: { embedding?: unknown }) => {
                if (!Array.isArray(item.embedding) || item.embedding.some(value => typeof value !== 'number')) throw new Error('Invalid embedding vector');
                return item.embedding as number[];
            });
        };
    }
    return client;
}

async function requestJson(url: string, payload: unknown, options: OpenAICompatibleOptions, timeoutMs: number | undefined, requestFetch: typeof fetch): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizeTimeout(timeoutMs ?? options.timeoutMs));
    try {
        const response = await requestFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) }, body: JSON.stringify(payload), signal: controller.signal });
        const text = await response.text();
        let body: any;
        try { body = text ? JSON.parse(text) : {}; } catch { throw new Error(`OpenAI compatible endpoint returned invalid JSON (${response.status})`); }
        if (!response.ok) throw new Error(`OpenAI compatible endpoint returned ${response.status}: ${String(body.error?.message ?? text).slice(0, 400)}`);
        return body;
    } finally {
        clearTimeout(timeout);
    }
}
function normalizeTimeout(value: number | undefined): number { return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 30_000; }
function normalizeUsage(value: unknown): LlmUsage | undefined { if (!value || typeof value !== 'object') return undefined; const usage = value as Record<string, unknown>; return { promptTokens: numberOrUndefined(usage.prompt_tokens), completionTokens: numberOrUndefined(usage.completion_tokens), totalTokens: numberOrUndefined(usage.total_tokens) }; }
function numberOrUndefined(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
