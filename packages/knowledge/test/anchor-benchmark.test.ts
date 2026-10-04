// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
    ANCHOR_BENCHMARK_EDIT_TYPES,
    compareAnchorBenchmarkResults,
    collectFrozenAnchorCorpus,
    createAnchorBenchmarkCases,
    runAnchorBenchmarkCases,
    summarizeAnchorBenchmark,
    type FrozenAnchorSample
} from './fixtures/anchor-benchmark.js';
import { writeAnchorBenchmarkArtifacts } from './fixtures/anchor-benchmark-report.js';

const sampleText = [
    'function boot() {',
    '  const timeoutMs = 200;',
    '  return timeoutMs;',
    '}',
    '',
    'export function main() {',
    '  return boot();',
    '}',
    ''
].join('\n');
const selectionText = ['  const timeoutMs = 200;', '  return timeoutMs;'].join('\n');
const selectionStart = sampleText.indexOf(selectionText);

const frozenSample: FrozenAnchorSample = {
    id: 'B001',
    category: 'source',
    language: 'typescript',
    sourceFile: 'src/fixture.ts',
    sourceHash: 'fixture-hash',
    text: sampleText,
    selectionStart,
    selectionEnd: selectionStart + selectionText.length
};

describe('anchor benchmark case generation', () => {
    test('creates the frozen seven-edit suite for every anchor sample', () => {
        const cases = createAnchorBenchmarkCases([frozenSample]);

        expect(cases).toHaveLength(ANCHOR_BENCHMARK_EDIT_TYPES.length);
        expect(cases.map(item => item.editType)).toEqual(ANCHOR_BENCHMARK_EDIT_TYPES);
        expect(cases.every(item => item.originalText === sampleText)).toBe(true);
        expect(cases.every(item => item.anchor.snapshot?.text === selectionText)).toBe(true);
    });
});

describe('anchor benchmark corpus collection', () => {
    test('freezes a deterministic 48-anchor corpus from real repository files', () => {
        const repoRoot = path.resolve(process.cwd(), '../..');
        const first = collectFrozenAnchorCorpus(repoRoot);
        const second = collectFrozenAnchorCorpus(repoRoot);

        expect(first).toEqual(second);
        expect(first).toHaveLength(48);
        expect(countByCategory(first)).toEqual({ source: 24, test: 12, config: 8, documentation: 4 });
        expect(new Set(first.map(item => item.sourceFile)).size).toBeGreaterThanOrEqual(24);
        expect(first.some(item => item.sourceFile.includes('anchor-benchmark'))).toBe(false);
        expect(first.some(item => item.sourceFile.startsWith('docs/superpowers/'))).toBe(false);
        for (const item of first) {
            const selection = item.text.slice(item.selectionStart, item.selectionEnd);
            expect(selection.length, item.id).toBeGreaterThanOrEqual(40);
            expect(item.text.indexOf(selection), item.id).toBe(item.text.lastIndexOf(selection));
        }
    });

    test('applies every labeled mutation instead of emitting no-op cases', () => {
        const corpus = collectFrozenAnchorCorpus(path.resolve(process.cwd(), '../..'));
        const cases = createAnchorBenchmarkCases(corpus);

        for (const item of cases) {
            expect(item.updatedText, item.id).not.toBe(item.originalText);
            if (item.editType === 'formatting' || item.editType === 'partial-rewrite') {
                if (item.expectation.kind !== 'locate') {
                    throw new Error(`Expected locatable mutation for ${item.id}`);
                }
                const before = item.anchor.snapshot?.text;
                const after = item.updatedText.slice(item.expectation.startOffset, item.expectation.endOffset);
                expect(after, item.id).not.toBe(before);
                expect(after.length, item.id).toBe(before?.length);
            }
        }
    });
});

