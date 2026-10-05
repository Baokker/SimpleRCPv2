// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as path from 'node:path';
import type { KnowledgeCard, KnowledgeCardType } from '../../src/schema/card.js';
import { searchKnowledgeCards, type KnowledgeSearchResult } from '../../src/retrieval/index.js';

export const RETRIEVAL_STRESS_CONDITIONS = ['lexical', 'file-only', 'type-only', 'file+type', 'wrong-file+type'] as const;
export type RetrievalStressCondition = typeof RETRIEVAL_STRESS_CONDITIONS[number];
export type RetrievalQueryCategory = 'lexical-direct' | 'semantic-paraphrase' | 'lexical-collision' | 'file-anchor' | 'type-priority';

interface CardSpec {
    id: string;
    type: 'risk' | 'negative' | 'constraint';
    title: string;
    summary: string;
    rule: string;
    tag: string;
    file: string;
    paraphrase: string;
    collision: string;
}

export interface RetrievalStressQuery {
    id: string;
    targetCardId: string;
    category: RetrievalQueryCategory;
    query: string;
    targetFile: string;
}

export interface RetrievalStressRow {
    queryId: string;
    targetCardId: string;
    category: RetrievalQueryCategory;
    condition: RetrievalStressCondition;
    retrievedCardIds: string[];
    relevantRank: number;
    recallAt1: number;
    recallAt3: number;
    reciprocalRankAt3: number;
    ndcgAt3: number;
    latencyMs: number;
}

export interface RetrievalStressSummaryRow {
    condition: RetrievalStressCondition;
    category: RetrievalQueryCategory | 'overall';
    queries: number;
    recallAt1: number;
    recallAt3: number;
    mrrAt3: number;
    ndcgAt3: number;
    medianLatencyMs: number;
    p95LatencyMs: number;
}

