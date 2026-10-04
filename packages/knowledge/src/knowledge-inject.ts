import { searchKnowledgeCards } from './knowledge-index.js';
import type { KnowledgeSearchResult, SearchKnowledgeCardsOptions } from './knowledge-index.js';
import { isReusable } from './lifecycle.js';
import type { KnowledgeCard } from './schema.js';

export interface KnowledgeInjectionItem { id: string; score: number; mode: 'vector' | 'lexical'; chars: number; reason: string; }
export interface KnowledgeInjectionResult { text: string; cards: KnowledgeInjectionItem[]; }
export interface BuildKnowledgeContextOptions extends Omit<SearchKnowledgeCardsOptions, 'query'> { query: string; maxCharsPerCard?: number; maxTotalChars?: number; filter?: (card: KnowledgeCard) => boolean; }

export async function buildKnowledgeContext(options: BuildKnowledgeContextOptions): Promise<KnowledgeInjectionResult> {
    const results = await searchKnowledgeCards(options);
    const cards = options.cards ?? [];
    const reusable = options.filter ?? ((card: KnowledgeCard) => isReusable(card, { viewerMemberId: options.viewerMemberId }));
    const allowed = cards.length ? new Set(cards.filter(reusable).map(card => card.id)) : undefined;
    const filtered = allowed ? results.filter(result => allowed.has(result.cardId)) : results.filter(result => result.status === 'reviewed' && (result.scope === 'team' || (!!options.viewerMemberId && result.ownerMemberId === options.viewerMemberId)));
    return pickCardsWithinBudget(filtered, options.maxCharsPerCard ?? 800, options.maxTotalChars ?? 5_000);
}

export function pickCardsWithinBudget(results: KnowledgeSearchResult[], maxCharsPerCard: number, maxTotalChars: number): KnowledgeInjectionResult {
    const priority = (type: string): number => type === 'negative' || type === 'risk' || type === 'constraint' ? 0 : type === 'decision' || type === 'context' ? 1 : 2;
    const sorted = [...results].sort((a, b) => priority(a.type) - priority(b.type) || b.score - a.score);
    const selected: KnowledgeInjectionItem[] = [];
    const lines: string[] = [`---PROJECT KNOWLEDGE CARDS (topK=${Math.min(sorted.length, 25)}):`];
    let budget = maxTotalChars;
    for (const result of sorted) {
        const excerpt = truncate(result.excerpt, maxCharsPerCard);
        const chars = excerpt.length + 220;
        if (chars > budget && selected.length) continue;
        selected.push({ id: result.cardId, score: result.score, mode: result.mode, chars: excerpt.length, reason: `${result.type}/${result.status}` });
        lines.push('', `[${selected.length}] (${result.mode}, score=${Number.isFinite(result.score) ? result.score.toFixed(3) : String(result.score)}) ${result.type}/${result.status} ${result.title} (cardId=${result.cardId})`);
        if (result.summary.trim()) lines.push(`summary: ${singleLine(result.summary, 220)}`);
        if (result.tags.length) lines.push(`tags: ${result.tags.slice(0, 16).join(', ')}`);
        if (result.files.length) lines.push(`files: ${result.files.slice(0, 8).join(', ')}`);
        lines.push('content:', excerpt);
        budget -= chars;
        if (budget <= 0) break;
    }
    return { text: selected.length ? lines.join('\n').trim() : '', cards: selected };
}

function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`; }
function singleLine(value: string, max: number): string { return truncate(value.replace(/\s+/g, ' ').trim(), max); }
