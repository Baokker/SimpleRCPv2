// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { KnowledgeAnchor } from '../../src/schema.js';
import { assessAnchorReviewHint } from '../../src/anchor-review.js';
import {
    offsetsFromRange,
    resolveKnowledgeAnchorInText,
    type ResolvedAnchor
} from '../../src/anchor-resolver.js';

export const ANCHOR_BENCHMARK_EDIT_TYPES = [
    'insert-before',
    'move-within-file',
    'rename-nearby-symbol',
    'formatting',
    'partial-rewrite',
    'duplicate-code',
    'delete-anchor'
] as const;

export type AnchorBenchmarkEditType = (typeof ANCHOR_BENCHMARK_EDIT_TYPES)[number];

export const ANCHOR_BENCHMARK_METHODS = ['range-only', 'snapshot-only', 'multi-strategy'] as const;

export type AnchorBenchmarkMethod = (typeof ANCHOR_BENCHMARK_METHODS)[number];
export type AnchorBenchmarkOutcome = 'correct' | 'wrong' | 'review-needed' | 'unresolved';

export interface FrozenAnchorSample {
    id: string;
    category: 'source' | 'test' | 'config' | 'documentation';
    language: string;
    sourceFile: string;
    sourceHash: string;
    text: string;
    selectionStart: number;
    selectionEnd: number;
}

export type AnchorBenchmarkExpectation =
    | { kind: 'locate'; startOffset: number; endOffset: number }
    | { kind: 'review-needed' };

export interface AnchorBenchmarkCase {
    id: string;
    sampleId: string;
    category: FrozenAnchorSample['category'];
    language: string;
    sourceFile: string;
    editType: AnchorBenchmarkEditType;
    originalText: string;
    updatedText: string;
    anchor: KnowledgeAnchor;
    expectation: AnchorBenchmarkExpectation;
}

export interface AnchorBenchmarkResult {
    caseId: string;
    sampleId: string;
    category: FrozenAnchorSample['category'];
    language: string;
    sourceFile: string;
    editType: AnchorBenchmarkEditType;
    method: AnchorBenchmarkMethod;
    expectedAction: AnchorBenchmarkExpectation['kind'];
    outcome: AnchorBenchmarkOutcome;
    startOffset?: number;
    endOffset?: number;
    confidence?: number;
    durationUs: number;
}

export interface AnchorBenchmarkRunOptions {
    timingIterations?: number;
    warmupIterations?: number;
}

export interface AnchorBenchmarkMethodSummary {
    method: AnchorBenchmarkMethod;
    total: number;
    locatableTotal: number;
    outcomes: Record<AnchorBenchmarkOutcome, number>;
    correctRate: number;
    correctRate95Ci: [number, number];
    wrongRate: number;
    wrongRate95Ci: [number, number];
    latencyP50Us: number;
    latencyP95Us: number;
}

export interface AnchorBenchmarkEditSummary {
    editType: AnchorBenchmarkEditType;
    method: AnchorBenchmarkMethod;
    total: number;
    outcomes: Record<AnchorBenchmarkOutcome, number>;
    correctRate: number | null;
    wrongRate: number;
}

export interface AnchorBenchmarkStatisticalTest {
    statistic: number;
    df: number;
    pValue: number;
}

export interface AnchorBenchmarkMcNemar {
    methodA: AnchorBenchmarkMethod;
    methodB: AnchorBenchmarkMethod;
    aCorrectBWrong: number;
    aWrongBCorrect: number;
    correctRateDifference: number;
    pValue: number;
}

export interface AnchorBenchmarkSummary {
    caseCount: number;
    locatableCaseCount: number;
    reviewExpectedCaseCount: number;
    methods: AnchorBenchmarkMethodSummary[];
    byEditType: AnchorBenchmarkEditSummary[];
    cochranQ: AnchorBenchmarkStatisticalTest;
    pairwiseMcNemar: AnchorBenchmarkMcNemar[];
}

export interface AnchorBenchmarkReproducibility {
    verdict: 'REPRODUCIBLE' | 'NOT_REPRODUCIBLE';
    comparedRows: number;
    mismatches: Array<{
        key: string;
        field: 'missing' | 'outcome' | 'startOffset' | 'endOffset' | 'confidence';
        first: string | number | null;
        second: string | number | null;
    }>;
}