describe('anchor benchmark strategy evaluation', () => {
    test('classifies correct, wrong, unresolved, and review-needed outcomes', () => {
        const cases = createAnchorBenchmarkCases([frozenSample]);
        const results = runAnchorBenchmarkCases(cases, { timingIterations: 1 });

        expect(outcome(results, 'B001-insert-before', 'range-only')).toBe('unresolved');
        expect(outcome(results, 'B001-insert-before', 'snapshot-only')).toBe('correct');
        expect(outcome(results, 'B001-insert-before', 'multi-strategy')).toBe('correct');

        expect(outcome(results, 'B001-duplicate-code', 'range-only')).toBe('wrong');
        expect(outcome(results, 'B001-duplicate-code', 'snapshot-only')).toBe('unresolved');
        expect(outcome(results, 'B001-duplicate-code', 'multi-strategy')).toBe('wrong');

        expect(outcome(results, 'B001-delete-anchor', 'range-only')).toBe('unresolved');
        expect(outcome(results, 'B001-delete-anchor', 'snapshot-only')).toBe('unresolved');
        expect(outcome(results, 'B001-delete-anchor', 'multi-strategy')).toBe('review-needed');
    });

    test('summarizes paired outcomes, uncertainty, latency, and statistical tests', () => {
        const cases = createAnchorBenchmarkCases([frozenSample]);
        const results = runAnchorBenchmarkCases(cases, { timingIterations: 2, warmupIterations: 0 });
        const summary = summarizeAnchorBenchmark(cases, results);

        expect(summary.caseCount).toBe(7);
        expect(summary.locatableCaseCount).toBe(6);
        expect(summary.methods).toHaveLength(3);
        expect(summary.methods.every(method => method.total === 7)).toBe(true);
        expect(summary.methods.every(method => method.correctRate95Ci.length === 2)).toBe(true);
        expect(summary.methods.find(method => method.method === 'multi-strategy')?.outcomes).toMatchObject({
            wrong: 1,
            'review-needed': 1
        });
        expect(summary.cochranQ.df).toBe(2);
        expect(summary.cochranQ.pValue).toBeGreaterThanOrEqual(0);
        expect(summary.cochranQ.pValue).toBeLessThanOrEqual(1);
        expect(summary.pairwiseMcNemar).toHaveLength(3);
        expect(summary.byEditType).toHaveLength(7 * 3);
    });

    test('writes auditable tables, charts, and a browser report', () => {
        const cases = createAnchorBenchmarkCases([frozenSample]);
        const results = runAnchorBenchmarkCases(cases, { timingIterations: 1, warmupIterations: 0 });
        const summary = summarizeAnchorBenchmark(cases, results);
        const artifactRoot = path.resolve(process.cwd(), '.test-artifacts');
        mkdirSync(artifactRoot, { recursive: true });
        const outputDir = mkdtempSync(path.join(artifactRoot, 'anchor-benchmark-'));

        try {
            writeAnchorBenchmarkArtifacts(outputDir, {
                corpus: [frozenSample],
                cases,
                results,
                summary,
                manifest: { benchmarkVersion: 'test', nodeVersion: process.version, timingIterations: 1 }
            });

            for (const file of [
                'corpus.json',
                'cases.csv',
                'results.csv',
                'wrong-cases.csv',
                'summary.json',
                'summary.md',
                'figure-anchor-outcomes.svg',
                'figure-anchor-edit-heatmap.svg',
                'figure-anchor-latency.svg',
                'report.html',
                'run-manifest.json'
            ]) {
                expect(readFileSync(path.join(outputDir, file), 'utf8').length, file).toBeGreaterThan(20);
            }
            expect(readFileSync(path.join(outputDir, 'results.csv'), 'utf8').trim().split('\n')).toHaveLength(22);
            expect(readFileSync(path.join(outputDir, 'report.html'), 'utf8')).toContain('Anchor Robustness Benchmark');
        } finally {
            rmSync(outputDir, { recursive: true, force: true });
        }
    });

    test('reproduces logical outcomes while excluding environment-sensitive timing', () => {
        const cases = createAnchorBenchmarkCases([frozenSample]);
        const first = runAnchorBenchmarkCases(cases, { timingIterations: 1, warmupIterations: 0 });
        const second = first.map(item => ({ ...item, durationUs: item.durationUs + 100 }));

        expect(compareAnchorBenchmarkResults(first, second)).toMatchObject({
            verdict: 'REPRODUCIBLE',
            comparedRows: first.length,
            mismatches: []
        });

        second[0] = { ...second[0], outcome: 'wrong' };
        expect(compareAnchorBenchmarkResults(first, second).verdict).toBe('NOT_REPRODUCIBLE');
    });
});

function outcome(
    results: ReturnType<typeof runAnchorBenchmarkCases>,
    caseId: string,
    method: 'range-only' | 'snapshot-only' | 'multi-strategy'
): string | undefined {
    return results.find(item => item.caseId === caseId && item.method === method)?.outcome;
}

function countByCategory(samples: FrozenAnchorSample[]): Record<string, number> {
    return Object.fromEntries(
        ['source', 'test', 'config', 'documentation'].map(category => [
            category,
            samples.filter(item => item.category === category).length
        ])
    );
}
