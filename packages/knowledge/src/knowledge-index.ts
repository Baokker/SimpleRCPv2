import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isKnowledgeCard, normalizeWorkspaceRelativePath } from './schema.js';
import type { KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from './schema.js';
import { resolveNow } from './clock.js';
import { migrateKnowledgeCard } from './migrate.js';

export type KnowledgeSearchMode = 'vector' | 'lexical';
export interface EmbeddingsConfig { client?: { embed(texts: string[]): Promise<number[][]> }; timeoutMs?: number; model?: string; }
export interface KnowledgeIndexEntry { cardId: string; type: KnowledgeCardType; status: KnowledgeCardStatus; scope?: KnowledgeCard['scope']; ownerMemberId?: string; title: string; summary: string; tags: string[]; files: string[]; embeddingTextHash: string; embeddingText: string; vector?: number[]; }
export interface KnowledgeIndex { schemaVersion: 3; workspaceRoot: string; workspaceHash: string; embeddingModel: string; updatedAt: number; entries: KnowledgeIndexEntry[]; }
export interface EnsureKnowledgeIndexOptions { workspaceRoot?: string; workspaceId?: string; cards?: KnowledgeCard[]; cardsDirectory?: string; embeddings?: EmbeddingsConfig; indexDir?: string; forceRebuild?: boolean; now?: () => number; }
export interface KnowledgeSearchFilters { types?: KnowledgeCardType[]; statuses?: KnowledgeCardStatus[]; }
export interface SearchKnowledgeCardsOptions extends EnsureKnowledgeIndexOptions { query: string; activeFile?: string; selectionText?: string; filters?: KnowledgeSearchFilters; topK?: number; viewerMemberId?: string; }
export interface KnowledgeSearchResult { cardId: string; score: number; mode: KnowledgeSearchMode; type: KnowledgeCardType; status: KnowledgeCardStatus; scope?: KnowledgeCard['scope']; ownerMemberId?: string; title: string; summary: string; tags: string[]; files: string[]; excerpt: string; }

const DEFAULT_EMBEDDINGS_MODEL = 'text-embedding-v4';
const MAX_EMBEDDING_TEXT_CHARS = 12_000;
const INDEX_TTL_MS = 60_000;
const indexBuildLocks = new Map<string, Promise<KnowledgeIndex>>();
let lastIndexCacheKey: string | undefined;
let lastIndexCache: KnowledgeIndex | undefined;

export async function ensureKnowledgeIndex(options: EnsureKnowledgeIndexOptions = {}): Promise<KnowledgeIndex> {
    const sourceId = resolveSourceId(options);
    const root = options.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined;
    const model = options.embeddings?.model?.trim() || DEFAULT_EMBEDDINGS_MODEL;
    const indexDir = resolveIndexDir(options.indexDir);
    const cards = await readKnowledgeCards(options, root);
    const cardsHash = hashIndexedCardContent(cards);
    const workspaceHash = sha256Hex(sourceId);
    const cacheKey = `${workspaceHash}::${model}::${indexDir}::${cardsHash}`;
    const now = resolveNow(options.now);
    if (!options.forceRebuild && lastIndexCacheKey === cacheKey && lastIndexCache && now - lastIndexCache.updatedAt >= 0 && now - lastIndexCache.updatedAt < INDEX_TTL_MS) return lastIndexCache;
    const existing = indexBuildLocks.get(cacheKey);
    if (existing) return existing;
    const lock = buildIndex({ ...options, workspaceRoot: root, cards }, sourceId, workspaceHash, model, indexDir, now, cacheKey).finally(() => indexBuildLocks.delete(cacheKey));
    indexBuildLocks.set(cacheKey, lock);
    return lock;
}

async function buildIndex(options: EnsureKnowledgeIndexOptions, sourceId: string, workspaceHash: string, model: string, indexDir: string, now: number, cacheKey: string): Promise<KnowledgeIndex> {
    const indexPath = path.join(indexDir, `${workspaceHash}-schema3-${sanitizeFilename(model)}.json`);
    const previous = options.forceRebuild ? undefined : await readIndexFile(indexPath);
    const previousById = new Map((previous?.entries ?? []).map(entry => [entry.cardId, entry]));
    const cards = options.cards ?? [];
    const entries: KnowledgeIndexEntry[] = [];
    for (const card of cards) {
        const embeddingText = buildEmbeddingText(card);
        const entry: KnowledgeIndexEntry = { cardId: card.id, type: card.type, status: card.status, scope: card.scope, ownerMemberId: card.ownerMemberId, title: card.title, summary: card.summary, tags: card.tags.slice(0, 64), files: extractCardFiles(card), embeddingTextHash: sha256Hex(embeddingText), embeddingText, vector: previousById.get(card.id)?.embeddingTextHash === sha256Hex(embeddingText) ? previousById.get(card.id)?.vector : undefined };
        entries.push(entry);
    }
    if (options.embeddings?.client && entries.some(entry => !entry.vector)) {
        try {
            const vectors = await options.embeddings.client.embed(entries.filter(entry => !entry.vector).map(entry => entry.embeddingText));
            let cursor = 0;
            for (const entry of entries) if (!entry.vector) entry.vector = vectors[cursor++] ?? undefined;
        } catch {
            // 向量检索失败时使用词法分数。
        }
    }
    const index: KnowledgeIndex = { schemaVersion: 3, workspaceRoot: sourceId, workspaceHash, embeddingModel: model, updatedAt: now, entries };
    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(index, undefined, 2), 'utf8');
    lastIndexCacheKey = cacheKey;
    lastIndexCache = index;
    return index;
}

