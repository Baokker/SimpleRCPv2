// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { parseKnowledgeCardDraftFromText } from '../../src/extract/extract.js';
import {
    CAPTURE_TRIGGER_TYPES,
    shouldTriggerCapture,
    type CaptureTriggerSignal,
    type CaptureTriggerType
} from '../../src/index.js';

export { CAPTURE_TRIGGER_TYPES };
export type { CaptureTriggerType };
export type TriggerSignal = CaptureTriggerSignal;

export interface TriggerBenchmarkCase {
    id: string;
    triggerType: CaptureTriggerType;
    expected: boolean;
    signal: TriggerSignal;
}

export interface DraftFixture {
    id: string;
    triggerType: CaptureTriggerType;
    expectedTypes: string[];
    mustMention: string;
    payload: Record<string, unknown>;
}

export interface DraftRunRow {
    fixtureId: string;
    triggerType: CaptureTriggerType;
    model: string;
    apiModel: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    validStructure: boolean;
    acceptedType: boolean;
    validCitations: boolean;
    mustMentionCovered: boolean;
    groundedPass: boolean;
    infrastructureFailure: boolean;
    responseText?: string;
    error?: string;
}

export const TRIGGER_BENCHMARK_CASES: TriggerBenchmarkCase[] = CAPTURE_TRIGGER_TYPES.flatMap(triggerType => {
    const cases: TriggerBenchmarkCase[] = [];
    for (let index = 0; index < 20; index++) {
        cases.push({ id: `${triggerType}-positive-${index + 1}`, triggerType, expected: true, signal: positiveSignal(triggerType, index) });
        cases.push({ id: `${triggerType}-negative-${index + 1}`, triggerType, expected: false, signal: negativeSignal(triggerType, index) });
    }
    return cases;
});

export const DRAFT_FIXTURES: DraftFixture[] = CAPTURE_TRIGGER_TYPES.flatMap(triggerType => Array.from({ length: 10 }, (_, index) => draftFixture(triggerType, index + 1)));

export function evaluateTriggerSignal(signal: TriggerSignal): boolean {
    return shouldTriggerCapture(signal);
}

export function evaluateDraftResponse(fixture: DraftFixture, raw: string, metadata: { model: string; apiModel: string; latencyMs: number; promptTokens: number; completionTokens: number; totalTokens: number }): DraftRunRow {
    const parsed = parseKnowledgeCardDraftFromText(raw) as any;
    const validStructure = !!parsed
        && typeof parsed.title === 'string' && parsed.title.trim().length >= 4
        && typeof parsed.summary === 'string' && parsed.summary.trim().length >= 12
        && typeof parsed.content === 'string' && parsed.content.trim().length >= 40
        && Array.isArray(parsed.tags)
        && Array.isArray(parsed.evidenceCitations)
        && Array.isArray(parsed.unknowns);
    const acceptedType = fixture.expectedTypes.includes(String(parsed?.type ?? ''));
    const citations = Array.isArray(parsed?.evidenceCitations) ? parsed.evidenceCitations.map(String) : [];
    const validCitations = citations.length > 0 && citations.every(citation => citationResolves(fixture.payload, citation));
    const text = `${String(parsed?.summary ?? '')}\n${String(parsed?.content ?? '')}`;
    const mustMentionCovered = text.includes(fixture.mustMention);
    return {
        fixtureId: fixture.id,
        triggerType: fixture.triggerType,
        ...metadata,
        validStructure,
        acceptedType,
        validCitations,
        mustMentionCovered,
        groundedPass: validStructure && validCitations && mustMentionCovered,
        infrastructureFailure: false,
        responseText: raw
    };
}

function citationResolves(payload: Record<string, unknown>, citation: string): boolean {
    if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d+\])*$/.test(citation)) return false;
    const segments = citation.match(/[A-Za-z_]\w*|\d+/g) ?? [];
    let value: unknown = payload;
    for (const segment of segments) {
        if (Array.isArray(value)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= value.length) return false;
            value = value[index];
        } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, segment)) {
            value = (value as Record<string, unknown>)[segment];
        } else {
            return false;
        }
    }
    return value !== undefined && value !== null && value !== '';
}