const CORPUS_QUOTAS: Record<FrozenAnchorSample['category'], number> = {
    source: 24,
    test: 12,
    config: 8,
    documentation: 4
};
const CORPUS_CATEGORY_ORDER: Array<FrozenAnchorSample['category']> = ['source', 'test', 'config', 'documentation'];

interface CorpusCandidate extends Omit<FrozenAnchorSample, 'id'> {
    rank: string;
}

export function createAnchorBenchmarkCases(samples: FrozenAnchorSample[]): AnchorBenchmarkCase[] {
    return samples.flatMap((sample, sampleIndex) => {
        validateFrozenSample(sample);
        const anchor = makeAnchor(sample);
        return ANCHOR_BENCHMARK_EDIT_TYPES.map(editType => {
            const edited = applyEdit(sample, editType, sampleIndex);
            return {
                id: `${sample.id}-${editType}`,
                sampleId: sample.id,
                category: sample.category,
                language: sample.language,
                sourceFile: sample.sourceFile,
                editType,
                originalText: sample.text,
                updatedText: edited.text,
                anchor,
                expectation: edited.expectation
            };
        });
    });
}

export function collectFrozenAnchorCorpus(repoRoot: string): FrozenAnchorSample[] {
    const candidatesByCategory = new Map<FrozenAnchorSample['category'], CorpusCandidate[]>();
    for (const category of CORPUS_CATEGORY_ORDER) {
        candidatesByCategory.set(category, []);
    }

    for (const absoluteFile of listRepositoryFiles(repoRoot)) {
        const sourceFile = path.relative(repoRoot, absoluteFile).split(path.sep).join('/');
        if (sourceFile.includes('anchor-benchmark') || sourceFile.startsWith('docs/superpowers/')) {
            continue;
        }
        const category = classifyCorpusFile(sourceFile);
        if (!category) {
            continue;
        }
        const text = readFileSync(absoluteFile, 'utf8').replace(/\r\n/g, '\n');
        const sourceHash = sha256(text);
        candidatesByCategory.get(category)?.push(...findCorpusCandidates({
            category,
            language: languageForFile(sourceFile),
            sourceFile,
            sourceHash,
            text
        }));
    }

    const selected: CorpusCandidate[] = [];
    for (const category of CORPUS_CATEGORY_ORDER) {
        const quota = CORPUS_QUOTAS[category];
        const candidates = (candidatesByCategory.get(category) ?? []).sort((a, b) => a.rank.localeCompare(b.rank));
        const perFile = new Map<string, number>();
        const categorySelection: CorpusCandidate[] = [];
        for (const candidate of candidates) {
            if ((perFile.get(candidate.sourceFile) ?? 0) >= 2) {
                continue;
            }
            categorySelection.push(candidate);
            perFile.set(candidate.sourceFile, (perFile.get(candidate.sourceFile) ?? 0) + 1);
            if (categorySelection.length === quota) {
                break;
            }
        }
        if (categorySelection.length !== quota) {
            throw new Error(`Unable to collect ${quota} ${category} anchors; found ${categorySelection.length}`);
        }
        selected.push(...categorySelection);
    }

    return selected.map((candidate, index) => ({
        id: `B${String(index + 1).padStart(3, '0')}`,
        category: candidate.category,
        language: candidate.language,
        sourceFile: candidate.sourceFile,
        sourceHash: candidate.sourceHash,
        text: candidate.text,
        selectionStart: candidate.selectionStart,
        selectionEnd: candidate.selectionEnd
    }));
}