const CARD_SPECS: CardSpec[] = [
    spec('R01', 'constraint', 'Workspace paths stay inside the project root', 'Normalize separators and reject paths that escape the workspace.', 'Reject absolute or parent-escaping paths before filesystem access.', 'path-boundary', 'src/path-policy.ts', 'Do not let a user supplied location reach files above the opened project.', 'Path labels use forward slashes for display only.'),
    spec('R02', 'risk', 'JSON persistence uses atomic replacement', 'Direct writes can destroy the last valid state after interruption.', 'Write a sibling temporary file and rename it over the target.', 'atomic-json', 'src/json-store.ts', 'Keep the previous configuration readable if the process stops halfway through saving.', 'Pretty print JSON snapshots for easier reviews.'),
    spec('R03', 'constraint', 'Knowledge evolution is append only', 'Card updates preserve earlier audit entries.', 'Return a new value and append one evolution record.', 'append-evolution', 'src/card-update.ts', 'A status change must not erase the earlier history or mutate the caller owned card.', 'Timeline items display newest records first.'),
    spec('R04', 'negative', 'Configuration migration preserves unknown fields', 'Rebuilding only known fields previously erased extension metadata.', 'Spread top-level and nested fields before applying defaults.', 'config-migration', 'src/config-migration.ts', 'Upgrade the saved settings without deleting properties owned by plugins.', 'Configuration defaults are centralized in one adapter.'),
    spec('R05', 'risk', 'Pending work is isolated per document', 'A global pending slot caused one file to overwrite another.', 'Store pending values in a map keyed by the document identifier.', 'pending-state', 'src/pending-registry.ts', 'Edits in one tab must not replace deferred work belonging to a different tab.', 'Document tabs share a global activity indicator.'),
    spec('R06', 'negative', 'Embedding failure falls back to lexical retrieval', 'Empty or unusable vectors are not a successful search result.', 'Use lexical results when no finite vector score exists.', 'search-fallback', 'src/search-fallback.ts', 'The search feature should still return cards when the semantic service is unavailable.', 'Vector results are sorted by descending similarity.'),
    spec('R07', 'constraint', 'Inputs remain immutable during card refinement', 'Mutating caller objects makes retries and audit logs inconsistent.', 'Create new nested arrays and objects for every refinement result.', 'immutable-input', 'src/card-refine.ts', 'Do not alter the object supplied by the caller while preparing an improved card.', 'The editor may reuse form state between renders.'),
    spec('R08', 'risk', 'Temporary workspaces are removed after evaluation', 'Interrupted test runs can accumulate large directories.', 'Use try/finally and recursively remove the temporary directory.', 'temp-cleanup', 'test/workspace-fixture.ts', 'Evaluation folders should disappear even when an assertion or import fails.', 'Temporary filenames include the task identifier.'),
    spec('R09', 'negative', 'Serialization failures remain visible', 'Replacing a JSON error with an empty object hides evidence.', 'Propagate the original serialization exception.', 'error-propagation', 'src/serialization.ts', 'A circular value must fail loudly instead of being saved as blank configuration.', 'Developer logs can abbreviate long JSON values.'),
    spec('R10', 'constraint', 'Card identifiers remain stable across edits', 'Allocating a new ID breaks anchors and external references.', 'Preserve id, source, anchors, and creation metadata on update.', 'stable-card-id', 'src/card-status.ts', 'Reviewing or archiving a card must not create a replacement identity.', 'Newly imported cards receive generated identifiers.'),
    spec('R11', 'risk', 'Document keys are normalized at the boundary', 'Mixed URI casing created duplicate pending state.', 'Normalize the URI once before using it as a map key.', 'document-key', 'src/document-key.ts', 'Two spellings of the same editor URI must address one shared state entry.', 'UI labels may preserve the original URI spelling.'),
    spec('R12', 'constraint', 'Prompt retrieval respects the topK budget', 'Unbounded card injection consumes context and hides the task.', 'Sort candidates and retain no more than the configured result limit.', 'topk-budget', 'src/knowledge-prompt.ts', 'Only the highest ranked project notes should enter the model context.', 'The cards sidebar can display every saved card.'),
    spec('R13', 'risk', 'Dependency switches retain compatibility context', 'Replacing a package without rationale repeats earlier integration failures.', 'Record both added and removed packages with the affected file.', 'dependency-switch', 'package.json', 'When one library replaces another, preserve why the change was made and what may break.', 'Dependency lists are sorted alphabetically.'),
    spec('R14', 'constraint', 'Network timeouts always clear their timer', 'Leaked timers keep extension workers alive after requests finish.', 'Clear the abort timeout in a finally block.', 'timeout-cleanup', 'src/request-client.ts', 'A completed or failed model request must not leave a scheduled cancellation behind.', 'Long requests display a progress notification.'),
    spec('R15', 'risk', 'Save debouncing is keyed by document', 'One shared timer dropped captures from concurrently edited files.', 'Maintain independent debounce state for every document key.', 'document-debounce', 'src/save-scheduler.ts', 'Rapid saves in one file must not cancel analysis scheduled for another file.', 'The status bar combines save counts across files.'),
    spec('R16', 'negative', 'Knowledge index cache invalidates on card changes', 'A stale cache returned deleted or outdated cards.', 'Include content hashes in the cache key or rebuild after writes.', 'cache-invalidation', 'src/knowledge-index-cache.ts', 'Search must stop returning an old card after its content changes.', 'Index snapshots are immutable after publication.'),
    spec('R17', 'constraint', 'Unknown schema fields survive round trips', 'Forward-compatible metadata belongs to its originating extension.', 'Parse known fields but preserve unowned values when writing.', 'schema-roundtrip', 'src/schema-migration.ts', 'Opening and saving newer data with an older reader must not erase unfamiliar properties.', 'Validation warnings list unknown field names.'),
    spec('R18', 'risk', 'Malformed cards are excluded from the index', 'Invalid JSON entries previously crashed all workspace searches.', 'Validate each card independently and skip only invalid entries.', 'schema-guard', 'src/card-loader.ts', 'One broken card file should not make every valid knowledge card unavailable.', 'The inbox reports malformed suggestion filenames.'),
    spec('R19', 'negative', 'Duplicate anchor matches require review', 'Choosing the first identical code block can attach knowledge to the wrong copy.', 'Return review-needed when multiple equally valid snapshots exist.', 'duplicate-anchor', 'src/anchor-resolver.ts', 'When the same snippet appears twice, do not silently choose one location.', 'Search results with equal scores keep source order.'),
    spec('R20', 'risk', 'Deleted anchor regions are not relocated blindly', 'A missing target cannot be recovered from unrelated nearby text.', 'Surface manual review when the captured content no longer exists.', 'deleted-anchor', 'src/anchor-review.ts', 'If the referenced code was removed, ask for confirmation instead of attaching the card elsewhere.', 'Deleted cards disappear from the sidebar immediately.'),
    spec('R21', 'constraint', 'Chat evidence keeps stable message identifiers', 'Text-only citations cannot be traced after similar messages appear.', 'Store the source message IDs used by the draft.', 'chat-evidence', 'src/chat-capture.ts', 'A generated knowledge note must identify exactly which conversation messages support it.', 'Chat previews truncate long message bodies.'),
    spec('R22', 'negative', 'API secrets never enter experiment artifacts', 'Model keys in prompts or logs create a credential leak.', 'Pass secrets only through process configuration and redact scans.', 'secret-isolation', 'test/model-runner.ts', 'Generated reports and evaluated code must not contain the model credential.', 'Run manifests record the configured model name.'),
    spec('R23', 'constraint', 'Risk warnings remain non blocking', 'A similarity warning is uncertain and must not prevent saving.', 'Use a dismissible notification and leave the edit under user control.', 'nonblocking-warning', 'src/risk-warning.ts', 'A possible historical pitfall may alert the developer but cannot block the file save.', 'Critical syntax errors use a modal dialog.'),
    spec('R24', 'risk', 'Model changes stay within the allowed file', 'Generated edits to extra paths can damage unrelated project state.', 'Accept exactly one declared target file and reject path escapes.', 'file-boundary', 'test/model-output.ts', 'The coding model may modify only the file named by the task.', 'A patch preview lists every proposed file.'),
];

