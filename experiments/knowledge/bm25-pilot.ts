import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { searchRankedKnowledgeCards, KNOWLEDGE_BM25_PARAMETERS } from '@simplercp/knowledge';
import { knowledgeActiveFiles } from '../../apps/server/src/knowledge/provider.js';
import { dataset, configSchema, RunStore, readJson, readJsonl, writeJson, exists, platformRoot, benchRoot, digest, selectIds } from './common.js';
import { retrievalMetrics, summarizeRetrieval } from './k5.js';

const protocol = await readJson(path.join(platformRoot, 'experiments/knowledge/bm25-protocol.json'));
if (digest(protocol.candidate.parameters) !== digest(KNOWLEDGE_BM25_PARAMETERS)) throw new Error('BM25 protocol differs from the implementation');
const data = await dataset();
const configuration = configSchema.parse(await readJson(path.join(platformRoot, 'experiments/knowledge/formal-v21.json')));
const directory = path.join(platformRoot, 'experiments/knowledge/runs/E3-bm25-pilot-20261010');
const store = await new RunStore(directory).open('bm25-pilot', configuration, data);
store.metadata.protocolHash = digest(protocol);
const variants = new Set(data.tasks.flatMap(task => task.variantCardIds ?? []));
const manifestFiles = Object.keys(await readJson<Record<string, string>>(path.join(benchRoot, 'manifest.json')));

try {
    if (await exists(path.join(directory, 'protocol.json')) && digest(await readJson(path.join(directory, 'protocol.json'))) !== digest(protocol)) throw new Error('Pilot protocol changed during resume');
    await writeJson(path.join(directory, 'protocol.json'), protocol);
    for (const task of selectIds(data.tasks, protocol.pilotTasks.join(','))) {
        const cards = data.library.filter(item => item.repository === task.repository && item.card.status === 'reviewed' && !variants.has(item.card.id)).map(item => item.card);
        const files = manifestFiles.filter(file => file.startsWith(`repos/${task.repository}/`)).map(file => file.slice(`repos/${task.repository}/`.length));
        const activity = knowledgeActiveFiles({ prompt: task.prompt }, undefined, files);
        for (const condition of protocol.conditions as string[]) {
            const key = `${task.id}-${condition}`;
            if (store.done(key)) continue;
            const activeFiles = ['R1', 'R6-lexical'].includes(condition) ? [] : activity.activeFiles;
            const start = performance.now();
            const ranked = await searchRankedKnowledgeCards({ cards, workspaceId: task.repository, indexDir: path.join(store.raw(key), 'index'), query: task.prompt, activeFiles, ranking: condition === 'R3' || condition.startsWith('R6') ? 'bounded' : 'legacy', useActiveFiles: true, lexicalScoring: condition.startsWith('R6') ? 'bm25' : 'legacy' });
            const latencyMs = performance.now() - start;
            await writeJson(path.join(store.raw(key), 'ranking.json'), ranked);
            await store.append({ key, completed: true, task: task.id, taskKind: task.kind, repository: task.repository, condition,
                query: task.prompt, activeFiles, latencyMs,
                ...retrievalMetrics(ranked.map(item => item.cardId), task.targetCardId ? [task.targetCardId] : []),
                targetRank: task.targetCardId ? ranked.findIndex(item => item.cardId === task.targetCardId) + 1 : null });
        }
    }
} finally {
    await store.close();
}

const rows = await readJsonl(path.join(directory, 'results.jsonl'));
const summary = Object.fromEntries(protocol.conditions.map((condition: string) => [condition, summarizeRetrieval(rows.filter(row => row.condition === condition))]));
const accepted = summary.R6.recall5 > summary.R3.recall5 && summary.R6.mrr >= summary.R3.mrr && summary.R6.falseInjections <= summary.R3.falseInjections;
await writeJson(path.join(directory, 'summary.json'), { summary, accepted, protocolHash: digest(protocol), modelCalls: 0 });
console.log(JSON.stringify({ summary, accepted, protocolHash: digest(protocol), modelCalls: 0 }));
