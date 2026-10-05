import { describe, expect, test } from 'vitest';
import { isCaptureSuggestion } from '../src/schema.js';

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
            evidence: {}
        };
        expect(isCaptureSuggestion(s)).toBe(true);
    });

    test('rejects invalid suggestedType', () => {
        const s = {
            id: 's1',
            triggerType: 'todo.cleared',
            createdAt: 1,
            evidence: {},
            suggestedType: 'unknown'
        };
        expect(isCaptureSuggestion(s)).toBe(false);
    });
});

