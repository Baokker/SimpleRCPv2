// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REUSABLE_KNOWLEDGE_CARD_STATUSES, type KnowledgeCard, type KnowledgeCardStatus } from '../../src/schema/card.js';
import { searchKnowledgeCards } from '../../src/retrieval/index.js';
import {
    RETRIEVAL_STRESS_CARDS,
    RETRIEVAL_STRESS_QUERIES
} from './retrieval-stress-benchmark.js';

export type KnowledgeStatusGateCondition = 'current-unfiltered' | 'reviewed-only';

export interface KnowledgeStatusGateRow {
    queryId: string;
    category: string;
    condition: KnowledgeStatusGateCondition;
    targetCardId: string;
    retrievedCardIds: string[];
    retrievedStatuses: KnowledgeCardStatus[];
    targetRank: number;
    targetRecallAt1: number;
    targetRecallAt3: number;
    unsafeCardCount: number;
    unsafeExposure: boolean;
}

export interface KnowledgeStatusGateSummary {
    condition: KnowledgeStatusGateCondition;
    queries: number;
    targetRecallAt1: number;
    targetRecallAt3: number;
    unsafeExposureRate: number;
    unsafeCards: number;
    retrievedCards: number;
}

const UNRELEASED_STATUSES: KnowledgeCardStatus[] = ['draft', 'needsReview', 'archived', 'orphaned'];

export function statusGateCorpus(): KnowledgeCard[] {
    let distractorIndex = 0;
    return RETRIEVAL_STRESS_CARDS.map(card => {
        if (!card.id.startsWith('D')) {
            return { ...card, status: 'reviewed' };
        }
        const status = UNRELEASED_STATUSES[distractorIndex % UNRELEASED_STATUSES.length];
        distractorIndex++;
        return { ...card, status };
    });
}

export async function runKnowledgeStatusGateBenchmark(): Promise<KnowledgeStatusGateRow[]> {
    const cards = statusGateCorpus();
    const artifactRoot = path.join(process.cwd(), '.test-artifacts');
    await fs.mkdir(artifactRoot, { recursive: true });
    const indexDir = await fs.mkdtemp(path.join(artifactRoot, 'oct-knowledge-status-gate-'));
    const rows: KnowledgeStatusGateRow[] = [];
    try {
        for (const query of RETRIEVAL_STRESS_QUERIES) {
            for (const condition of ['current-unfiltered', 'reviewed-only'] as const) {
                const results = await searchKnowledgeCards({
                    workspaceId: 'knowledge-status-gate-v1',
                    cards,
                    query: query.query,
                    activeFile: query.targetFile,
                    topK: 3,
                    filters: condition === 'reviewed-only'
                        ? { statuses: [...REUSABLE_KNOWLEDGE_CARD_STATUSES] }
                        : undefined,
                    embeddings: {},
                    indexDir
                });
                const targetRank = results.findIndex(result => result.cardId === query.targetCardId) + 1;
                const unsafeCardCount = results.filter(result => result.status !== 'reviewed').length;
                rows.push({
                    queryId: query.id,
                    category: query.category,
                    condition,
                    targetCardId: query.targetCardId,
                    retrievedCardIds: results.map(result => result.cardId),
                    retrievedStatuses: results.map(result => result.status),
                    targetRank,
                    targetRecallAt1: targetRank === 1 ? 1 : 0,
                    targetRecallAt3: targetRank > 0 ? 1 : 0,
                    unsafeCardCount,
                    unsafeExposure: unsafeCardCount > 0
                });
            }
        }
    } finally {
        await fs.rm(indexDir, { recursive: true, force: true });
    }
    return rows;
}

export function summarizeKnowledgeStatusGate(rows: KnowledgeStatusGateRow[]): KnowledgeStatusGateSummary[] {
    return (['current-unfiltered', 'reviewed-only'] as const).map(condition => {
        const selected = rows.filter(row => row.condition === condition);
        const retrievedCards = selected.reduce((sum, row) => sum + row.retrievedCardIds.length, 0);
        return {
            condition,
            queries: selected.length,
            targetRecallAt1: average(selected.map(row => row.targetRecallAt1)),
            targetRecallAt3: average(selected.map(row => row.targetRecallAt3)),
            unsafeExposureRate: average(selected.map(row => row.unsafeExposure ? 1 : 0)),
            unsafeCards: selected.reduce((sum, row) => sum + row.unsafeCardCount, 0),
            retrievedCards
        };
    });
}

export async function writeKnowledgeStatusGateArtifacts(
    outputDir: string,
    rows: KnowledgeStatusGateRow[],
    summary: KnowledgeStatusGateSummary[]
): Promise<void> {
    const sourcePath = fileURLToPath(import.meta.url);
    const gitStatus = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    const manifest = {
        benchmarkVersion: 'knowledge-status-gate-v1',
        generatedAt: new Date().toISOString(),
        modelCalls: 0,
        queries: RETRIEVAL_STRESS_QUERIES.length,
        conditions: ['current-unfiltered', 'reviewed-only'],
        targetCards: 24,
        unreleasedDistractors: 24,
        sourceSha256: createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex'),
        implementationSha256: createHash('sha256').update(await fs.readFile(new URL('../../src/retrieval/index.ts', import.meta.url))).digest('hex'),
        promptConsumerSha256: createHash('sha256').update(await fs.readFile(new URL('../../src/retrieval/inject.ts', import.meta.url))).digest('hex'),
        gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        gitDirty: gitStatus.length > 0
    };
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(outputDir, 'rows.json'), JSON.stringify(rows, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'summary.md'), summaryMarkdown(summary)),
        fs.writeFile(path.join(outputDir, 'protocol.md'), protocolMarkdown()),
        fs.writeFile(path.join(outputDir, 'run-manifest.json'), JSON.stringify(manifest, undefined, 2) + '\n')
    ]);
}

function summaryMarkdown(summary: KnowledgeStatusGateSummary[]): string {
    const lines = [
        '# Knowledge Status Gate Benchmark',
        '',
        '| Condition | Queries | Target Recall@1 | Target Recall@3 | Unsafe exposure | Unsafe cards | Retrieved cards |',
        '|---|---:|---:|---:|---:|---:|---:|'
    ];
    for (const row of summary) {
        lines.push(`| ${row.condition} | ${row.queries} | ${fixed(row.targetRecallAt1)} | ${fixed(row.targetRecallAt3)} | ${fixed(row.unsafeExposureRate)} | ${row.unsafeCards} | ${row.retrievedCards} |`);
    }
    lines.push('', 'All target cards are reviewed. Lexically colliding distractors are distributed across draft, needsReview, archived, and orphaned. No model is called.', '');
    return lines.join('\n');
}

function protocolMarkdown(): string {
    return '# Protocol: Knowledge Status Gate\n\n- Queries: 120 frozen queries over 24 reviewed target cards.\n- Distractors: 24 lexically colliding cards distributed across four unreleased statuses.\n- Conditions: current search without status filtering; search restricted to reviewed cards.\n- Top K: 3. Embeddings are disabled.\n- Primary safety measure: fraction of queries whose returned context contains at least one unreleased card.\n- Utility measure: reviewed target Recall@1 and Recall@3.\n- Model calls: zero.\n';
}

function fixed(value: number): string {
    return value.toFixed(3);
}

function average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
