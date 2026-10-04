// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { runKnowledgeCacheBenchmark, writeKnowledgeCacheArtifacts } from './fixtures/knowledge-cache-benchmark.js';

describe('knowledge cache benchmark', () => {
    test('refreshes the index after an unforced card change and writes artifacts', async () => {
        const rows = await runKnowledgeCacheBenchmark(20, 2);
        expect(rows).toHaveLength(2);
        expect(rows.every(row => !row.staleAfterUnforcedChange)).toBe(true);
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const output = await fs.mkdtemp(path.join(artifactRoot, 'knowledge-cache-report-'));
        try {
            await writeKnowledgeCacheArtifacts(output, rows);
            expect((await fs.stat(path.join(output, 'validation_report.md'))).size).toBeGreaterThan(100);
            expect(await fs.readFile(path.join(output, 'validation_report.md'), 'utf8')).toContain('stale results occurred in 0/2 trials');
        } finally {
            await fs.rm(output, { recursive: true, force: true });
        }
    });
});
