// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { describe, expect, test } from 'vitest';
import { createDemoKnowledgeCards } from '../src/demo-cards.js';
import { isKnowledgeCard } from '../src/schema.js';

describe('demo knowledge cards', () => {
    test('creates six valid cards covering all process knowledge types', () => {
        const cards = createDemoKnowledgeCards({
            workspaceFolderName: 'demo',
            workspaceRelativePath: 'src/app.ts',
            selectedText: 'const timeoutMs = 200;',
            now: Date.parse('2026-05-25T09:00:00+08:00')
        });

        expect(cards).toHaveLength(6);
        expect(cards.map(card => card.type)).toEqual([
            'decision',
            'constraint',
            'risk',
            'negative',
            'tutorial',
            'context'
        ]);
        expect(cards.every(isKnowledgeCard)).toBe(true);
        expect(cards.every(card => card.id.startsWith('demo-'))).toBe(true);
        expect(cards.every(card => card.anchors[0].file.workspaceRelativePath === 'src/app.ts')).toBe(true);
        expect(cards.some(card => card.type === 'negative' || card.type === 'risk')).toBe(true);
    });

    test('spreads demo cards across a realistic process timeline', () => {
        const cards = createDemoKnowledgeCards({
            workspaceFolderName: 'demo',
            workspaceRelativePath: 'src/app.ts',
            selectedText: 'const timeoutMs = 200;',
            now: Date.parse('2026-05-25T09:00:00+08:00')
        });
        const createdTimes = cards.map(card => card.createdAt);
        const firstCreatedAt = Math.min(...createdTimes);
        const lastCreatedAt = Math.max(...createdTimes);
        const minute = 60 * 1000;

        expect(lastCreatedAt - firstCreatedAt).toBeGreaterThanOrEqual(90 * minute);
        expect(new Set(createdTimes).size).toBe(cards.length);
        expect(cards.some(card => card.updatedAt > card.createdAt)).toBe(true);
        expect(cards.flatMap(card => card.evolution.map(entry => entry.action))).toContain('reviewed');
        expect(cards.every(card => card.evolution.every(entry => entry.at >= card.createdAt && entry.at <= card.updatedAt))).toBe(true);
    });
});