export function runAnchorBenchmarkCases(
    cases: AnchorBenchmarkCase[],
    options: AnchorBenchmarkRunOptions = {}
): AnchorBenchmarkResult[] {
    const timingIterations = Math.max(1, options.timingIterations ?? 100);
    const warmupIterations = Math.max(0, options.warmupIterations ?? 10);
    const results: AnchorBenchmarkResult[] = [];

    for (const benchmarkCase of cases) {
        for (const method of ANCHOR_BENCHMARK_METHODS) {
            const resolve = () => resolveWithMethod(method, benchmarkCase.updatedText, benchmarkCase.anchor);
            const resolved = resolve();
            for (let i = 0; i < warmupIterations; i++) {
                resolve();
            }
            const startedAt = performance.now();
            for (let i = 0; i < timingIterations; i++) {
                resolve();
            }
            const durationUs = ((performance.now() - startedAt) * 1_000) / timingIterations;
            results.push({
                caseId: benchmarkCase.id,
                sampleId: benchmarkCase.sampleId,
                category: benchmarkCase.category,
                language: benchmarkCase.language,
                sourceFile: benchmarkCase.sourceFile,
                editType: benchmarkCase.editType,
                method,
                expectedAction: benchmarkCase.expectation.kind,
                outcome: classifyOutcome(method, benchmarkCase, resolved),
                startOffset: resolved?.startOffset,
                endOffset: resolved?.endOffset,
                confidence: resolved?.confidence,
                durationUs
            });
        }
    }

    return results;
}

export function summarizeAnchorBenchmark(
    cases: AnchorBenchmarkCase[],
    results: AnchorBenchmarkResult[]
): AnchorBenchmarkSummary {
    const locatableCaseIds = new Set(cases.filter(item => item.expectation.kind === 'locate').map(item => item.id));
    const methodSummaries = ANCHOR_BENCHMARK_METHODS.map(method => {
        const methodResults = results.filter(item => item.method === method);
        const locatableResults = methodResults.filter(item => locatableCaseIds.has(item.caseId));
        const correct = locatableResults.filter(item => item.outcome === 'correct').length;
        const wrong = methodResults.filter(item => item.outcome === 'wrong').length;
        const durations = methodResults.map(item => item.durationUs);
        return {
            method,
            total: methodResults.length,
            locatableTotal: locatableResults.length,
            outcomes: countOutcomes(methodResults),
            correctRate: rate(correct, locatableResults.length),
            correctRate95Ci: wilson95(correct, locatableResults.length),
            wrongRate: rate(wrong, methodResults.length),
            wrongRate95Ci: wilson95(wrong, methodResults.length),
            latencyP50Us: quantile(durations, 0.5),
            latencyP95Us: quantile(durations, 0.95)
        } satisfies AnchorBenchmarkMethodSummary;
    });

    const byEditType = ANCHOR_BENCHMARK_EDIT_TYPES.flatMap(editType =>
        ANCHOR_BENCHMARK_METHODS.map(method => {
            const editResults = results.filter(item => item.editType === editType && item.method === method);
            const locatableResults = editResults.filter(item => item.expectedAction === 'locate');
            return {
                editType,
                method,
                total: editResults.length,
                outcomes: countOutcomes(editResults),
                correctRate: locatableResults.length
                    ? rate(locatableResults.filter(item => item.outcome === 'correct').length, locatableResults.length)
                    : null,
                wrongRate: rate(editResults.filter(item => item.outcome === 'wrong').length, editResults.length)
            } satisfies AnchorBenchmarkEditSummary;
        })
    );

    return {
        caseCount: cases.length,
        locatableCaseCount: locatableCaseIds.size,
        reviewExpectedCaseCount: cases.length - locatableCaseIds.size,
        methods: methodSummaries,
        byEditType,
        cochranQ: computeCochranQ(results, locatableCaseIds),
        pairwiseMcNemar: computePairwiseMcNemar(results, locatableCaseIds)
    };
}

export function compareAnchorBenchmarkResults(
    first: AnchorBenchmarkResult[],
    second: AnchorBenchmarkResult[]
): AnchorBenchmarkReproducibility {
    const secondByKey = new Map(second.map(item => [resultKey(item), item]));
    const mismatches: AnchorBenchmarkReproducibility['mismatches'] = [];
    for (const firstItem of first) {
        const key = resultKey(firstItem);
        const secondItem = secondByKey.get(key);
        if (!secondItem) {
            mismatches.push({ key, field: 'missing', first: 'present', second: null });
            continue;
        }
        for (const field of ['outcome', 'startOffset', 'endOffset', 'confidence'] as const) {
            const firstValue = firstItem[field] ?? null;
            const secondValue = secondItem[field] ?? null;
            if (firstValue !== secondValue) {
                mismatches.push({ key, field, first: firstValue, second: secondValue });
            }
        }
        secondByKey.delete(key);
    }
    for (const [key] of secondByKey) {
        mismatches.push({ key, field: 'missing', first: null, second: 'present' });
    }
    return {
        verdict: mismatches.length ? 'NOT_REPRODUCIBLE' : 'REPRODUCIBLE',
        comparedRows: Math.max(first.length, second.length),
        mismatches
    };
}

