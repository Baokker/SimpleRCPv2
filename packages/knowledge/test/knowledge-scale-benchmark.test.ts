// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { createScaleCards, runKnowledgeScaleBenchmark } from './fixtures/knowledge-scale-benchmark.js';

describe('knowledge scale benchmark', () => {
    test('creates deterministic schema-compatible cards', () => {
        const cards = createScaleCards(20);
        expect(cards).toHaveLength(20);
        expect(new Set(cards.map(card => card.id)).size).toBe(20);
        expect(cards.every(card => card.anchors.length === 1 && card.tags.length === 3)).toBe(true);
    });

    test('measures build and search at small scales', async () => {
        const rows = await runKnowledgeScaleBenchmark([10, 50]);
        expect(rows).toHaveLength(2);
        expect(rows.every(row => row.buildP95Ms > 0 && row.searchP95Ms > 0)).toBe(true);
        expect(rows.every(row => row.recallAt1 === 1)).toBe(true);
        expect(rows[1].indexBytes).toBeGreaterThan(rows[0].indexBytes);
    });
});