export function summarizeTriggerCases(cases = TRIGGER_BENCHMARK_CASES) {
    return CAPTURE_TRIGGER_TYPES.map(triggerType => {
        const selected = cases.filter(item => item.triggerType === triggerType);
        const outcomes = selected.map(item => ({ expected: item.expected, actual: evaluateTriggerSignal(item.signal) }));
        const tp = outcomes.filter(item => item.expected && item.actual).length;
        const tn = outcomes.filter(item => !item.expected && !item.actual).length;
        const fp = outcomes.filter(item => !item.expected && item.actual).length;
        const fn = outcomes.filter(item => item.expected && !item.actual).length;
        return { triggerType, cases: selected.length, tp, tn, fp, fn, precision: rate(tp, tp + fp), recall: rate(tp, tp + fn), f1: rate(2 * tp, 2 * tp + fp + fn) };
    });
}

export function summarizeDraftRuns(rows: DraftRunRow[]) {
    const groups = [...CAPTURE_TRIGGER_TYPES, 'overall'] as const;
    return groups.map(triggerType => {
        const selected = triggerType === 'overall' ? rows : rows.filter(row => row.triggerType === triggerType);
        const valid = selected.filter(row => !row.infrastructureFailure);
        return {
            triggerType,
            runs: selected.length,
            infrastructureFailures: selected.length - valid.length,
            validStructureRate: average(valid.map(row => Number(row.validStructure))),
            acceptedTypeRate: average(valid.map(row => Number(row.acceptedType))),
            validCitationRate: average(valid.map(row => Number(row.validCitations))),
            mustMentionRate: average(valid.map(row => Number(row.mustMentionCovered))),
            groundedPassRate: average(valid.map(row => Number(row.groundedPass))),
            averageTokens: average(valid.map(row => row.totalTokens)),
            medianLatencyMs: percentile(valid.map(row => row.latencyMs).sort((a, b) => a - b), 0.5),
            p95LatencyMs: percentile(valid.map(row => row.latencyMs).sort((a, b) => a - b), 0.95)
        };
    });
}

function positiveSignal(triggerType: CaptureTriggerType, index: number): TriggerSignal {
    const n = index + 1;
    switch (triggerType) {
        case 'chat.dense': return { triggerType, messageCount: 11 + (n % 4), windowMs: 299_000 - n };
        case 'todo.cleared': return { triggerType, beforeTodos: 1 + (n % 3), afterTodos: 0 };
        case 'magicNumber.added': return { triggerType, addedMagicNumbers: 1 + (n % 4) };
        case 'packageJson.dependencySwitch': return { triggerType, dependencyChanges: 1 + (n % 3), dependencyAgeMs: 599_000 - n };
        case 'diagnostics.fixed': return { triggerType, previousErrors: 1 + (n % 3), currentErrors: 0, errorAgeMs: 60_000 + n, editChars: n, lastEditAgeMs: 299_000 - n };
        case 'rollback.detected': return { triggerType, netDeletedChars: 501 + n, deletedLines: 1, restoredOriginalHash: true, intermediateHashChanged: true, rollbackAgeMs: 299_000 - n };
    }
}

