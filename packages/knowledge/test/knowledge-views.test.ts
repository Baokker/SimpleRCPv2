// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { describe, expect, test } from 'vitest';
import { buildKnowledgeGuideItems, buildKnowledgeTimelineItems } from '../src/knowledge-views.js';
import { LatestSchemaVersion } from '../src/schema.js';
import type { KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from '../src/schema.js';

describe('knowledge guide items', () => {
    test('orders current file cards by guide priority, review status, and recency', () => {
        const cards = [
            makeCard('other-tutorial', 'tutorial', 'src/other.ts', 100, 'reviewed'),
            makeCard('current-risk-new', 'risk', 'src/current.ts', 300, 'reviewed'),
            makeCard('current-tutorial', 'tutorial', 'src/current.ts', 200, 'reviewed'),
            makeCard('current-risk-draft', 'risk', 'src/current.ts', 400, 'draft'),
            makeCard('current-risk-old', 'risk', 'src/current.ts', 250, 'reviewed')
        ];

        const items = buildKnowledgeGuideItems(cards, 'src/current.ts');

        expect(items.map(item => item.card.id)).toEqual([
            'current-tutorial',
            'current-risk-new',
            'current-risk-old',
            'current-risk-draft',
            'other-tutorial'
        ]);
    });
});

describe('knowledge timeline items', () => {
    test('returns current file card events sorted newest first', () => {
        const cards = [
            {
                ...makeCard('current', 'decision', 'src/current.ts', 100, 'reviewed'),
                createdAt: 100,
                updatedAt: 200,
                evolution: [
                    { at: 100, action: 'created' as const },
                    { at: 150, action: 'updated' as const, note: 'Changed summary.' }
                ]
            },
            makeCard('other', 'context', 'src/other.ts', 500, 'reviewed')
        ];

        const items = buildKnowledgeTimelineItems(cards, 'src/current.ts');

        expect(items.map(item => `${item.card.id}:${item.kind}:${item.at}`)).toEqual([
            'current:updated:200',
            'current:evolution:150',
            'current:created:100',
            'current:evolution:100'
        ]);
    });
});

function makeCard(
    id: string,
    type: KnowledgeCardType,
    workspaceRelativePath: string,
    updatedAt: number,
    status: KnowledgeCardStatus
): KnowledgeCard {
    return {
        schemaVersion: LatestSchemaVersion,
        id,
        type,
        title: id,
        summary: '',
        content: '',
        source: 'manual',
        status,
        tags: [],
        createdAt: updatedAt - 10,
        updatedAt,
        metadata: {},
        anchors: [
            {
                anchorId: `${id}-a1`,
                file: { workspaceRelativePath },
                associationLevel: 'block',
                snapshot: { text: id }
            }
        ],
        evolution: [{ at: updatedAt - 10, action: 'created' }]
    };
}