function resolveWithMethod(
    method: AnchorBenchmarkMethod,
    docText: string,
    anchor: KnowledgeAnchor
): ResolvedAnchor | undefined {
    const selection = anchor.snapshot?.text ?? '';
    if (!selection) {
        return undefined;
    }

    if (method === 'range-only') {
        if (!anchor.rangeAtCapture) {
            return undefined;
        }
        const range = offsetsFromRange(docText, anchor.rangeAtCapture);
        if (!range || docText.slice(range.startOffset, range.endOffset) !== selection) {
            return undefined;
        }
        return { ...range, confidence: 1 };
    }

    if (method === 'snapshot-only') {
        const first = docText.indexOf(selection);
        if (first === -1 || docText.indexOf(selection, first + 1) !== -1) {
            return undefined;
        }
        return { startOffset: first, endOffset: first + selection.length, confidence: 0.95 };
    }

    return resolveKnowledgeAnchorInText(docText, anchor);
}

function classifyOutcome(
    method: AnchorBenchmarkMethod,
    benchmarkCase: AnchorBenchmarkCase,
    resolved: ResolvedAnchor | undefined
): AnchorBenchmarkOutcome {
    const expected = benchmarkCase.expectation;
    if (expected.kind === 'locate') {
        if (resolved) {
            return resolved.startOffset === expected.startOffset && resolved.endOffset === expected.endOffset
                ? 'correct'
                : 'wrong';
        }
        if (method === 'multi-strategy' && assessAnchorReviewHint(benchmarkCase.updatedText, benchmarkCase.anchor).needsReview) {
            return 'review-needed';
        }
        return 'unresolved';
    }

    if (resolved) {
        return 'wrong';
    }
    if (method === 'multi-strategy' && assessAnchorReviewHint(benchmarkCase.updatedText, benchmarkCase.anchor).needsReview) {
        return 'review-needed';
    }
    return 'unresolved';
}

function countOutcomes(results: AnchorBenchmarkResult[]): Record<AnchorBenchmarkOutcome, number> {
    return {
        correct: results.filter(item => item.outcome === 'correct').length,
        wrong: results.filter(item => item.outcome === 'wrong').length,
        'review-needed': results.filter(item => item.outcome === 'review-needed').length,
        unresolved: results.filter(item => item.outcome === 'unresolved').length
    };
}

function resultKey(result: AnchorBenchmarkResult): string {
    return `${result.caseId}::${result.method}`;
}

function computeCochranQ(
    results: AnchorBenchmarkResult[],
    locatableCaseIds: Set<string>
): AnchorBenchmarkStatisticalTest {
    const rows = [...locatableCaseIds].map(caseId =>
        ANCHOR_BENCHMARK_METHODS.map(method =>
            results.some(item => item.caseId === caseId && item.method === method && item.outcome === 'correct') ? 1 : 0
        )
    );
    const methodTotals = ANCHOR_BENCHMARK_METHODS.map((_, methodIndex) =>
        rows.reduce((sum, row) => sum + row[methodIndex], 0)
    );
    const rowTotals = rows.map(row => row.reduce((sum, value) => sum + value, 0));
    const k = ANCHOR_BENCHMARK_METHODS.length;
    const total = methodTotals.reduce((sum, value) => sum + value, 0);
    const denominator = k * total - rowTotals.reduce((sum, value) => sum + value * value, 0);
    const numerator = (k - 1) * (
        k * methodTotals.reduce((sum, value) => sum + value * value, 0) - total * total
    );
    const statistic = denominator > 0 ? numerator / denominator : 0;
    return { statistic, df: k - 1, pValue: Math.exp(-statistic / 2) };
}