export const RETRIEVAL_STRESS_CARDS: KnowledgeCard[] = CARD_SPECS.flatMap((item, index) => [
    makeCard(item.id, item.type, item.title, item.summary, item.rule, [item.tag, 'project-knowledge'], item.file),
    makeCard(`D${String(index + 1).padStart(2, '0')}`, distractorType(index), item.collision, `${item.summary} This card is descriptive rather than a binding project rule.`, `Background note: ${item.collision}`, [item.tag, 'background'], `docs/${item.tag}.md`)
]);

export const RETRIEVAL_STRESS_QUERIES: RetrievalStressQuery[] = CARD_SPECS.flatMap(item => [
    query(item, 'lexical-direct', `${item.title}. ${item.tag}`),
    query(item, 'semantic-paraphrase', item.paraphrase),
    query(item, 'lexical-collision', `${item.collision} ${item.tag}`),
    query(item, 'file-anchor', 'Which recorded project rule or pitfall applies to the current change?'),
    query(item, 'type-priority', `${item.collision}. Check the known ${item.type} before changing ${item.tag}.`)
]);

export async function runRetrievalStressBenchmark(): Promise<RetrievalStressRow[]> {
    const indexDir = path.join(process.cwd(), '.test-artifacts', 'oct-retrieval-stress-v1');
    const rows: RetrievalStressRow[] = [];
    for (const item of RETRIEVAL_STRESS_QUERIES) {
        for (const condition of RETRIEVAL_STRESS_CONDITIONS) {
            const activeFile = condition === 'file-only' || condition === 'file+type'
                ? item.targetFile
                : condition === 'wrong-file+type'
                    ? wrongFileFor(item.targetFile)
                    : undefined;
            const started = performance.now();
            const candidates = await searchKnowledgeCards({
                workspaceId: 'retrieval-stress-v1',
                cards: RETRIEVAL_STRESS_CARDS,
                query: item.query,
                activeFile,
                topK: condition === 'lexical' ? 3 : RETRIEVAL_STRESS_CARDS.length,
                embeddings: {},
                indexDir
            });
            const picked = condition !== 'lexical'
                ? [...candidates].sort((a, b) => metadataRank(activeFile, condition.includes('type'), a) - metadataRank(activeFile, condition.includes('type'), b) || b.score - a.score).slice(0, 3)
                : candidates.slice(0, 3);
            const relevantRank = picked.findIndex(card => card.cardId === item.targetCardId) + 1;
            rows.push({
                queryId: item.id,
                targetCardId: item.targetCardId,
                category: item.category,
                condition,
                retrievedCardIds: picked.map(card => card.cardId),
                relevantRank,
                recallAt1: relevantRank === 1 ? 1 : 0,
                recallAt3: relevantRank > 0 ? 1 : 0,
                reciprocalRankAt3: relevantRank > 0 ? 1 / relevantRank : 0,
                ndcgAt3: relevantRank > 0 ? 1 / Math.log2(relevantRank + 1) : 0,
                latencyMs: performance.now() - started
            });
        }
    }
    return rows;
}

