import { describe, expect, test } from 'vitest';
import { appendEvolution, confirmCard, isReusable } from '../src/lifecycle.js';
import { LatestSchemaVersion, type KnowledgeCard } from '../src/schema.js';

function card(overrides: Partial<KnowledgeCard> = {}): KnowledgeCard {
    return { schemaVersion: LatestSchemaVersion, id: 'c1', type: 'decision', title: 'Decision', summary: 'Summary', content: 'Content', source: 'event', status: 'draft', tags: [], createdAt: 1, updatedAt: 1, metadata: {}, provenance: { origin: 'human-agent', author: { kind: 'agent', agentRunId: 'run-1' }, evidenceRefs: {} }, scope: 'personal', ownerMemberId: 'm1', anchors: [], evolution: [{ at: 1, action: 'created' },], ...overrides };
}

describe('knowledge lifecycle', () => {
    test('confirms a draft with a human and appends confirmed evolution', () => {
        const result = confirmCard(card(), { memberId: 'm2', now: () => 20, edited: true });
        expect(result.status).toBe('reviewed');
        expect(result.review?.confirmedBy).toEqual(['m2']);
        expect(result.review?.confirmedAt).toBe(20);
        expect(result.evolution.at(-1)?.action).toBe('confirmed');
    });

    test('reuses only reviewed cards within their scope', () => {
        expect(isReusable(card({ status: 'draft' }), { viewerMemberId: 'm1' })).toBe(false);
        expect(isReusable(card({ status: 'reviewed', scope: 'team' }), { viewerMemberId: 'other' })).toBe(true);
        expect(isReusable(card({ status: 'reviewed', scope: 'personal', ownerMemberId: 'm1' }), { viewerMemberId: 'm1' })).toBe(true);
        expect(isReusable(card({ status: 'reviewed', scope: 'personal', ownerMemberId: 'm1' }), { viewerMemberId: 'other' })).toBe(false);
        expect(isReusable(card({ status: 'reviewed', scope: undefined, ownerMemberId: 'm1' }), { viewerMemberId: 'm1' })).toBe(false);
    });

    test('appendEvolution returns a new card', () => {
        const original = card();
        const result = appendEvolution(original, { at: 4, action: 'recurrence' });
        expect(result).not.toBe(original);
        expect(original.evolution).toHaveLength(1);
        expect(result.evolution).toHaveLength(2);
    });

    test('rejects confirmation from an Agent and non-draft cards', () => {
        expect(() => confirmCard(card(), { memberId: 'agent-1', memberKind: 'agent', now: () => 20 })).toThrow('human confirmer');
        expect(() => confirmCard(card({ status: 'reviewed' }), { memberId: 'm2', now: () => 20 })).toThrow('Only draft');
    });
});
