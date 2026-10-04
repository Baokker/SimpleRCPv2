// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { RETRIEVAL_STRESS_CARDS, RETRIEVAL_STRESS_QUERIES, runRetrievalStressBenchmark, summarizeRetrievalStress } from './fixtures/retrieval-stress-benchmark.js';
import { writeRetrievalStressArtifacts } from './fixtures/retrieval-stress-benchmark-report.js';

describe('retrieval stress benchmark', () => {
    test('freezes 24 targets, paired distractors, and five query categories', () => {
        expect(RETRIEVAL_STRESS_CARDS).toHaveLength(48);
        expect(RETRIEVAL_STRESS_QUERIES).toHaveLength(120);
        expect(new Set(RETRIEVAL_STRESS_QUERIES.map(item => item.targetCardId))).toHaveLength(24);
        expect(new Set(RETRIEVAL_STRESS_QUERIES.map(item => item.category))).toHaveLength(5);
    });

    test('runs five retrieval ablation conditions and writes auditable artifacts', async () => {
        const rows = await runRetrievalStressBenchmark();
        const summary = summarizeRetrievalStress(rows);
        expect(rows).toHaveLength(600);
        expect(summary).toHaveLength(30);
        expect(rows.every(row => row.retrievedCardIds.length <= 3)).toBe(true);
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const output = await fs.mkdtemp(path.join(artifactRoot, 'retrieval-stress-report-'));
        try {
            await writeRetrievalStressArtifacts(output, rows, summary, { benchmarkVersion: 'test' });
            for (const file of ['results.jsonl', 'results.csv', 'summary.json', 'summary.md', 'figure-retrieval-recall.svg', 'validation_report.md', 'run-manifest.json']) {
                expect((await fs.stat(path.join(output, file))).size).toBeGreaterThan(20);
            }
        } finally {
            await fs.rm(output, { recursive: true, force: true });
        }
    });
});
