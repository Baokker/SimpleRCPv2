import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { ensureKnowledgeIndex, scoreKnowledgeBm25, tokenizeKnowledgeBm25, searchRankedKnowledgeCards } from '@simplercp/knowledge';
import { createApp } from '../../../apps/server/src/createApp.js';
import { selectKnowledgeInjection } from '../../../apps/server/src/knowledge/injection.js';
import { registerExperimentRoutes } from '../server-routes.js';
import { PlatformClient } from '../client.js';
import { dataset, root, benchRoot, configSchema, readJson, readJsonl } from '../common.js';
import { retrievalMetrics } from '../k5.js';

const frozenData = dataset();
async function directory() {
    await fs.mkdir(path.join(root, '.work'), { recursive: true });
    return fs.mkdtemp(path.join(root, '.work', 'bm25-test-'));
}

test('BM25 保留长查询中的代码名称，重复查询词不增加分数', async () => {
    const location = await directory();
    try {
        assert.ok(tokenizeKnowledgeBm25('成员规范 '.repeat(80) + 'InventoryStore').includes('inventorystore'));
        const data = await frozenData;
        const cards = data.library.filter(item => item.repository === 'R1').map(item => item.card);
        const index = await ensureKnowledgeIndex({ cards, indexDir: location });
        const once = scoreKnowledgeBm25(index.entries, 'InventoryStore');
        assert.ok(once.size > 0);
        assert.deepEqual(scoreKnowledgeBm25(index.entries, 'InventoryStore InventoryStore'), once);
        assert.equal(scoreKnowledgeBm25(index.entries, 'InventoryStores').size, 0);
        assert.equal(scoreKnowledgeBm25(index.entries, '').size, 0);
    } finally {
        await fs.rm(location, { recursive: true, force: true });
    }
});

test('新增 BM25 检索重现小规模比较的排名，候选顺序不影响结果', async () => {
    const location = await directory();
    try {
        const data = await frozenData;
        const protocol = await readJson(path.join(root, 'bm25-protocol.json'));
        const pilot = await readJson(path.join(root, 'runs/E3-bm25-pilot-20261010/summary.json'));
        const records = await readJsonl(path.join(root, 'runs/E3-bm25-pilot-20261010/results.jsonl'));
        assert.equal(pilot.accepted, true);
        const variants = new Set(data.tasks.flatMap(task => task.variantCardIds ?? []));
        for (const id of protocol.pilotTasks as string[]) {
            const task = data.tasks.find(item => item.id === id)!;
            const cards = data.library.filter(item => item.repository === task.repository && item.card.status === 'reviewed' && !variants.has(item.card.id)).map(item => item.card);
            const record = records.find(row => row.key === `${id}-R6`)!;
            const options = { cards, query: task.prompt, activeFiles: record.activeFiles, workspaceId: task.repository, indexDir: location, lexicalScoring: 'bm25' as const, ranking: 'bounded' as const, useActiveFiles: true };
            const current = await searchRankedKnowledgeCards(options);
            const metrics = retrievalMetrics(current.map(item => item.cardId), task.targetCardId ? [task.targetCardId] : []);
            for (const [field, value] of Object.entries(metrics)) assert.equal(value, record[field]);
            assert.equal(task.targetCardId ? current.findIndex(item => item.cardId === task.targetCardId) + 1 : null, record.targetRank);
            assert.deepEqual(await searchRankedKnowledgeCards({ ...options, cards: [...cards].reverse() }), current);
            assert.ok(current.every((item, index) => index === 0 || current[index - 1].score >= item.score));
        }
    } finally {
        await fs.rm(location, { recursive: true, force: true });
    }
});

test('真实 HTTP 中 BM25 预览与离线注入一致，配置和可见性过滤生效', { timeout: 40000 }, async () => {
    const location = await directory();
    await fs.cp(path.join(benchRoot, 'repos/R1'), path.join(location, 'demo'), { recursive: true });
    const configuration = { port: 0, host: '127.0.0.1', publicOrigin: 'http://127.0.0.1', dataDir: path.join(location, 'data'), demoProjectRoot: path.join(location, 'demo'), terminalEnabled: false, knowledge: 'full' as const };
    const app = await createApp(configuration);
    registerExperimentRoutes(app, { enabled: true, provider: 'minimax', model: 'MiniMax-M3', speed: 1, configuration });
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server address is unavailable');
    const api = new PlatformClient(configSchema.parse({ origin: `http://127.0.0.1:${address.port}` }));
    try {
        const project = (await api.request('/api/projects/demo')).project;
        const member = (await api.request('/api/projects/demo/members', undefined, { name: 'BM25 reviewer' })).member.id;
        const data = await frozenData;
        const variants = new Set(data.tasks.flatMap(task => task.variantCardIds ?? []));
        const cards = data.library.filter(item => item.repository === 'R1' && item.card.status === 'reviewed' && !variants.has(item.card.id)).map(item => item.card);
        await api.request('/api/projects/demo/experiments/cards/import', member, { cards });
        const changed = await api.configure(project, member, { lexicalScoring: 'bm25', ranking: 'bounded', maxTotalChars: 4000, topK: 5 });
        assert.equal(changed.config.lexicalScoring, 'bm25');
        const task = data.tasks.find(item => item.id === 'R1-T01')!;
        const preview = await api.request('/api/projects/demo/knowledge/preview', member, { prompt: task.prompt });
        const visibleCards = (await api.request('/api/projects/demo/knowledge/cards', member)).cards;
        const offline = await selectKnowledgeInjection({ cards: [...visibleCards].reverse(), viewerMemberId: member, query: preview.query, activeFiles: preview.activeFiles, config: preview.config, workspaceId: project.id, indexDir: path.join(location, 'offline') });
        assert.deepEqual(offline.records, preview.records);
        assert.deepEqual(offline.candidates, preview.candidates);
        assert.equal(offline.section, preview.section);
        assert.ok(preview.candidates.some((item: { lexical: number }) => item.lexical > 1.2));
        assert.ok(preview.totalChars <= 4000);

        const target = visibleCards.find((card: { id: string }) => card.id === task.targetCardId)!;
        const viewer = 'another-member';
        const restricted = [{ ...target, id: 'personal-card', scope: 'personal' as const, ownerMemberId: member }, { ...target, id: '00-unreviewed-card', status: 'needsReview' as const }, target];
        const gated = await selectKnowledgeInjection({ cards: restricted, viewerMemberId: viewer, query: task.prompt, activeFiles: [], config: preview.config, workspaceId: project.id, indexDir: path.join(location, 'gated') });
        assert.deepEqual(gated.records.map(item => item.id), [target.id]);
        assert.deepEqual(gated.candidates.map(item => item.id), [target.id, '00-unreviewed-card']);
        assert.equal(gated.candidates[0].scoreScope, 'reusable-corpus');
        assert.equal(gated.candidates[1].scoreScope, 'filtered-corpus');
        assert.ok(gated.candidates[1].filtered && gated.candidates[1].reason === 'status:needsReview');
        await assert.rejects(api.configure(project, member, { lexicalScoring: 'unsupported' }), /invalid/);
    } finally {
        await app.locals.agentRuns.dispose();
        await app.locals.agentRuntime.dispose();
        await app.locals.runtimeManager.dispose();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await fs.rm(location, { recursive: true, force: true });
    }
});