export function summarizeRetrievalStress(rows: RetrievalStressRow[]): RetrievalStressSummaryRow[] {
    const categories: Array<RetrievalQueryCategory | 'overall'> = ['overall', 'lexical-direct', 'semantic-paraphrase', 'lexical-collision', 'file-anchor', 'type-priority'];
    const output: RetrievalStressSummaryRow[] = [];
    for (const condition of RETRIEVAL_STRESS_CONDITIONS) {
        for (const category of categories) {
            const selected = rows.filter(row => row.condition === condition && (category === 'overall' || row.category === category));
            const latencies = selected.map(row => row.latencyMs).sort((a, b) => a - b);
            output.push({
                condition,
                category,
                queries: selected.length,
                recallAt1: average(selected.map(row => row.recallAt1)),
                recallAt3: average(selected.map(row => row.recallAt3)),
                mrrAt3: average(selected.map(row => row.reciprocalRankAt3)),
                ndcgAt3: average(selected.map(row => row.ndcgAt3)),
                medianLatencyMs: percentile(latencies, 0.5),
                p95LatencyMs: percentile(latencies, 0.95)
            });
        }
    }
    return output;
}

function metadataRank(activeFile: string | undefined, useTypePriority: boolean, result: KnowledgeSearchResult): number {
    const filePenalty = activeFile && result.files.includes(activeFile) ? 0 : activeFile ? 1000 : 0;
    const typePenalty = useTypePriority && (result.type === 'risk' || result.type === 'negative' || result.type === 'constraint') ? 0 : useTypePriority ? 100 : 0;
    return filePenalty + typePenalty;
}

function query(item: CardSpec, category: RetrievalQueryCategory, text: string): RetrievalStressQuery {
    return { id: `${item.id}-${category}`, targetCardId: item.id, category, query: text, targetFile: item.file };
}

function wrongFileFor(targetFile: string): string {
    const index = CARD_SPECS.findIndex(item => item.file === targetFile);
    return CARD_SPECS[(index + 1) % CARD_SPECS.length].file;
}

function spec(id: string, type: CardSpec['type'], title: string, summary: string, rule: string, tag: string, file: string, paraphrase: string, collision: string): CardSpec {
    return { id, type, title, summary, rule, tag, file, paraphrase, collision };
}

function distractorType(index: number): KnowledgeCardType {
    return (['context', 'tutorial', 'decision'] as const)[index % 3];
}

function makeCard(id: string, type: KnowledgeCardType, title: string, summary: string, content: string, tags: string[], file: string): KnowledgeCard {
    return {
        schemaVersion: 3, id, type, title, summary, content, source: 'manual', status: 'reviewed', tags,
        createdAt: 1, updatedAt: 1, metadata: {},
        anchors: [{ anchorId: `A-${id}`, file: { workspaceRelativePath: file }, associationLevel: 'file', snapshot: { text: title } }],
        evolution: [{ at: 1, action: 'created' }]
    };
}

function average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(sorted: number[], fraction: number): number {
    if (!sorted.length) {
        return 0;
    }
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}
