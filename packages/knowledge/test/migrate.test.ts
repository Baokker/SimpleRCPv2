import { describe, expect, test } from 'vitest';
import { migrateKnowledgeCard } from '../src/schema/migrate.js';

describe('knowledge card migration', () => {
    test('migrates a reviewed v2 event card to a reviewed team v3 card', () => {
        const result = migrateKnowledgeCard({ schemaVersion: 2, id: 'old', type: 'context', title: 'Old', summary: 'Summary', content: 'Content', source: 'event', status: 'reviewed', tags: [], createdAt: 10, updatedAt: 11, metadata: { createdBy: { peerId: 'm1', name: 'Member' }, relatedChatMessageIds: ['msg-1'] }, anchors: [], evolution: [] }, () => 100);
        expect(result.schemaVersion).toBe(3);
        expect(result.provenance?.origin).toBe('human-human');
        expect(result.provenance?.author.memberId).toBe('m1');
        expect(result.provenance?.evidenceRefs.chatMessageIds).toEqual(['msg-1']);
        expect(result.scope).toBe('team');
        expect(result.review?.confirmedBy).toEqual(['m1']);
        expect(result.anchors).toEqual([]);
    });

    test('maps old manual source and missing timestamps using injected clock', () => {
        const result = migrateKnowledgeCard({ schemaVersion: 1, id: 'old', type: 'risk', title: 'Risk', summary: '', content: '', source: 'manual', status: 'draft', tags: [], metadata: {}, anchors: [], evolution: [] }, () => 42);
        expect(result.provenance?.origin).toBe('manual');
        expect(result.createdAt).toBe(42);
        expect(result.updatedAt).toBe(42);
        expect(result.ownerMemberId).toBeUndefined();
    });
});
