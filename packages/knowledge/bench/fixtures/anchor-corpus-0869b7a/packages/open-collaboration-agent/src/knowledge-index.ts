// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { embed, embedMany, cosineSimilarity } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { isKnowledgeCard, normalizeWorkspaceRelativePath } from 'open-collaboration-knowledge';
import type { KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from 'open-collaboration-knowledge';
import type { ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import { FileType } from 'open-collaboration-protocol';

export type KnowledgeSearchMode = 'vector' | 'lexical';

export interface EmbeddingsConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
}

export interface ProtocolFsKnowledgeSource {
    connection: ProtocolBroadcastConnection;
    hostId: string;
    workspaceFolders: string[];
}

export interface KnowledgeIndexEntry {
    cardId: string;
    type: KnowledgeCardType;
    status: KnowledgeCardStatus;
    title: string;
    summary: string;
    tags: string[];
    files: string[];
    embeddingTextHash: string;
    embeddingText: string;
    vector?: number[];
}

export interface KnowledgeIndex {
    schemaVersion: 2;
    workspaceRoot: string;
    workspaceHash: string;
    embeddingModel: string;
    updatedAt: number;
    entries: KnowledgeIndexEntry[];
}

export interface EnsureKnowledgeIndexOptions {
    workspaceRoot?: string;
    workspaceId?: string;
    cards?: KnowledgeCard[];
    protocolFs?: ProtocolFsKnowledgeSource;
    embeddings?: EmbeddingsConfig;
    indexDir?: string;
    forceRebuild?: boolean;
}

export interface KnowledgeSearchFilters {
    types?: KnowledgeCardType[];
    statuses?: KnowledgeCardStatus[];
}

export interface SearchKnowledgeCardsOptions {
    workspaceRoot?: string;
    workspaceId?: string;
    cards?: KnowledgeCard[];
    protocolFs?: ProtocolFsKnowledgeSource;
    query: string;
    activeFile?: string;
    selectionText?: string;
    filters?: KnowledgeSearchFilters;
    topK?: number;
    embeddings?: EmbeddingsConfig;
    indexDir?: string;
}

export interface KnowledgeSearchResult {
    cardId: string;
    score: number;
    mode: KnowledgeSearchMode;
    type: KnowledgeCardType;
    status: KnowledgeCardStatus;
    title: string;
    summary: string;
    tags: string[];
    files: string[];
    excerpt: string;
}

const DEFAULT_EMBEDDINGS_MODEL = 'text-embedding-v4';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_EMBEDDING_TEXT_CHARS = 12_000;
const MAX_SNAPSHOT_CHARS = 2_000;
const INDEX_TTL_MS = 60_000;
const MAX_EMBEDDING_BATCH_SIZE = 10;

const indexBuildLocks = new Map<string, Promise<KnowledgeIndex>>();
let lastIndexCacheKey: string | undefined;
let lastIndexCache: KnowledgeIndex | undefined;

export async function ensureKnowledgeIndex(options: EnsureKnowledgeIndexOptions = {}): Promise<KnowledgeIndex> {
    const { sourceId, localWorkspaceRoot } = resolveKnowledgeSource(options);
    const embeddings = resolveEmbeddingsConfig(options.embeddings);
    const embeddingModel = (embeddings.model ?? DEFAULT_EMBEDDINGS_MODEL).trim() || DEFAULT_EMBEDDINGS_MODEL;
    const indexDir = resolveIndexDir(options.indexDir);

    const workspaceHash = sha256Hex(sourceId);
    const cards = await readKnowledgeCards(options, localWorkspaceRoot);
    const cardsHash = hashIndexedCardContent(cards);
    const cacheKey = `${workspaceHash}::${embeddingModel}::${indexDir}::${cardsHash}`;
    if (!options.forceRebuild && lastIndexCacheKey === cacheKey && lastIndexCache) {
        const age = Date.now() - (lastIndexCache.updatedAt ?? 0);
        if (age >= 0 && age < INDEX_TTL_MS) {
            return lastIndexCache;
        }
        // Cache is stale; rebuild in the background by falling through.
    }

    const existingLock = indexBuildLocks.get(cacheKey);
    if (existingLock) {
        return existingLock;
    }

    const lock = (async () => {
        const indexPath = path.join(indexDir, `${workspaceHash}-schema2-${sanitizeFilename(embeddingModel)}.json`);

        const vectorEnabled = isVectorSearchEnabled(embeddings);
        const prev = options.forceRebuild ? undefined : await readIndexFile(indexPath).catch(() => undefined);
        const prevById = new Map<string, KnowledgeIndexEntry>();
        if (prev?.entries?.length) {
            for (const e of prev.entries) {
                if (e && typeof e.cardId === 'string' && e.cardId) {
                    prevById.set(e.cardId, e);
                }
            }
        }

        const now = Date.now();

        const nextEntries: KnowledgeIndexEntry[] = [];
        const embedQueue: Array<{ entry: KnowledgeIndexEntry; value: string }> = [];
        for (const card of cards) {
            const embeddingText = buildEmbeddingText(card);
            const embeddingTextHash = sha256Hex(embeddingText);
            const files = extractCardFiles(card);
            const baseEntry: KnowledgeIndexEntry = {
                cardId: card.id,
                type: card.type,
                status: card.status,
                title: card.title,
                summary: card.summary,
                tags: Array.isArray(card.tags) ? card.tags.slice(0, 64) : [],
                files,
                embeddingTextHash,
                embeddingText,
                vector: undefined
            };

            const old = prevById.get(card.id);
            if (old && old.embeddingTextHash === embeddingTextHash && Array.isArray(old.vector) && old.vector.length > 0) {
                if (vectorEnabled) {
                    baseEntry.vector = old.vector;
                }
            }

            if (vectorEnabled && !baseEntry.vector) {
                embedQueue.push({ entry: baseEntry, value: embeddingText });
            }
            nextEntries.push(baseEntry);
        }

        if (vectorEnabled && embedQueue.length) {
            try {
                const model = createEmbeddingModel(embeddings, embeddingModel);
                for (let offset = 0; offset < embedQueue.length; offset += MAX_EMBEDDING_BATCH_SIZE) {
                    const batch = embedQueue.slice(offset, offset + MAX_EMBEDDING_BATCH_SIZE);
                    const values = batch.map(e => e.value);
                    const result = await embedMany({ model, values });
                    for (let i = 0; i < batch.length; i++) {
                        const vec = result.embeddings[i];
                        if (Array.isArray(vec) && vec.length) {
                            batch[i].entry.vector = vec as number[];
                        }
                    }
                }
            } catch {
                // If embeddings fail, keep the index without vectors and fall back to lexical search.
            }
        }

        const index: KnowledgeIndex = {
            schemaVersion: 2,
            workspaceRoot: sourceId,
            workspaceHash,
            embeddingModel,
            updatedAt: now,
            entries: nextEntries
        };

        await fs.mkdir(indexDir, { recursive: true });
        await fs.writeFile(indexPath, JSON.stringify(index, undefined, 2), 'utf8');

        lastIndexCacheKey = cacheKey;
        lastIndexCache = index;
        return index;
    })().finally(() => {
        indexBuildLocks.delete(cacheKey);
    });

    indexBuildLocks.set(cacheKey, lock);
    return lock;
}

export async function searchKnowledgeCards(options: SearchKnowledgeCardsOptions): Promise<KnowledgeSearchResult[]> {
    const { sourceId, localWorkspaceRoot } = resolveKnowledgeSource(options);
    const embeddings = resolveEmbeddingsConfig(options.embeddings);
    const embeddingModel = (embeddings.model ?? DEFAULT_EMBEDDINGS_MODEL).trim() || DEFAULT_EMBEDDINGS_MODEL;
    const indexDir = resolveIndexDir(options.indexDir);
    const topK = clampInt(options.topK ?? 5, 1, 25);

    const query = String(options.query ?? '').trim();
    if (!query) {
        return [];
    }

    const index = await ensureKnowledgeIndex({
        workspaceRoot: localWorkspaceRoot,
        workspaceId: sourceId,
        cards: options.cards,
        protocolFs: options.protocolFs,
        embeddings,
        indexDir
    });
    const entries = applyFilters(index.entries, options.filters);

    const activeFileCandidates = normalizeActiveFileCandidates(options.activeFile);
    const selectionText = String(options.selectionText ?? '').trim();
    const queryText = buildQueryText(query, selectionText, activeFileCandidates[0]);

    const vectorEnabled = isVectorSearchEnabled(embeddings) && entries.some(e => Array.isArray(e.vector) && e.vector.length > 0);
    if (vectorEnabled) {
        try {
            const model = createEmbeddingModel(embeddings, embeddingModel);
            const q = await embed({ model, value: queryText });
            const qVec = q.embedding as number[] | undefined;
            if (Array.isArray(qVec) && qVec.length) {
                const scored = entries
                    .filter(e => Array.isArray(e.vector) && e.vector.length === qVec.length)
                    .map(e => {
                        const base = cosineSimilarity(qVec, e.vector as number[]);
                        const boosted = base + activeFileBoost(e, activeFileCandidates);
                        return { entry: e, score: boosted };
                    })
                    .sort((a, b) => b.score - a.score)
                    .slice(0, topK)
                    .map(s => toResult(s.entry, s.score, 'vector'));
                return scored;
            }
        } catch {
            // Fall through to lexical.
        }
    }

    const qTokens = tokenize(queryText);
    const scored = entries
        .map(e => {
            const base = lexicalScore(qTokens, e.embeddingText, e.files, activeFileCandidates);
            return { entry: e, score: base };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(s => toResult(s.entry, s.score, 'lexical'));
    return scored;
}

function resolveKnowledgeSource(options: { workspaceRoot?: string; workspaceId?: string; cards?: KnowledgeCard[]; protocolFs?: ProtocolFsKnowledgeSource }): { sourceId: string; localWorkspaceRoot: string | undefined } {
    if (options.workspaceId && String(options.workspaceId).trim()) {
        return { sourceId: String(options.workspaceId).trim(), localWorkspaceRoot: options.workspaceRoot ? resolveWorkspaceRoot(options.workspaceRoot) : undefined };
    }
    if (options.protocolFs) {
        const folders = (options.protocolFs.workspaceFolders ?? []).map(f => String(f ?? '').trim()).filter(Boolean);
        const folderKey = folders.length ? folders.join('|') : 'unknown-folders';
        const sourceId = `protocolfs:${options.protocolFs.hostId}:${folderKey}`;
        return { sourceId, localWorkspaceRoot: undefined };
    }
    if (options.cards) {
        return { sourceId: 'cards:in-memory', localWorkspaceRoot: undefined };
    }
    const local = resolveWorkspaceRoot(options.workspaceRoot);
    return { sourceId: local, localWorkspaceRoot: local };
}

function resolveWorkspaceRoot(explicit?: string): string {
    const fromArg = typeof explicit === 'string' ? explicit.trim() : '';
    if (fromArg) {
        return path.resolve(fromArg);
    }
    return process.cwd();
}

function resolveEmbeddingsConfig(explicit?: EmbeddingsConfig): EmbeddingsConfig {
    const cfg = explicit ?? {};
    const apiKey = firstNonEmpty(cfg.apiKey, process.env.OCT_EMBEDDINGS_API_KEY);
    const baseUrl = firstNonEmpty(cfg.baseUrl, process.env.OCT_EMBEDDINGS_BASE_URL);
    const model = firstNonEmpty(cfg.model, process.env.OCT_EMBEDDINGS_MODEL, DEFAULT_EMBEDDINGS_MODEL);
    const timeoutMs = parseTimeoutMs(firstNonEmpty(String(cfg.timeoutMs ?? ''), process.env.OCT_EMBEDDINGS_TIMEOUT_MS));
    return {
        apiKey,
        baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
        model,
        timeoutMs
    };
}

function resolveIndexDir(explicit?: string): string {
    const fromArg = typeof explicit === 'string' ? explicit.trim() : '';
    const fromEnv = String(process.env.OCT_KNOWLEDGE_INDEX_DIR ?? '').trim();
    const chosen = fromArg || fromEnv;
    if (chosen) {
        return path.resolve(chosen);
    }
    if (process.platform === 'win32') {
        const local = String(process.env.LOCALAPPDATA ?? '').trim();
        if (local) {
            return path.join(local, 'open-collaboration-tools', 'knowledge-index');
        }
    }
    return path.join(os.homedir(), '.open-collaboration-tools', 'knowledge-index');
}

function isVectorSearchEnabled(cfg: EmbeddingsConfig): boolean {
    return !!(cfg.apiKey && cfg.baseUrl);
}

async function readIndexFile(filePath: string): Promise<KnowledgeIndex | undefined> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    if (parsed.schemaVersion !== 2) {
        return undefined;
    }
    if (!Array.isArray(parsed.entries)) {
        return undefined;
    }
    return parsed as KnowledgeIndex;
}

async function readWorkspaceKnowledgeCards(cardsDir: string): Promise<KnowledgeCard[]> {
    let names: string[] = [];
    try {
        names = await fs.readdir(cardsDir);
    } catch {
        return [];
    }
    const jsonFiles = names
        .filter(n => n.toLowerCase().endsWith('.json'))
        .filter(n => n.toLowerCase().startsWith('card-'));

    const out: KnowledgeCard[] = [];
    for (const name of jsonFiles) {
        const p = path.join(cardsDir, name);
        try {
            const raw = await fs.readFile(p, 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            if (isKnowledgeCard(parsed)) {
                out.push(parsed);
            }
        } catch {
            // ignore bad cards
        }
    }
    return out;
}

async function readKnowledgeCards(options: EnsureKnowledgeIndexOptions, localWorkspaceRoot: string | undefined): Promise<KnowledgeCard[]> {
    if (Array.isArray(options.cards)) {
        return options.cards.filter(isKnowledgeCard);
    }
    if (options.protocolFs) {
        return readProtocolKnowledgeCards(options.protocolFs);
    }
    if (!localWorkspaceRoot) {
        return [];
    }
    const cardsDir = path.join(localWorkspaceRoot, '.CoVSCode', 'knowledge', 'cards');
    return readWorkspaceKnowledgeCards(cardsDir);
}

async function readProtocolKnowledgeCards(source: ProtocolFsKnowledgeSource): Promise<KnowledgeCard[]> {
    const folders = (source.workspaceFolders ?? []).map(f => String(f ?? '').trim()).filter(Boolean);
    if (!source.hostId || !folders.length) {
        return [];
    }
    const decoder = new TextDecoder();
    const out: KnowledgeCard[] = [];
    for (const folderName of folders) {
        const dir = `${folderName}/.CoVSCode/knowledge/cards`;
        let record: Record<string, number> | undefined;
        try {
            record = await source.connection.fs.readdir(source.hostId, dir) as any;
        } catch {
            continue;
        }
        for (const [name, type] of Object.entries(record ?? {})) {
            const lower = String(name ?? '').toLowerCase();
            if (!lower.startsWith('card-') || !lower.endsWith('.json')) {
                continue;
            }
            if (type !== FileType.File) {
                continue;
            }
            const filePath = `${dir}/${name}`;
            try {
                const file = await source.connection.fs.readFile(source.hostId, filePath);
                const raw = decoder.decode(file.content);
                const parsed = JSON.parse(raw) as unknown;
                if (isKnowledgeCard(parsed)) {
                    out.push(parsed);
                }
            } catch {
                // ignore bad cards
            }
        }
    }
    return out;
}

function extractCardFiles(card: KnowledgeCard): string[] {
    const set = new Set<string>();
    for (const a of (card.anchors ?? [])) {
        const rel = normalizeWorkspaceRelativePath(String(a?.file?.workspaceRelativePath ?? ''));
        if (rel) {
            set.add(rel);
        }
    }
    return [...set].slice(0, 24);
}

function buildEmbeddingText(card: KnowledgeCard): string {
    const parts: string[] = [];
    const add = (label: string, value: string) => {
        const v = String(value ?? '').trim();
        if (!v) {
            return;
        }
        parts.push(`${label}: ${v}`);
    };

    add('title', card.title);
    add('summary', card.summary);
    if (Array.isArray(card.tags) && card.tags.length) {
        add('tags', card.tags.slice(0, 32).join(', '));
    }

    const content = String(card.content ?? '').trim();
    if (content) {
        parts.push('\n---\n' + content);
    }

    const files = extractCardFiles(card);
    if (files.length) {
        add('files', files.join(', '));
    }

    const firstSnapshot = String(card.anchors?.[0]?.snapshot?.text ?? '');
    const snapshot = firstSnapshot.length > MAX_SNAPSHOT_CHARS ? firstSnapshot.slice(0, MAX_SNAPSHOT_CHARS) : firstSnapshot;
    if (snapshot.trim()) {
        parts.push('\n---\n' + snapshot.trim());
    }

    const joined = parts.join('\n').trim();
    if (joined.length <= MAX_EMBEDDING_TEXT_CHARS) {
        return joined;
    }
    return joined.slice(0, MAX_EMBEDDING_TEXT_CHARS);
}

function hashIndexedCardContent(cards: KnowledgeCard[]): string {
    const indexedContent = cards.map(card => ({
        id: card.id,
        type: card.type,
        status: card.status,
        tags: Array.isArray(card.tags) ? card.tags.slice(0, 64) : [],
        files: extractCardFiles(card),
        embeddingText: buildEmbeddingText(card)
    }));
    return sha256Hex(JSON.stringify(indexedContent));
}

function buildQueryText(query: string, selectionText: string, activeFile?: string): string {
    const parts: string[] = [];
    parts.push(query);
    if (activeFile) {
        parts.push(`activeFile: ${activeFile}`);
    }
    if (selectionText) {
        const s = selectionText.length > 1200 ? selectionText.slice(0, 1200) : selectionText;
        parts.push(`selection:\n${s}`);
    }
    return parts.join('\n');
}

function createEmbeddingModel(cfg: EmbeddingsConfig, modelId: string) {
    const apiKey = String(cfg.apiKey ?? '').trim();
    const baseURL = normalizeBaseUrl(String(cfg.baseUrl ?? '').trim());
    const timeoutMs = clampInt(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000, 300_000);
    const openai = createOpenAI({
        apiKey,
        baseURL,
        fetch: createTimeoutFetch(globalThis.fetch, timeoutMs)
    });
    return openai.embedding(modelId as any);
}

function createTimeoutFetch(fetchFn: typeof fetch, timeoutMs: number): typeof fetch {
    return async (input: any, init?: any) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const signal = init?.signal;
            if (signal) {
                if (signal.aborted) {
                    controller.abort();
                } else {
                    signal.addEventListener('abort', () => controller.abort(), { once: true });
                }
            }
            const headers = new Headers(init?.headers ?? undefined);
            headers.set('X-OCT-RAG', '1');
            return await fetchFn(input, { ...(init ?? {}), headers, signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }
    };
}

function normalizeBaseUrl(value: string): string {
    const raw = String(value ?? '').trim().replace(/\/+$/g, '');
    if (!raw) {
        return raw;
    }
    if (raw.endsWith('/v1')) {
        return raw;
    }
    return raw + '/v1';
}

function applyFilters(entries: KnowledgeIndexEntry[], filters?: KnowledgeSearchFilters): KnowledgeIndexEntry[] {
    const types = filters?.types?.length ? new Set(filters.types) : undefined;
    const statuses = filters?.statuses?.length ? new Set(filters.statuses) : undefined;
    if (!types && !statuses) {
        return entries;
    }
    return entries.filter(e => {
        if (types && !types.has(e.type)) {
            return false;
        }
        if (statuses && !statuses.has(e.status)) {
            return false;
        }
        return true;
    });
}

function normalizeActiveFileCandidates(activeFile?: string): string[] {
    const raw = String(activeFile ?? '').trim();
    if (!raw) {
        return [];
    }
    const p = normalizeWorkspaceRelativePath(raw);
    const out = new Set<string>();
    if (p) {
        out.add(p);
    }
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) {
        out.add(parts.slice(1).join('/'));
    }
    return [...out].filter(Boolean);
}

function activeFileBoost(entry: KnowledgeIndexEntry, activeFileCandidates: string[]): number {
    if (!activeFileCandidates.length || !entry.files?.length) {
        return 0;
    }
    for (const f of entry.files) {
        const normalized = normalizeWorkspaceRelativePath(f);
        if (!normalized) {
            continue;
        }
        if (activeFileCandidates.includes(normalized)) {
            return 0.06;
        }
        for (const c of activeFileCandidates) {
            if (c && normalized.endsWith('/' + c)) {
                return 0.04;
            }
        }
    }
    return 0;
}

function tokenize(text: string): string[] {
    const raw = String(text ?? '').toLowerCase();
    const tokens = raw.split(/[^a-z0-9_\u4e00-\u9fa5]+/g).map(t => t.trim()).filter(Boolean);
    return tokens.length > 64 ? tokens.slice(0, 64) : tokens;
}

function lexicalScore(tokens: string[], embeddingText: string, files: string[], activeFileCandidates: string[]): number {
    const hay = String(embeddingText ?? '').toLowerCase();
    if (!hay) {
        return 0;
    }
    let score = 0;
    for (const t of tokens) {
        if (t.length < 2) {
            continue;
        }
        if (hay.includes(t)) {
            score += t.length >= 6 ? 0.25 : 0.16;
        }
    }
    if (files?.length && activeFileCandidates.length) {
        for (const f of files) {
            const nf = normalizeWorkspaceRelativePath(f);
            if (nf && activeFileCandidates.includes(nf)) {
                score += 0.2;
                break;
            }
        }
    }
    return Math.min(1.2, score);
}

function toResult(entry: KnowledgeIndexEntry, score: number, mode: KnowledgeSearchMode): KnowledgeSearchResult {
    const excerpt = entry.embeddingText.length > 800 ? entry.embeddingText.slice(0, 800) : entry.embeddingText;
    return {
        cardId: entry.cardId,
        score,
        mode,
        type: entry.type,
        status: entry.status,
        title: entry.title,
        summary: entry.summary,
        tags: entry.tags ?? [],
        files: entry.files ?? [],
        excerpt
    };
}

function sha256Hex(text: string): string {
    return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function parseTimeoutMs(value: string | undefined): number {
    const n = Number(String(value ?? '').trim());
    if (!Number.isFinite(n) || n <= 0) {
        return DEFAULT_TIMEOUT_MS;
    }
    return clampInt(n, 1000, 300_000);
}

function clampInt(value: number, min: number, max: number): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) {
        return min;
    }
    return Math.max(min, Math.min(max, n));
}

function firstNonEmpty(...values: Array<unknown>): string | undefined {
    for (const v of values) {
        const s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
        if (s) {
            return s;
        }
    }
    return undefined;
}

function sanitizeFilename(value: string): string {
    return String(value ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}
