// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { KnowledgeCard, KnowledgeCardType } from '../../src/schema.js';
import { ensureKnowledgeIndex, searchKnowledgeCards } from '../../src/knowledge-index.js';

export const KNOWLEDGE_SCALE_SIZES = [10, 50, 100, 500, 1000] as const;

export interface KnowledgeScaleRow {
    cards: number;
    buildTrials: number;
    queries: number;
    buildP50Ms: number;
    buildP95Ms: number;
    searchP50Ms: number;
    searchP95Ms: number;
    recallAt1: number;
    indexBytes: number;
    heapDeltaBytes: number;
}

export async function runKnowledgeScaleBenchmark(sizes: readonly number[] = KNOWLEDGE_SCALE_SIZES): Promise<KnowledgeScaleRow[]> {
    const output: KnowledgeScaleRow[] = [];
    const artifactRoot = path.join(process.cwd(), '.test-artifacts');
    await fs.mkdir(artifactRoot, { recursive: true });
    const root = await fs.mkdtemp(path.join(artifactRoot, 'oct-knowledge-scale-'));
    try {
        for (const size of sizes) {
            const cards = createScaleCards(size);
            const buildTimes: number[] = [];
            const heapBefore = process.memoryUsage().heapUsed;
            let indexBytes = 0;
            for (let trial = 1; trial <= 3; trial++) {
                const indexDir = path.join(root, `${size}-${trial}`);
                const started = performance.now();
                await ensureKnowledgeIndex({ workspaceId: `scale-${size}-${trial}`, cards, embeddings: {}, indexDir, forceRebuild: true });
                buildTimes.push(performance.now() - started);
                const files = await fs.readdir(indexDir);
                indexBytes += await sumFileSizes(indexDir, files);
            }
            const queryIndexDir = path.join(root, `${size}-query`);
            const queryWorkspaceId = `scale-query-${size}`;
            await ensureKnowledgeIndex({ workspaceId: queryWorkspaceId, cards, embeddings: {}, indexDir: queryIndexDir, forceRebuild: true });
            const queryTargets = selectQueryTargets(size, 30);
            const searchTimes: number[] = [];
            let hits = 0;
            for (const target of queryTargets) {
                const started = performance.now();
                const results = await searchKnowledgeCards({
                    workspaceId: queryWorkspaceId,
                    cards,
                    query: `${scaleToken(target)} required project constraint`,
                    topK: 3,
                    embeddings: {},
                    indexDir: queryIndexDir
                });
                searchTimes.push(performance.now() - started);
                if (results[0]?.cardId === `S-${target}`) hits++;
            }
            const heapAfter = process.memoryUsage().heapUsed;
            output.push({
                cards: size,
                buildTrials: buildTimes.length,
                queries: queryTargets.length,
                buildP50Ms: percentile(buildTimes.sort((a, b) => a - b), 0.5),
                buildP95Ms: percentile(buildTimes.sort((a, b) => a - b), 0.95),
                searchP50Ms: percentile(searchTimes.sort((a, b) => a - b), 0.5),
                searchP95Ms: percentile(searchTimes.sort((a, b) => a - b), 0.95),
                recallAt1: queryTargets.length ? hits / queryTargets.length : 0,
                indexBytes: Math.round(indexBytes / 3),
                heapDeltaBytes: heapAfter - heapBefore
            });
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
    return output;
}

export function createScaleCards(count: number): KnowledgeCard[] {
    const types: KnowledgeCardType[] = ['decision', 'constraint', 'risk', 'context', 'negative', 'tutorial'];
    return Array.from({ length: count }, (_, index) => {
        const number = index + 1;
        const token = scaleToken(number);
        return {
            schemaVersion: 3,
            id: `S-${number}`,
            type: types[index % types.length],
            title: `Project policy ${number}: ${token}`,
            summary: `Recorded process knowledge for module ${number} with deterministic token ${token}.`,
            content: `Apply ${token} before changing module ${number}. Preserve unknown fields, respect the file boundary, and record the reason for future maintainers.`,
            source: 'manual', status: 'reviewed', tags: [token, `module-${number}`, 'scale-benchmark'],
            createdAt: number, updatedAt: number, metadata: { benchmark: true },
            anchors: [{ anchorId: `A-S-${number}`, file: { workspaceRelativePath: `src/module-${number}.ts` }, associationLevel: 'file', snapshot: { text: token } }],
            evolution: [{ at: number, action: 'created' }]
        };
    });
}

function scaleToken(number: number): string {
    return `uniquepolicy${number}`;
}

function selectQueryTargets(size: number, count: number): number[] {
    const targetCount = Math.min(size, count);
    const values = new Set<number>();
    for (let index = 0; index < targetCount; index++) {
        values.add(Math.min(size, Math.floor((index * size) / targetCount) + 1));
    }
    return [...values];
}

async function sumFileSizes(dir: string, files: string[]): Promise<number> {
    let total = 0;
    for (const file of files) total += (await fs.stat(path.join(dir, file))).size;
    return total;
}

function percentile(sorted: number[], fraction: number): number {
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0;
}
