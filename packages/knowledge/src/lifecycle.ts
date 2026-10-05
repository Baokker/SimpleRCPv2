import type { KnowledgeCard, KnowledgeEvolutionEntry } from './schema/card.js';

export interface ConfirmCardOptions {
    memberId: string;
    now: () => number;
    edited?: boolean;
    memberKind?: 'human' | 'agent';
}

export function confirmCard(card: KnowledgeCard, options: ConfirmCardOptions): KnowledgeCard {
    if (!options.memberId.trim()) throw new Error('memberId is required to confirm a knowledge card');
    if (card.status !== 'draft') throw new Error('Only draft knowledge cards can be confirmed');
    if (card.provenance?.author.kind === 'agent' && (options.memberKind ?? 'human') !== 'human') throw new Error('Agent-authored cards require a human confirmer');
    const at = options.now();
    const entry: KnowledgeEvolutionEntry = { at, action: 'confirmed', by: { peerId: options.memberId } };
    return {
        ...card,
        status: 'reviewed',
        review: { ...(card.review ?? { confirmedBy: [] }), confirmedBy: [...new Set([...(card.review?.confirmedBy ?? []), options.memberId])], confirmedAt: at, editedBeforeConfirm: options.edited ?? card.review?.editedBeforeConfirm ?? false },
        updatedAt: at,
        evolution: [...card.evolution, entry]
    };
}

export function isReusable(card: KnowledgeCard, options: { viewerMemberId?: string }): boolean {
    if (card.status !== 'reviewed') return false;
    if (card.scope === 'team') return true;
    if (card.scope !== 'personal' && card.scope !== 'proposedTeam') return false;
    return !!options.viewerMemberId && card.ownerMemberId === options.viewerMemberId;
}

export function appendEvolution(card: KnowledgeCard, entry: KnowledgeEvolutionEntry): KnowledgeCard {
    return { ...card, evolution: [...card.evolution, { ...entry }] };
}
