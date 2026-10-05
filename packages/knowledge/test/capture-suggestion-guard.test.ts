import { describe, expect, test } from 'vitest';
import { isCaptureSuggestion } from '../src/schema/card.js';

describe('capture suggestion guard', () => {
    test('rejects non-object', () => {
        expect(isCaptureSuggestion(undefined)).toBe(false);
        expect(isCaptureSuggestion(null)).toBe(false);
        expect(isCaptureSuggestion('x')).toBe(false);
    });

    test('accepts minimal valid object shape', () => {
        const s = {
            id: 's1',
            triggerType: 'chat.dense',
            createdAt: 1,
            origin: 'human-human',
            actors: { memberIds: ['m1'], runIds: ['run-1'] },
            evidence: {}
        };
        expect(isCaptureSuggestion(s)).toBe(true);
    });

    test('rejects invalid suggestedType', () => {
        const s = {
            id: 's1',
            triggerType: 'todo.cleared',
            createdAt: 1,
            origin: 'human-human',
            actors: { memberIds: ['m1'], runIds: ['run-1'] },
            evidence: {},
            suggestedType: 'unknown'
        };
        expect(isCaptureSuggestion(s)).toBe(false);
    });

    test('rejects invalid provenance fields', () => {
        expect(isCaptureSuggestion({
            id: 's1', triggerType: 'chat.dense', createdAt: 1,
            origin: 'human-human', actors: { memberIds: [], runIds: [] }, evidence: {}, confidence: 2
        })).toBe(false);
        expect(isCaptureSuggestion({
            id: 's1', triggerType: 'unknown', createdAt: 1,
            origin: 'human-human', actors: { memberIds: [], runIds: [] }, evidence: {}
        })).toBe(false);
    });

    test('validates suggested anchors', () => {
        const base = {
            id: 's1', triggerType: 'chat.dense', createdAt: 1,
            origin: 'human-human', actors: { memberIds: [], runIds: [] }, evidence: {}
        };
        expect(isCaptureSuggestion({
            ...base,
            suggestedAnchors: [{ anchorId: 'a1', file: { workspaceRelativePath: 'src/a.ts' }, associationLevel: 'file', snapshot: { text: 'x' } }]
        })).toBe(true);
        expect(isCaptureSuggestion({ ...base, suggestedAnchors: [{ anchorId: 'a1' }] })).toBe(false);
    });
});
