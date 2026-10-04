// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { REUSABLE_KNOWLEDGE_CARD_STATUSES } from '../src/schema.js';
import {
    runKnowledgeStatusGateBenchmark,
    statusGateCorpus,
    summarizeKnowledgeStatusGate,
    writeKnowledgeStatusGateArtifacts
} from './fixtures/knowledge-status-gate-benchmark.js';

describe('knowledge status release gate', () => {
    test('defines reviewed as the only reusable card status', () => {
        expect(REUSABLE_KNOWLEDGE_CARD_STATUSES).toEqual(['reviewed']);
        const cards = statusGateCorpus();
        expect(cards.filter(card => card.status === 'reviewed')).toHaveLength(24);
        expect(new Set(cards.filter(card => card.status !== 'reviewed').map(card => card.status))).toEqual(
            new Set(['draft', 'needsReview', 'archived', 'orphaned'])
        );
    });

    test('blocks unreleased cards without reducing reviewed target recall', async () => {
        const rows = await runKnowledgeStatusGateBenchmark();
        const summary = summarizeKnowledgeStatusGate(rows);
        const current = summary.find(row => row.condition === 'current-unfiltered');
        const released = summary.find(row => row.condition === 'reviewed-only');

        expect(rows).toHaveLength(240);
        expect(current?.unsafeExposureRate).toBeGreaterThan(0);
        expect(released?.unsafeExposureRate).toBe(0);
        expect(released?.unsafeCards).toBe(0);
        expect(released?.targetRecallAt1).toBeGreaterThanOrEqual(current?.targetRecallAt1 ?? 0);
        expect(released?.targetRecallAt3).toBeGreaterThanOrEqual(current?.targetRecallAt3 ?? 0);

        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const output = await fs.mkdtemp(path.join(artifactRoot, 'knowledge-status-gate-report-'));
        try {
            await writeKnowledgeStatusGateArtifacts(output, rows, summary);
            for (const file of ['rows.json', 'summary.json', 'summary.md', 'protocol.md', 'run-manifest.json']) {
                expect((await fs.stat(path.join(output, file))).size).toBeGreaterThan(20);
            }
        } finally {
            await fs.rm(output, { recursive: true, force: true });
        }
    });
});