function computePairwiseMcNemar(
    results: AnchorBenchmarkResult[],
    locatableCaseIds: Set<string>
): AnchorBenchmarkMcNemar[] {
    const comparisons: AnchorBenchmarkMcNemar[] = [];
    for (let aIndex = 0; aIndex < ANCHOR_BENCHMARK_METHODS.length; aIndex++) {
        for (let bIndex = aIndex + 1; bIndex < ANCHOR_BENCHMARK_METHODS.length; bIndex++) {
            const methodA = ANCHOR_BENCHMARK_METHODS[aIndex];
            const methodB = ANCHOR_BENCHMARK_METHODS[bIndex];
            let aCorrectBWrong = 0;
            let aWrongBCorrect = 0;
            let aCorrect = 0;
            let bCorrect = 0;
            for (const caseId of locatableCaseIds) {
                const isACorrect = results.some(item => item.caseId === caseId && item.method === methodA && item.outcome === 'correct');
                const isBCorrect = results.some(item => item.caseId === caseId && item.method === methodB && item.outcome === 'correct');
                aCorrect += isACorrect ? 1 : 0;
                bCorrect += isBCorrect ? 1 : 0;
                if (isACorrect && !isBCorrect) {
                    aCorrectBWrong++;
                } else if (!isACorrect && isBCorrect) {
                    aWrongBCorrect++;
                }
            }
            comparisons.push({
                methodA,
                methodB,
                aCorrectBWrong,
                aWrongBCorrect,
                correctRateDifference: rate(aCorrect - bCorrect, locatableCaseIds.size),
                pValue: exactMcNemarP(aCorrectBWrong, aWrongBCorrect)
            });
        }
    }
    return comparisons;
}

function exactMcNemarP(aCorrectBWrong: number, aWrongBCorrect: number): number {
    const discordant = aCorrectBWrong + aWrongBCorrect;
    if (!discordant) {
        return 1;
    }
    const tail = Math.min(aCorrectBWrong, aWrongBCorrect);
    let probability = 2 ** -discordant;
    let cumulative = probability;
    for (let k = 0; k < tail; k++) {
        probability *= (discordant - k) / (k + 1);
        cumulative += probability;
    }
    return Math.min(1, 2 * cumulative);
}

