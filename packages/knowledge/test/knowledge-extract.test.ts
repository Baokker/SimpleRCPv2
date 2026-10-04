// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { extractFirstJsonObject, parseKnowledgeCardDraftFromText } from '../src/knowledge-extract.js';

describe('knowledge-extract', () => {
    test('extractFirstJsonObject extracts JSON inside code fences', () => {
        const text = [
            '```json',
            '{ "type": "context", "title": "T", "summary": "S", "content": "C", "tags": [], "confidence": 0.7, "evidenceCitations": ["evidence.x"], "unknowns": [] }',
            '```'
        ].join('\n');
        const json = extractFirstJsonObject(text);
        expect(json).toContain('"type"');
        expect(() => JSON.parse(json!)).not.toThrow();
    });

    test('extractFirstJsonObject ignores leading text and returns first complete object', () => {
        const text = 'noise\n{ "a": 1, "b": { "c": 2 } }\ntrailing';
        const json = extractFirstJsonObject(text);
        expect(json).toBe('{ "a": 1, "b": { "c": 2 } }');
    });

    test('parseKnowledgeCardDraftFromText returns empty object on non-JSON output', () => {
        const parsed = parseKnowledgeCardDraftFromText('hello');
        expect(Object.keys(parsed).length).toBe(0);
    });
});
