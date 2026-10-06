// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { extractFirstJsonObject, extractKnowledgeCardDraft, parseKnowledgeCardDraftFromText } from '../src/extract/extract.js';

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

    test('extractFirstJsonObject requires a strict JSON object response', () => {
        const text = 'noise\n{ "a": 1, "b": { "c": 2 } }\ntrailing';
        expect(extractFirstJsonObject(text)).toBeUndefined();
    });

    test('extractFirstJsonObject removes MiniMax reasoning blocks', () => {
        expect(extractFirstJsonObject('<think>internal reasoning</think>{"ok":true}')).toBe('{"ok":true}');
    });

    test('parseKnowledgeCardDraftFromText returns empty object on non-JSON output', () => {
        const parsed = parseKnowledgeCardDraftFromText('hello');
        expect(Object.keys(parsed).length).toBe(0);
    });

    test('extractKnowledgeCardDraft validates the production extraction path', async () => {
        const draft = await extractKnowledgeCardDraft({
            triggerType: 'chat.dense',
            suggestedType: 'decision',
            suggestedTitle: 'Bounded retries',
            evidence: { chatMessages: [{ id: 'm1', text: 'Keep EVID-CHAT-01 retries bounded.' }] },
            projectHints: { mustMention: ['EVID-CHAT-01'] }
        }, {
            model: 'deepseek-chat',
            client: { complete: async () => ({ text: JSON.stringify({
                type: 'decision',
                title: 'Bounded retries',
                summary: 'Keep EVID-CHAT-01 retries bounded in this workflow.',
                content: 'The evidence supports bounded retries and preserving the original error for later inspection.',
                tags: ['retry'],
                confidence: 0.9,
                evidenceCitations: ['evidence.chatMessages[0].text'],
                unknowns: []
            }) }) }
        });
        expect(draft.type).toBe('decision');
        expect(draft.evidenceCitations).toEqual(['evidence.chatMessages[0].text']);
        expect(draft.content).toContain('## Evidence');
    });
});
