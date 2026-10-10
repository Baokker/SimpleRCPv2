import MiniSearch from 'minisearch';
import type { KnowledgeIndexEntry } from './index.js';

export const KNOWLEDGE_BM25_PARAMETERS = { k: 1.2, b: 0.7, d: 0.5 } as const;
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function tokenizeKnowledgeBm25(value: string): string[] {
    return (value.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu) ?? [])
        .flatMap(part => /^[a-z0-9_]+$/.test(part)
            ? [part]
            : [...segmenter.segment(part)].filter(item => item.isWordLike).map(item => item.segment))
        .filter(term => term.length >= 2);
}

export function scoreKnowledgeBm25(entries: Pick<KnowledgeIndexEntry, 'cardId' | 'embeddingText'>[], query: string): Map<string, number> {
    const search = new MiniSearch({
        idField: 'cardId',
        fields: ['embeddingText'],
        tokenize: tokenizeKnowledgeBm25,
        searchOptions: {
            bm25: KNOWLEDGE_BM25_PARAMETERS,
            prefix: false,
            fuzzy: false,
            combineWith: 'OR',
            tokenize: value => [...new Set(tokenizeKnowledgeBm25(value))]
        }
    });
    search.addAll([...entries].sort((left, right) => left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0));
    return new Map(search.search(query).map(result => [String(result.id), result.score]));
}
