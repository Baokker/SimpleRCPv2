import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isKnowledgeCard, normalizeWorkspaceRelativePath } from '../schema/card.js';
import type { KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from '../schema/card.js';
import { resolveNow } from '../clock.js';
import { migrateKnowledgeCard } from '../schema/migrate.js';

export type KnowledgeSearchMode = 'vector' | 'lexical';
export interface EmbeddingsConfig { client?: { embed(texts: string[]): Promise<number[][]> }; timeoutMs?: number; model?: string; }
export interface KnowledgeIndexEntry { cardId: string; type: KnowledgeCardType; status: KnowledgeCardStatus; scope?: KnowledgeCard['scope']; ownerMemberId?: string; title: string; summary: string; tags: string[]; files: string[]; embeddingTextHash: string; embeddingText: string; vector?: number[]; }
export interface KnowledgeIndex { schemaVersion: 3; workspaceRoot: string; workspaceHash: string; embeddingModel: string; updatedAt: number; entries: KnowledgeIndexEntry[]; embeddingFallbackReason?: string; }
export interface EnsureKnowledgeIndexOptions { workspaceRoot?: string; workspaceId?: string; cards?: unknown[]; cardsDirectory?: string; embeddings?: EmbeddingsConfig; indexDir: string; forceRebuild?: boolean; now?: () => number; strictEmbedding?: boolean; }
export interface KnowledgeSearchFilters { types?: KnowledgeCardType[]; statuses?: KnowledgeCardStatus[]; }
export interface SearchKnowledgeCardsOptions extends EnsureKnowledgeIndexOptions { query: string; activeFile?: string; selectionText?: string; filters?: KnowledgeSearchFilters; topK?: number; viewerMemberId?: string; lexicalScoring?: 'legacy' | 'exact-boost'; }
export interface KnowledgeSearchResult { cardId: string; score: number; mode: KnowledgeSearchMode; type: KnowledgeCardType; status: KnowledgeCardStatus; scope?: KnowledgeCard['scope']; ownerMemberId?: string; title: string; summary: string; tags: string[]; files: string[]; excerpt: string; fallbackReason?: string; }

const DEFAULT_EMBEDDINGS_MODEL = 'text-embedding-v4';
const MAX_EMBEDDING_TEXT_CHARS = 12_000;
const INDEX_TTL_MS = 60_000;
const indexBuildLocks = new Map<string, Promise<KnowledgeIndex>>();
let lastIndexCacheKey: string | undefined;
let lastIndexCache: KnowledgeIndex | undefined;

export async function ensureKnowledgeIndex(options: EnsureKnowledgeIndexOptions): Promise<KnowledgeIndex> {
    const sourceId = resolveSourceId(options);
    const model = options.embeddings?.model?.trim() || DEFAULT_EMBEDDINGS_MODEL;
    const indexDir = resolveIndexDir(options.indexDir);
    const cards = await loadKnowledgeCards(options);
    const cardsHash = hashIndexedCardContent(cards);
    const workspaceHash = sha256Hex(sourceId);
    const cacheKey = `${workspaceHash}::${model}::${indexDir}::${cardsHash}`;
    const now = resolveNow(options.now);
    if (!options.forceRebuild && lastIndexCacheKey === cacheKey && lastIndexCache && now - lastIndexCache.updatedAt >= 0 && now - lastIndexCache.updatedAt < INDEX_TTL_MS) {
        if (options.strictEmbedding && lastIndexCache.embeddingFallbackReason) throw new Error(lastIndexCache.embeddingFallbackReason);
        return lastIndexCache;
    }
    const existing = indexBuildLocks.get(cacheKey);
    if (existing) {
        const index = await existing;
        if (options.strictEmbedding && index.embeddingFallbackReason) throw new Error(index.embeddingFallbackReason);
        return index;
    }
    const lock = buildIndex({ ...options, cards }, sourceId, workspaceHash, model, indexDir, now, cacheKey).finally(() => indexBuildLocks.delete(cacheKey));
    indexBuildLocks.set(cacheKey, lock);
    return lock;
}

async function buildIndex(options: EnsureKnowledgeIndexOptions & { cards: KnowledgeCard[] }, sourceId: string, workspaceHash: string, model: string, indexDir: string, now: number, cacheKey: string): Promise<KnowledgeIndex> {
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
    let embeddingFallbackReason: string | undefined;
    if (options.embeddings?.client && entries.some(entry => !entry.vector)) {
        try {
            const vectors = await options.embeddings.client.embed(entries.filter(entry => !entry.vector).map(entry => entry.embeddingText));
            const missingEntries = entries.filter(entry => !entry.vector);
            if (vectors.length !== missingEntries.length) throw new Error(`Embedding client returned ${vectors.length} vectors for ${missingEntries.length} texts`);
            let cursor = 0;
            for (const entry of entries) if (!entry.vector) entry.vector = vectors[cursor++] ?? undefined;
        } catch (error) {
            if (options.strictEmbedding) throw error;
            embeddingFallbackReason = error instanceof Error ? error.message : String(error);
            for (const entry of entries) entry.vector = undefined;
        }
    }
    const index: KnowledgeIndex = { schemaVersion: 3, workspaceRoot: sourceId, workspaceHash, embeddingModel: model, updatedAt: now, entries, ...(embeddingFallbackReason ? { embeddingFallbackReason } : {}) };
    await fs.mkdir(indexDir, { recursive: true });
    const nextPath = `${indexPath}.${randomUUID()}.next`;
    await fs.writeFile(nextPath, JSON.stringify(index, undefined, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(nextPath, indexPath);
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
    let fallbackReason = options.embeddings?.client ? index.embeddingFallbackReason : undefined;
    if (options.embeddings?.client && entries.some(entry => Array.isArray(entry.vector) && entry.vector.length)) {
        try {
            const queryVector = (await options.embeddings.client.embed([queryText]))[0];
            if (!queryVector?.length) throw new Error('Embedding client returned an empty query vector');
            return entries.filter(entry => entry.vector?.length === queryVector.length).map(entry => ({ entry, score: cosineSimilarity(queryVector, entry.vector!) + activeFileBoost(entry, activeFiles) })).sort((a, b) => b.score - a.score).slice(0, topK).map(({ entry, score }) => toResult(entry, score, 'vector'));
        } catch (error) {
            if (options.strictEmbedding) throw error;
            fallbackReason = error instanceof Error ? error.message : String(error);
        }
    }
    const tokens = tokenize(queryText);
    const lexicalScoring = options.lexicalScoring ?? 'legacy';
    return entries.map(entry => ({ entry, score: lexicalScore(tokens, entry.embeddingText, entry.files, activeFiles, lexicalScoring) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, topK).map(({ entry, score }) => toResult(entry, score, 'lexical', fallbackReason));
}

function resolveSourceId(options: EnsureKnowledgeIndexOptions): string { return options.workspaceId?.trim() || (options.workspaceRoot ? path.resolve(options.workspaceRoot) : options.cards ? 'cards:in-memory' : process.cwd()); }
function resolveIndexDir(explicit: string): string {
    const value = String(explicit ?? '').trim();
    if (!value) throw new Error('indexDir is required when building a knowledge index');
    return path.resolve(value);
}
export async function loadKnowledgeCards(options: EnsureKnowledgeIndexOptions): Promise<KnowledgeCard[]> {
    if (options.cards) return options.cards.flatMap(card => normalizeCard(card, options.now));
    if (!options.cardsDirectory) return [];
    return readWorkspaceKnowledgeCards(path.resolve(options.cardsDirectory), options.now);
}
async function readWorkspaceKnowledgeCards(cardsDir: string, now?: () => number): Promise<KnowledgeCard[]> {
    let names: string[];
    try {
        names = await fs.readdir(cardsDir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
    const cards: KnowledgeCard[] = [];
    for (const name of names.filter(item => item.toLowerCase().endsWith('.json'))) {
        const text = await fs.readFile(path.join(cardsDir, name), 'utf8');
        cards.push(...normalizeCard(JSON.parse(text) as unknown, now));
    }
    return cards;
}
function normalizeCard(value: unknown, now?: () => number): KnowledgeCard[] {
    if (isKnowledgeCard(value)) return [value];
    if (value && typeof value === 'object' && (((value as Record<string, unknown>).schemaVersion === 1) || ((value as Record<string, unknown>).schemaVersion === 2))) {
        const migrated = migrateKnowledgeCard(value, now);
        if (!isKnowledgeCard(migrated)) throw new Error('Migrated knowledge card failed schema validation');
        return [migrated];
    }
    throw new Error('Knowledge card failed schema validation');
}
async function readIndexFile(filePath: string): Promise<KnowledgeIndex | undefined> {
    let text: string;
    try {
        text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
    const parsed = JSON.parse(text) as KnowledgeIndex;
    return parsed?.schemaVersion === 3 && Array.isArray(parsed.entries) ? parsed : undefined;
}
function buildEmbeddingText(card: KnowledgeCard): string {
    const parts: string[] = [];
    const add = (label: string, value: string) => {
        const normalized = String(value ?? '').trim();
        if (normalized) parts.push(`${label}: ${normalized}`);
    };
    add('title', card.title);
    add('summary', card.summary);
    if (card.tags.length) add('tags', card.tags.slice(0, 32).join(', '));
    if (card.content.trim()) parts.push(`\n---\n${card.content.trim()}`);
    const files = extractCardFiles(card);
    if (files.length) add('files', files.join(', '));
    const firstSnapshot = card.anchors[0]?.snapshot.text ?? '';
    const snapshot = firstSnapshot.length > 2_000 ? firstSnapshot.slice(0, 2_000) : firstSnapshot;
    if (snapshot.trim()) parts.push(`\n---\n${snapshot.trim()}`);
    return parts.join('\n').trim().slice(0, MAX_EMBEDDING_TEXT_CHARS);
}
function extractCardFiles(card: KnowledgeCard): string[] { return [...new Set(card.anchors.map(anchor => normalizeWorkspaceRelativePath(anchor.file.workspaceRelativePath)).filter(Boolean))]; }
function hashIndexedCardContent(cards: KnowledgeCard[]): string {
    return sha256Hex(JSON.stringify(cards.map(card => ({
        id: card.id,
        type: card.type,
        status: card.status,
        scope: card.scope,
        ownerMemberId: card.ownerMemberId,
        tags: card.tags.slice(0, 64),
        files: extractCardFiles(card),
        embeddingText: buildEmbeddingText(card)
    }))));
}
function sha256Hex(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function sanitizeFilename(value: string): string { return value.replace(/[^A-Za-z0-9_.-]+/g, '_'); }
function applyFilters(entries: KnowledgeIndexEntry[], filters?: KnowledgeSearchFilters): KnowledgeIndexEntry[] { return entries.filter(entry => (!filters?.types?.length || filters.types.includes(entry.type)) && (!filters?.statuses?.length || filters.statuses.includes(entry.status))); }
function normalizeActiveFileCandidates(activeFile?: string): string[] {
    const value = String(activeFile ?? '').trim();
    if (!value) return [];
    const normalized = normalizeWorkspaceRelativePath(value);
    const candidates = new Set<string>();
    if (normalized) candidates.add(normalized);
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2) candidates.add(parts.slice(1).join('/'));
    return [...candidates].filter(Boolean);
}
function buildQueryText(query: string, selectionText: string, activeFile?: string): string {
    const parts = [query];
    if (activeFile) parts.push(`activeFile: ${activeFile}`);
    if (selectionText) parts.push(`selection:\n${selectionText.slice(0, 1_200)}`);
    return parts.join('\n');
}
function tokenize(value: string): string[] {
    const raw = String(value ?? '').toLowerCase();
    const tokens = raw.split(/[^a-z0-9_\u4e00-\u9fa5]+/g).map(token => token.trim()).filter(Boolean);
    return tokens.length > 64 ? tokens.slice(0, 64) : tokens;
}
function lexicalScore(queryTokens: string[], text: string, files: string[], activeFiles: string[], scoring: 'legacy' | 'exact-boost'): number {
    const haystack = text.toLowerCase();
    if (!haystack) return 0;
    const exactTokens = new Set(tokenize(haystack));
    let score = 0;
    for (const token of queryTokens) {
        if (token.length < 2) continue;
        if (haystack.includes(token)) {
            score += token.length >= 6 ? 0.25 : 0.16;
            if (scoring === 'exact-boost' && exactTokens.has(token)) score += 0.03;
        }
    }
    if (scoring === 'exact-boost' && queryTokens[0] && exactTokens.has(queryTokens[0])) score += 0.1;
    score += activeFileBoost({ files }, activeFiles);
    return Math.min(1.2, score);
}
function activeFileBoost(entry: Pick<KnowledgeIndexEntry, 'files'>, activeFiles: string[]): number {
    for (const file of entry.files) {
        const normalized = normalizeWorkspaceRelativePath(file);
        if (!normalized) continue;
        if (activeFiles.includes(normalized)) return 0.06;
        for (const candidate of activeFiles) if (candidate && normalized.endsWith(`/${candidate}`)) return 0.04;
    }
    return 0;
}
function cosineSimilarity(a: number[], b: number[]): number { let dot = 0; let aa = 0; let bb = 0; for (let i = 0; i < a.length; i++) { const av = a[i] ?? 0; const bv = b[i] ?? 0; dot += av * bv; aa += av * av; bb += bv * bv; } return aa && bb ? dot / Math.sqrt(aa * bb) : 0; }
function toResult(entry: KnowledgeIndexEntry, score: number, mode: KnowledgeSearchMode, fallbackReason?: string): KnowledgeSearchResult { return { cardId: entry.cardId, score, mode, type: entry.type, status: entry.status, scope: entry.scope, ownerMemberId: entry.ownerMemberId, title: entry.title, summary: entry.summary, tags: entry.tags, files: entry.files, excerpt: entry.embeddingText.slice(0, 800), ...(fallbackReason ? { fallbackReason } : {}) }; }
function clampInt(value: number, min: number, max: number): number { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
