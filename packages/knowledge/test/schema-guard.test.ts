import { describe, expect, test } from 'vitest';
import { isKnowledgeCard, LatestSchemaVersion } from '../src/schema/card.js';

describe('knowledge card guard', () => {
    test('rejects non-object', () => {
        expect(isKnowledgeCard(undefined)).toBe(false);
        expect(isKnowledgeCard(null)).toBe(false);
        expect(isKnowledgeCard('x')).toBe(false);
    });

    test('accepts minimal valid object shape', () => {
        const card = {
            schemaVersion: LatestSchemaVersion,
            id: 'k1',
            type: 'context',
            title: 't',
            summary: '',
            content: '',
            source: 'manual',
            status: 'reviewed',
            tags: [],
            createdAt: 1,
            updatedAt: 1,
            metadata: {},
            anchors: [
                {
                    anchorId: 'a1',
                    file: { workspaceRelativePath: 'src/a.ts' },
                    associationLevel: 'block',
                    snapshot: { text: 'x' }
                }
            ],
            evolution: []
        };
        expect(isKnowledgeCard(card)).toBe(true);
    });

    test('accepts evolution entries with an actor and rejects malformed actors', () => {
        const base = {
            schemaVersion: LatestSchemaVersion,
            id: 'k2',
            type: 'context',
            title: 't',
            summary: '',
            content: '',
            source: 'manual',
            status: 'reviewed',
            tags: [],
            createdAt: 1,
            updatedAt: 1,
            metadata: {},
            anchors: [],
            evolution: [{ at: 2, action: 'confirmed', by: { peerId: 'member-1', name: 'Member' } }]
        };
        expect(isKnowledgeCard(base)).toBe(true);
        expect(isKnowledgeCard({ ...base, evolution: [{ at: 2, action: 'confirmed', by: { peerId: 4 } }] })).toBe(false);
    });
});
