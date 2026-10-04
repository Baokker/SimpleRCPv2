// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { normalizeWorkspaceRelativePath } from './schema.js';
import type { KnowledgeCard, KnowledgeEvolutionEntry } from './schema.js';

export interface KnowledgeGuideItem {
    card: KnowledgeCard;
    isCurrentFile: boolean;
}

export interface KnowledgeTimelineItem {
    card: KnowledgeCard;
    kind: 'created' | 'updated' | 'evolution';
    at: number;
    label: string;
    evolution?: KnowledgeEvolutionEntry;
}

const typePriority = new Map<string, number>([
    ['tutorial', 0],
    ['decision', 1],
    ['constraint', 2],
    ['risk', 3],
    ['negative', 4],
    ['context', 5]
]);

export function buildKnowledgeGuideItems(cards: KnowledgeCard[], currentFile?: string): KnowledgeGuideItem[] {
    const currentRel = normalizeWorkspaceRelativePath(currentFile ?? '');
    return cards
        .map(card => ({ card, isCurrentFile: isAnchoredToFile(card, currentRel) }))
        .sort((a, b) => {
            if (a.isCurrentFile !== b.isCurrentFile) {
                return a.isCurrentFile ? -1 : 1;
            }
            const typeDelta = (typePriority.get(a.card.type) ?? 99) - (typePriority.get(b.card.type) ?? 99);
            if (typeDelta !== 0) {
                return typeDelta;
            }
            const aReviewed = a.card.status === 'reviewed';
            const bReviewed = b.card.status === 'reviewed';
            if (aReviewed !== bReviewed) {
                return aReviewed ? -1 : 1;
            }
            return b.card.updatedAt - a.card.updatedAt;
        });
}

export function buildKnowledgeTimelineItems(cards: KnowledgeCard[], currentFile?: string): KnowledgeTimelineItem[] {
    const currentRel = normalizeWorkspaceRelativePath(currentFile ?? '');
    const filtered = currentRel ? cards.filter(card => isAnchoredToFile(card, currentRel)) : cards;
    const items: KnowledgeTimelineItem[] = [];

    for (const card of filtered) {
        items.push({
            card,
            kind: 'created',
            at: card.createdAt,
            label: `Created: ${card.title}`
        });
        if (card.updatedAt !== card.createdAt) {
            items.push({
                card,
                kind: 'updated',
                at: card.updatedAt,
                label: `Updated: ${card.title}`
            });
        }
        for (const evolution of card.evolution ?? []) {
            items.push({
                card,
                kind: 'evolution',
                at: evolution.at,
                label: `${evolution.action}: ${card.title}`,
                evolution
            });
        }
    }

    return items.sort((a, b) => b.at - a.at);
}

function isAnchoredToFile(card: KnowledgeCard, currentRel: string): boolean {
    if (!currentRel) {
        return false;
    }
    return (card.anchors ?? []).some(anchor => normalizeWorkspaceRelativePath(anchor.file?.workspaceRelativePath ?? '') === currentRel);
}
