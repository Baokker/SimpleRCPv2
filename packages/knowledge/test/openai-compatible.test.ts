import { createServer, type Server } from 'node:http';
import { describe, expect, test } from 'vitest';
import { createOpenAICompatibleClient } from '../src/llm/openaiCompatible.js';

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') reject(new Error('server did not expose a port')); else resolve(address.port); }); });
}

describe('OpenAI compatible client', () => {
    test('sends chat and embedding requests and returns usage', async () => {
        const requests: Array<{ path: string; body: any }> = [];
        const server = createServer((request, response) => { const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => { requests.push({ path: request.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); response.setHeader('content-type', 'application/json'); response.end(request.url?.endsWith('/embeddings') ? JSON.stringify({ data: [{ embedding: [1, 0] }] }) : JSON.stringify({ choices: [{ message: { content: '<think>internal</think>{"ok":true}' } }], usage: { prompt_tokens: 2, completion_tokens: 3, reasoning_tokens: 4, prompt_tokens_details: { cached_tokens: 5 }, cache_write_tokens: 6, total_tokens: 5, cost: 0.007 } })); }); });
        const port = await listen(server);
        try {
            const client = createOpenAICompatibleClient({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'deepseek-chat', embeddingModel: 'text-embedding-v4', apiKey: 'test-key' });
            const completion = await client.complete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }], responseFormat: { type: 'json_object' } });
            const vectors = await client.embed?.(['hello']);
            expect(completion.text).toBe('<think>internal</think>{"ok":true}');
            expect(completion.usage?.totalTokens).toBe(5);
            expect(completion.usage).toMatchObject({ promptTokens: 2, completionTokens: 3, reasoningTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6, cost: 0.007 });
            expect(vectors).toEqual([[1, 0]]);
            expect(requests[0]?.body.response_format).toEqual({ type: 'json_object' });
            expect(requests[1]?.path).toBe('/v1/embeddings');
        } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    });

    test('leaves embedding unavailable when no embedding model is configured', () => {
        const client = createOpenAICompatibleClient({ baseUrl: 'http://127.0.0.1:1/v1', model: 'deepseek-chat' });
        expect(client.embed).toBeUndefined();
    });

    test('fails on HTTP errors and timeout', async () => {
        const server = createServer((_request, response) => { response.statusCode = 500; response.end(JSON.stringify({ error: { message: 'bad request' } })); });
        const port = await listen(server);
        try { const client = createOpenAICompatibleClient({ baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat' }); await expect(client.complete({ model: 'deepseek-chat', messages: [] })).rejects.toThrow('500'); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
        const slow = createServer(() => { /* keep the connection open until the client aborts */ });
        const slowPort = await listen(slow);
        try { const client = createOpenAICompatibleClient({ baseUrl: `http://127.0.0.1:${slowPort}`, model: 'deepseek-chat', timeoutMs: 20 }); await expect(client.complete({ model: 'deepseek-chat', messages: [] })).rejects.toThrow(); } finally { await new Promise<void>(resolve => slow.close(() => resolve())); }
    });
});