export async function searchKnowledgeCards(options: SearchKnowledgeCardsOptions): Promise<KnowledgeSearchResult[]> {
    const query = String(options.query ?? '').trim();
    if (!query) return [];
    const index = await ensureKnowledgeIndex(options);
    const entries = applyFilters(index.entries, options.filters);
    const activeFiles = normalizeActiveFileCandidates(options.activeFile);
    const queryText = buildQueryText(query, String(options.selectionText ?? '').trim(), activeFiles[0]);
    const topK = clampInt(options.topK ?? 5, 1, 25);
    if (options.embeddings?.client && entries.some(entry => Array.isArray(entry.vector) && entry.vector.length)) {
        try {
            const queryVector = (await options.embeddings.client.embed([queryText]))[0];
            if (queryVector?.length) return entries.filter(entry => entry.vector?.length === queryVector.length).map(entry => ({ entry, score: cosineSimilarity(queryVector, entry.vector!) + activeFileBoost(entry, activeFiles) })).sort((a, b) => b.score - a.score).slice(0, topK).map(({ entry, score }) => toResult(entry, score, 'vector'));
        } catch {
            // 向量检索失败时保留确定性的词法检索。
        }
    }
    const tokens = tokenize(queryText);
    return entries.map(entry => ({ entry, score: lexicalScore(tokens, entry.embeddingText, entry.files, activeFiles) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, topK).map(({ entry, score }) => toResult(entry, score, 'lexical'));
}

function resolveSourceId(options: EnsureKnowledgeIndexOptions): string { return options.workspaceId?.trim() || (options.workspaceRoot ? path.resolve(options.workspaceRoot) : options.cards ? 'cards:in-memory' : process.cwd()); }
function resolveIndexDir(explicit?: string): string { return path.resolve(explicit?.trim() || path.join(process.cwd(), '.knowledge-index')); }
async function readKnowledgeCards(options: EnsureKnowledgeIndexOptions, _root?: string): Promise<KnowledgeCard[]> { if (options.cards) return options.cards.filter(isKnowledgeCard); if (!options.cardsDirectory) return []; return readWorkspaceKnowledgeCards(path.resolve(options.cardsDirectory), options.now); }
async function readWorkspaceKnowledgeCards(cardsDir: string, now?: () => number): Promise<KnowledgeCard[]> { let names: string[]; try { names = await fs.readdir(cardsDir); } catch { return []; } const cards: KnowledgeCard[] = []; for (const name of names.filter(item => item.toLowerCase().startsWith('card-') && item.toLowerCase().endsWith('.json'))) { try { const parsed = JSON.parse(await fs.readFile(path.join(cardsDir, name), 'utf8')) as Record<string, unknown>; const candidate = parsed.schemaVersion === 1 || parsed.schemaVersion === 2 ? migrateKnowledgeCard(parsed, now) : parsed; if (isKnowledgeCard(candidate)) cards.push(candidate); } catch { /* 忽略无效卡片文件。 */ } } return cards; }
async function readIndexFile(filePath: string): Promise<KnowledgeIndex | undefined> { try { const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as KnowledgeIndex; return parsed?.schemaVersion === 3 && Array.isArray(parsed.entries) ? parsed : undefined; } catch { return undefined; } }
function buildEmbeddingText(card: KnowledgeCard): string { const files = extractCardFiles(card).join(' '); return [`type:${card.type}`, `status:${card.status}`, card.title, card.summary, card.tags.join(' '), files, card.content].join('\n').slice(0, MAX_EMBEDDING_TEXT_CHARS); }
function extractCardFiles(card: KnowledgeCard): string[] { return [...new Set(card.anchors.map(anchor => normalizeWorkspaceRelativePath(anchor.file.workspaceRelativePath)).filter(Boolean))]; }
function hashIndexedCardContent(cards: KnowledgeCard[]): string { return sha256Hex(cards.map(card => `${card.id}:${card.updatedAt}:${card.title}:${card.summary}:${card.content}:${card.status}`).sort().join('\n')); }
function sha256Hex(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function sanitizeFilename(value: string): string { return value.replace(/[^A-Za-z0-9_.-]+/g, '_'); }
function applyFilters(entries: KnowledgeIndexEntry[], filters?: KnowledgeSearchFilters): KnowledgeIndexEntry[] { return entries.filter(entry => (!filters?.types?.length || filters.types.includes(entry.type)) && (!filters?.statuses?.length || filters.statuses.includes(entry.status))); }
function normalizeActiveFileCandidates(activeFile?: string): string[] { const value = normalizeWorkspaceRelativePath(activeFile ?? ''); return value ? [value] : []; }
function buildQueryText(query: string, selectionText: string, activeFile?: string): string { return [query, selectionText, activeFile].filter(Boolean).join('\n'); }
function tokenize(value: string): string[] { return (value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).filter(Boolean); }
function lexicalScore(queryTokens: string[], text: string, files: string[], activeFiles: string[]): number { const haystack = text.toLowerCase(); const exactTokens = new Set(tokenize(haystack)); let score = 0; for (const token of queryTokens) if (token.length >= 2 && haystack.includes(token)) score += exactTokens.has(token) ? (token.length >= 6 ? 0.25 : 0.16) + 0.03 : 0.05; if (queryTokens[0] && exactTokens.has(queryTokens[0])) score += 0.1; score += activeFileBoost({ files } as KnowledgeIndexEntry, activeFiles); return Math.min(1.2, score); }
function activeFileBoost(entry: Pick<KnowledgeIndexEntry, 'files'>, activeFiles: string[]): number { return activeFiles.some(file => entry.files.includes(file)) ? 0.2 : 0; }
function cosineSimilarity(a: number[], b: number[]): number { let dot = 0; let aa = 0; let bb = 0; for (let i = 0; i < a.length; i++) { const av = a[i] ?? 0; const bv = b[i] ?? 0; dot += av * bv; aa += av * av; bb += bv * bv; } return aa && bb ? dot / Math.sqrt(aa * bb) : 0; }
function toResult(entry: KnowledgeIndexEntry, score: number, mode: KnowledgeSearchMode): KnowledgeSearchResult { return { cardId: entry.cardId, score, mode, type: entry.type, status: entry.status, scope: entry.scope, ownerMemberId: entry.ownerMemberId, title: entry.title, summary: entry.summary, tags: entry.tags, files: entry.files, excerpt: entry.embeddingText.slice(0, 2_000) }; }
function clampInt(value: number, min: number, max: number): number { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