function negativeSignal(triggerType: CaptureTriggerType, index: number): TriggerSignal {
    const variant = index % 5;
    switch (triggerType) {
        case 'chat.dense': return { triggerType, messageCount: variant % 2 ? 10 : 12, windowMs: variant % 2 ? 299_000 : 301_000 };
        case 'todo.cleared': return { triggerType, beforeTodos: variant % 2 ? 0 : 2, afterTodos: variant % 2 ? 0 : 1 };
        case 'magicNumber.added': return { triggerType, addedMagicNumbers: 0 };
        case 'packageJson.dependencySwitch': return { triggerType, dependencyChanges: variant % 2 ? 0 : 1, dependencyAgeMs: variant % 2 ? 1000 : 601_000 };
        case 'diagnostics.fixed': {
            const base = positiveSignal(triggerType, index);
            if (variant === 0) base.previousErrors = 0;
            if (variant === 1) base.currentErrors = 1;
            if (variant === 2) base.errorAgeMs = 59_999;
            if (variant === 3) base.editChars = 0;
            if (variant === 4) base.lastEditAgeMs = 300_001;
            return base;
        }
        case 'rollback.detected': {
            const base = positiveSignal(triggerType, index);
            if (variant === 0) base.netDeletedChars = 500;
            if (variant === 1) base.restoredOriginalHash = false;
            if (variant === 2) base.intermediateHashChanged = false;
            if (variant === 3) base.rollbackAgeMs = 300_001;
            if (variant === 4) { base.netDeletedChars = 100; base.deletedLines = 20; }
            return base;
        }
    }
}

function draftFixture(triggerType: CaptureTriggerType, index: number): DraftFixture {
    const token = `EVID-${triggerType.replace(/[^A-Za-z]/g, '').toUpperCase()}-${String(index).padStart(2, '0')}`;
    const evidence = evidenceFor(triggerType, token, index);
    const expectedTypes: Record<CaptureTriggerType, string[]> = {
        'chat.dense': ['decision', 'constraint', 'risk', 'context'],
        'todo.cleared': ['tutorial'],
        'magicNumber.added': ['constraint'],
        'packageJson.dependencySwitch': ['decision'],
        'diagnostics.fixed': ['tutorial', 'negative'],
        'rollback.detected': ['risk', 'negative']
    };
    return {
        id: `${triggerType}-draft-${index}`,
        triggerType,
        expectedTypes: expectedTypes[triggerType],
        mustMention: token,
        payload: {
            triggerType,
            anchors: [{ file: { workspaceRelativePath: `src/${triggerType.replace(/\./g, '-')}.ts` }, snapshot: { text: token } }],
            projectHints: { mustMention: [token] },
            evidence
        }
    };
}

function evidenceFor(triggerType: CaptureTriggerType, token: string, index: number): Record<string, unknown> {
    switch (triggerType) {
        case 'chat.dense': return { chatMessages: [{ id: `m${index}`, text: `${token}: keep retries bounded and preserve the original error.` }, { id: `m${index}-2`, text: 'Use a finally block for cleanup.' }] };
        case 'todo.cleared': return { todo: { before: [{ text: `TODO ${token}: isolate pending state per document` }], beforeCount: 1, afterCount: 0 }, diff: { before: '// TODO isolate state', after: 'const pending = new Map();' } };
        case 'magicNumber.added': return { added: [{ number: '500', lineText: `const timeoutMs = 500; // ${token}` }], usage: [{ occurrences: [{ context: 'setTimeout(flush, timeoutMs)' }] }] };
        case 'packageJson.dependencySwitch': return { added: [`new-lib-${index}`], removed: [`old-lib-${index}`], diff: { before: `old-lib ${token}`, after: 'new-lib' }, dependencyUsages: {} };
        case 'diagnostics.fixed': return { lastErrors: [{ message: `Type mismatch ${token}` }], errorSnippets: [{ snippet: 'value.toFixed()' }], editedRanges: [{ startLine: 4, endLine: 6 }], beforeAfter: { before: 'const value = input;', after: 'const value = Number(input);' } };
        case 'rollback.detected': return { deletion: { removedChars: 700 }, beforeAfter: { before: `guard(); // ${token}`, after: '' }, snapshots: { beforeDelete: 'guard();', afterDelete: '' } };
    }
}

function rate(numerator: number, denominator: number): number {
    return denominator ? numerator / denominator : 0;
}

function average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(sorted: number[], fraction: number): number {
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0;
}
