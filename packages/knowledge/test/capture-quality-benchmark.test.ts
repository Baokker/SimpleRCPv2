// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { DRAFT_FIXTURES, TRIGGER_BENCHMARK_CASES, evaluateDraftResponse, evaluateTriggerSignal, summarizeTriggerCases } from './fixtures/capture-quality-benchmark.js';
import { writeCaptureQualityArtifacts } from './fixtures/capture-quality-benchmark-report.js';

describe('capture quality benchmark', () => {
    test('freezes balanced trigger boundary cases', () => {
        expect(TRIGGER_BENCHMARK_CASES).toHaveLength(240);
        expect(TRIGGER_BENCHMARK_CASES.filter(item => item.expected)).toHaveLength(120);
        expect(TRIGGER_BENCHMARK_CASES.every(item => evaluateTriggerSignal(item.signal) === item.expected)).toBe(true);
        expect(summarizeTriggerCases().every(row => row.f1 === 1)).toBe(true);
    });

    test('freezes 60 draft fixtures and scores grounded structure', () => {
        expect(DRAFT_FIXTURES).toHaveLength(60);
        const fixture = DRAFT_FIXTURES[0];
        const raw = JSON.stringify({ type: 'decision', title: 'Bounded retries', summary: `Use ${fixture.mustMention} when explaining bounded retries.`, content: `The evidence states ${fixture.mustMention}. Keep retries bounded and preserve errors. This content is long enough for validation.`, tags: ['retry'], confidence: 0.9, evidenceCitations: ['evidence.chatMessages[0].text'], unknowns: [] });
        const row = evaluateDraftResponse(fixture, raw, { model: 'fake', apiModel: 'fake', latencyMs: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2 });
        expect(row.validStructure).toBe(true);
        expect(row.validCitations).toBe(true);
        expect(row.mustMentionCovered).toBe(true);
        expect(row.groundedPass).toBe(true);

        const invalidCitation = evaluateDraftResponse(fixture, JSON.stringify({
            type: 'decision', title: 'Bounded retries', summary: `Use ${fixture.mustMention} when explaining bounded retries.`,
            content: `The evidence states ${fixture.mustMention}. Keep retries bounded and preserve errors. This content is long enough for validation.`,
            tags: ['retry'], confidence: 0.9, evidenceCitations: ['evidence.nonexistent[99]'], unknowns: []
        }), { model: 'fake', apiModel: 'fake', latencyMs: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2 });
        expect(invalidCitation.validCitations).toBe(false);
        expect(invalidCitation.groundedPass).toBe(false);
    });

    test('writes a chart and a validation report with the benchmark artifacts', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const outputDir = await fs.mkdtemp(path.join(artifactRoot, 'capture-quality-report-'));
        const triggerSummary = summarizeTriggerCases();
        const draftSummary = [{
            triggerType: 'overall', runs: 60, infrastructureFailures: 0,
            validStructureRate: 1, acceptedTypeRate: 0.6167, validCitationRate: 1,
            mustMentionRate: 0.9333, groundedPassRate: 0.9333,
            averageTokens: 2000, medianLatencyMs: 9000, p95LatencyMs: 15000
        }];
        try {
            await writeCaptureQualityArtifacts(outputDir, {
                triggerSummary,
                draftRows: [],
                draftSummary,
                manifest: { completedAt: '2026-07-13T00:00:00.000Z' }
            });
            expect(await fs.readFile(path.join(outputDir, 'figure-capture-draft-quality.svg'), 'utf8')).toContain('<svg');
            expect(await fs.readFile(path.join(outputDir, 'validation_report.md'), 'utf8')).toContain('11/11 fallacy types checked');
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });
});