function wilson95(successes: number, total: number): [number, number] {
    if (!total) {
        return [0, 0];
    }
    const z = 1.959963984540054;
    const proportion = successes / total;
    const denominator = 1 + z * z / total;
    const center = (proportion + z * z / (2 * total)) / denominator;
    const margin = z * Math.sqrt((proportion * (1 - proportion) + z * z / (4 * total)) / total) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function quantile(values: number[], q: number): number {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) {
        return sorted[lower];
    }
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function rate(numerator: number, denominator: number): number {
    return denominator ? numerator / denominator : 0;
}

function applyEdit(
    sample: FrozenAnchorSample,
    editType: AnchorBenchmarkEditType,
    sampleIndex: number
): { text: string; expectation: AnchorBenchmarkExpectation } {
    const { text, selectionStart: start, selectionEnd: end } = sample;
    const selection = text.slice(start, end);

    switch (editType) {
        case 'insert-before': {
            const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
            const insertion = `// benchmark insertion ${sample.id}\n`;
            return {
                text: text.slice(0, lineStart) + insertion + text.slice(lineStart),
                expectation: { kind: 'locate', startOffset: start + insertion.length, endOffset: end + insertion.length }
            };
        }
        case 'move-within-file': {
            const withoutSelection = text.slice(0, start) + text.slice(end);
            const separator = withoutSelection.endsWith('\n') ? '\n' : '\n\n';
            const movedStart = withoutSelection.length + separator.length;
            return {
                text: withoutSelection + separator + selection,
                expectation: { kind: 'locate', startOffset: movedStart, endOffset: movedStart + selection.length }
            };
        }
        case 'rename-nearby-symbol': {
            const prefix = text.slice(0, start);
            const match = findLastIdentifier(prefix);
            if (!match) {
                const renamedPrefix = mutateLastNonWhitespace(prefix);
                return {
                    text: (renamedPrefix === prefix ? prefix + ' ' : renamedPrefix) + text.slice(start),
                    expectation: { kind: 'locate', startOffset: start, endOffset: end }
                };
            }
            const replacement = mutateToken(match.text);
            const renamed = prefix.slice(0, match.start) + replacement + prefix.slice(match.end) + text.slice(start);
            return {
                text: renamed === text ? `${prefix} ${text.slice(start)}` : renamed,
                expectation: { kind: 'locate', startOffset: start, endOffset: end }
            };
        }
        case 'formatting': {
            const formatted = mutateOneSelectionLine(selection, line => {
                if (line.startsWith('  ')) {
                    return `\t ${line.slice(2)}`;
                }
                const spacedOperator = line.match(/\s=\s/);
                if (spacedOperator?.index !== undefined) {
                    const index = spacedOperator.index;
                    return `${line.slice(0, index)}=  ${line.slice(index + 3)}`;
                }
                return mutateFirstIdentifier(line);
            });
            return {
                text: text.slice(0, start) + formatted + text.slice(end),
                expectation: { kind: 'locate', startOffset: start, endOffset: end }
            };
        }
        case 'partial-rewrite': {
            const rewritten = mutateOneSelectionLine(selection, mutateFirstIdentifier);
            return {
                text: text.slice(0, start) + rewritten + text.slice(end),
                expectation: { kind: 'locate', startOffset: start, endOffset: end }
            };
        }
        case 'duplicate-code': {
            if (sampleIndex % 2 === 0) {
                const insertion = `${selection}\n`;
                return {
                    text: text.slice(0, start) + insertion + text.slice(start),
                    expectation: {
                        kind: 'locate',
                        startOffset: start + insertion.length,
                        endOffset: end + insertion.length
                    }
                };
            }
            const insertion = `\n${selection}`;
            return {
                text: text.slice(0, end) + insertion + text.slice(end),
                expectation: { kind: 'locate', startOffset: start, endOffset: end }
            };
        }
        case 'delete-anchor':
            return {
                text: text.slice(0, start) + text.slice(end),
                expectation: { kind: 'review-needed' }
            };
    }
}

function findCorpusCandidates(input: Omit<FrozenAnchorSample, 'id' | 'selectionStart' | 'selectionEnd'>): CorpusCandidate[] {
    const lines = input.text.split('\n');
    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
        lineStarts.push(offset);
        offset += line.length + 1;
    }

    const candidates: CorpusCandidate[] = [];
    for (let lineIndex = 0; lineIndex <= lines.length - 3; lineIndex++) {
        const selectionLines = lines.slice(lineIndex, lineIndex + 3);
        if (selectionLines.filter(line => line.trim().length >= 4).length < 2) {
            continue;
        }
        const selection = selectionLines.join('\n');
        if (selection.length < 40 || selection.length > 320 || input.text.indexOf(selection) !== input.text.lastIndexOf(selection)) {
            continue;
        }
        const excerptStartLine = Math.max(0, lineIndex - 5);
        const excerptEndLine = Math.min(lines.length, lineIndex + 11);
        const excerpt = lines.slice(excerptStartLine, excerptEndLine).join('\n');
        const selectionStartInDocument = lineStarts[lineIndex];
        const excerptStartInDocument = lineStarts[excerptStartLine];
        const selectionStart = selectionStartInDocument - excerptStartInDocument;
        const selectionEnd = selectionStart + selection.length;
        if (excerpt.indexOf(selection) !== excerpt.lastIndexOf(selection)) {
            continue;
        }
        candidates.push({
            ...input,
            text: excerpt,
            selectionStart,
            selectionEnd,
            rank: sha256(`anchor-benchmark-v1:${input.sourceFile}:${lineIndex}`)
        });
    }
    return candidates;
}

function listRepositoryFiles(root: string): string[] {
    const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
    return tracked.split('\0').filter(Boolean).map(file => path.join(root, file)).sort();
}

function classifyCorpusFile(sourceFile: string): FrozenAnchorSample['category'] | undefined {
    if (sourceFile.endsWith('.md')) {
        return 'documentation';
    }
    if (/\/test\/.*\.ts$/.test(sourceFile)) {
        return 'test';
    }
    if (/(^|\/)(package\.json|tsconfig[^/]*\.json)$/.test(sourceFile)) {
        return 'config';
    }
    if (/\/src\/.*\.tsx?$/.test(sourceFile)) {
        return 'source';
    }
    return undefined;
}

function languageForFile(sourceFile: string): string {
    if (sourceFile.endsWith('.tsx')) {
        return 'tsx';
    }
    if (sourceFile.endsWith('.ts')) {
        return 'typescript';
    }
    if (sourceFile.endsWith('.json')) {
        return 'json';
    }
    return 'markdown';
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function makeAnchor(sample: FrozenAnchorSample): KnowledgeAnchor {
    const selection = sample.text.slice(sample.selectionStart, sample.selectionEnd);
    const contextLength = 120;
    return {
        anchorId: `anchor-${sample.id}`,
        file: { workspaceRelativePath: sample.sourceFile },
        associationLevel: 'block',
        rangeAtCapture: {
            start: posFromOffset(sample.text, sample.selectionStart),
            end: posFromOffset(sample.text, sample.selectionEnd)
        },
        snapshot: { text: selection },
        fingerprint: {
            prefix: sample.text.slice(Math.max(0, sample.selectionStart - contextLength), sample.selectionStart),
            suffix: sample.text.slice(sample.selectionEnd, Math.min(sample.text.length, sample.selectionEnd + contextLength)),
            landmarkLines: selection
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length >= 4)
                .slice(0, 5)
        }
    };
}

function validateFrozenSample(sample: FrozenAnchorSample): void {
    if (sample.selectionStart < 0 || sample.selectionEnd <= sample.selectionStart || sample.selectionEnd > sample.text.length) {
        throw new Error(`Invalid selection for ${sample.id}`);
    }
}

function mutateOneSelectionLine(selection: string, mutate: (line: string) => string): string {
    const lines = selection.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const mutated = preserveLength(lines[index], mutate(lines[index]));
        if (mutated !== lines[index]) {
            lines[index] = mutated;
            return lines.join('\n');
        }
    }
    for (let index = 0; index < lines.length; index++) {
        const mutated = mutateFallbackCharacter(lines[index]);
        if (mutated !== lines[index]) {
            lines[index] = mutated;
            return lines.join('\n');
        }
    }
    return lines.join('\n');
}

function mutateFirstIdentifier(text: string): string {
    const match = /[A-Za-z_$][A-Za-z0-9_$]*/.exec(text);
    if (!match?.[0]) {
        return text.length ? mutateToken(text[0]) + text.slice(1) : text;
    }
    return text.slice(0, match.index) + mutateToken(match[0]) + text.slice(match.index + match[0].length);
}

function mutateFallbackCharacter(text: string): string {
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const replacement = fallbackCharacter(char);
        if (replacement !== char) {
            return text.slice(0, index) + replacement + text.slice(index + 1);
        }
    }
    return text;
}

function mutateLastNonWhitespace(text: string): string {
    for (let index = text.length - 1; index >= 0; index--) {
        if (/\s/.test(text[index])) {
            continue;
        }
        const replacement = fallbackCharacter(text[index]);
        if (replacement !== text[index]) {
            return text.slice(0, index) + replacement + text.slice(index + 1);
        }
    }
    return text;
}

function fallbackCharacter(char: string): string {
    if (/[A-Za-z0-9]/.test(char)) {
        return mutateToken(char);
    }
    const replacements: Record<string, string> = {
        ' ': '\t',
        '\t': ' ',
        '{': '[',
        '}': ']',
        '[': '{',
        ']': '}',
        ':': ';',
        ';': ':',
        ',': '.',
        '.': ',',
        '"': "'",
        "'": '"',
        '(': '<',
        ')': '>'
    };
    return replacements[char] ?? char;
}

function mutateToken(token: string): string {
    return token.replace(/[A-Za-z0-9]/g, char => {
        if (char >= 'a' && char <= 'z') {
            return char === 'z' ? 'a' : String.fromCharCode(char.charCodeAt(0) + 1);
        }
        if (char >= 'A' && char <= 'Z') {
            return char === 'Z' ? 'A' : String.fromCharCode(char.charCodeAt(0) + 1);
        }
        return char === '9' ? '0' : String(Number(char) + 1);
    });
}

function preserveLength(original: string, mutated: string): string {
    if (mutated.length === original.length) {
        return mutated;
    }
    return `${mutated.slice(0, original.length)}${original.slice(mutated.length)}`;
}

function findLastIdentifier(text: string): { text: string; start: number; end: number } | undefined {
    const matches = [...text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)];
    const match = matches.at(-1);
    if (!match?.[0] || match.index === undefined) {
        return undefined;
    }
    return { text: match[0], start: match.index, end: match.index + match[0].length };
}

function posFromOffset(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: offset - lineStart };
}
