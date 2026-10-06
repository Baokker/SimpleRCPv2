// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createDemoKnowledgeCards } from '../src/demo/demoCards.js';
import { ensureKnowledgeIndex, searchKnowledgeCards } from '../src/retrieval/index.js';
import { buildKnowledgeContext, pickCardsWithinBudget } from '../src/retrieval/inject.js';

describe('knowledge-index demo cards retrieval', () => {
    test('applies legacy file boosts to every active file independently', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const root = await fs.mkdtemp(path.join(artifactRoot, 'multiple-active-files-'));
        try {
            const [card] = createDemoKnowledgeCards({ workspaceRelativePath: 'src/second.ts', selectedText: 'const shared = 1;', now: 1_000 });
            const options = { cards: [card], query: 'shared', indexDir: root, lexicalScoring: 'legacy' as const };
            const single = await searchKnowledgeCards({ ...options, activeFile: 'src/first.ts' });
            const multiple = await searchKnowledgeCards({ ...options, activeFiles: ['src/first.ts', 'src/second.ts'] });
            expect(multiple[0]?.score).toBeCloseTo(single[0]!.score + 0.06);
            const duplicated = await searchKnowledgeCards({ ...options, activeFiles: ['src/first.ts', 'src/second.ts', 'src/second.ts'] });
            expect(duplicated).toEqual(multiple);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('refreshes cached scope and ownership without changing card text', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const root = await fs.mkdtemp(path.join(artifactRoot, 'scope-cache-'));
        try {
            const [card] = createDemoKnowledgeCards({ selectedText: 'const value = 1;', now: 1_000 });
            const options = { cards: [{ ...card, scope: 'team' as const, ownerMemberId: 'Ada' }], indexDir: root, now: () => 1_000 };
            await ensureKnowledgeIndex(options);
            const updated = await ensureKnowledgeIndex({ ...options, cards: [{ ...options.cards[0], scope: 'personal', ownerMemberId: 'Bob' }] });
            expect(updated.entries[0]).toMatchObject({ scope: 'personal', ownerMemberId: 'Bob' });
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('selects reusable cards before limiting retrieval results', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const root = await fs.mkdtemp(path.join(artifactRoot, 'reusable-top-k-'));
        try {
            const [card] = createDemoKnowledgeCards({ selectedText: 'const value = 1;', now: 1_000 });
            const cards = [
                { ...card, id: 'private', title: 'timeout retry policy', summary: 'timeout retry policy', content: 'timeout retry policy', scope: 'personal' as const, ownerMemberId: 'Bob' },
                { ...card, id: 'draft', title: 'timeout retry policy', summary: 'timeout retry policy', content: 'timeout retry policy', status: 'draft' as const, scope: 'team' as const },
                { ...card, id: 'shared', title: 'timeout', summary: 'timeout', content: 'timeout', scope: 'team' as const }
            ];
            const result = await buildKnowledgeContext({ cards, query: 'timeout retry policy', viewerMemberId: 'Ada', topK: 1, indexDir: root });
            expect(result.cards.map(item => item.id)).toEqual(['shared']);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('keeps rendered knowledge text within the total character budget', () => {
        const result = { cardId: 'card-1', score: 1, mode: 'lexical' as const, type: 'risk' as const, status: 'reviewed' as const, title: 'timeout '.repeat(100), summary: 'retry '.repeat(100), tags: ['policy'.repeat(100)], files: ['src/config.ts'], excerpt: 'content' };
        expect(pickCardsWithinBudget([result], 800, 100)).toEqual({ text: '', cards: [] });
        const bounded = pickCardsWithinBudget([result, { ...result, cardId: 'card-2' }], 800, 2_000);
        expect(bounded.cards).toHaveLength(1);
        expect(bounded.text.length).toBeLessThanOrEqual(2_000);
    });

    test('keeps the index readable during concurrent builds of different visible card sets', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const root = await fs.mkdtemp(path.join(artifactRoot, 'concurrent-index-'));
        try {
            const [card] = createDemoKnowledgeCards({ selectedText: 'const value = 1;', now: 1_000 });
            const large = Array.from({ length: 100 }, (_, index) => ({ ...card, id: `large-${index}`, content: 'timeout policy '.repeat(800) }));
            for (let round = 0; round < 5; round++) {
                await Promise.all([
                    ensureKnowledgeIndex({ workspaceId: 'concurrent', cards: large, indexDir: root, forceRebuild: true }),
                    ensureKnowledgeIndex({ workspaceId: 'concurrent', cards: [card], indexDir: root, forceRebuild: true })
                ]);
                const [filename] = await fs.readdir(root);
                const persisted = JSON.parse(await fs.readFile(path.join(root, filename), 'utf8'));
                expect(persisted.schemaVersion).toBe(3);
                expect([1, 100]).toContain(persisted.entries.length);
            }
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('requires an explicit index directory', async () => {
        const cards = createDemoKnowledgeCards({
            workspaceFolderName: 'demo',
            workspaceRelativePath: 'src/index.ts',
            selectedText: 'const value = 1;',
            now: 1_000
        });
        await expect(searchKnowledgeCards({ cards, query: 'project knowledge' })).rejects.toThrow('indexDir is required');
    });

    test('RAG lexical fallback retrieves generated demo cards from workspace JSON', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const workspaceRoot = await fs.mkdtemp(path.join(artifactRoot, 'oct-demo-cards-'));
        const indexDir = path.join(workspaceRoot, '.test-index');
        const cardsDir = path.join(workspaceRoot, '.CoVSCode', 'knowledge', 'cards');
        await fs.mkdir(cardsDir, { recursive: true });

        const cards = createDemoKnowledgeCards({
            workspaceFolderName: 'demo',
            workspaceRelativePath: 'src/session.ts',
            selectedText: 'const timeoutMs = 200;',
            now: 1_000
        });
        await Promise.all(cards.map(card => fs.writeFile(
            path.join(cardsDir, `card-${card.id}.json`),
            JSON.stringify(card, undefined, 2),
            'utf8'
        )));

        const negativeResults = await searchKnowledgeCards({
            workspaceRoot,
            cardsDirectory: cardsDir,
            query: 'eager synchronization rejected noisy updates',
            activeFile: 'src/session.ts',
            topK: 3,
            embeddings: {},
            indexDir
        });

        expect(negativeResults[0]?.cardId).toBe('demo-negative');
        expect(negativeResults[0]?.mode).toBe('lexical');
        expect(negativeResults[0]?.summary).toContain('noisy updates');

        const riskResults = await searchKnowledgeCards({
            workspaceRoot,
            cardsDirectory: cardsDir,
            query: 'intermittent failure guard risky cleanup regression',
            activeFile: 'src/session.ts',
            topK: 3,
            embeddings: {},
            indexDir
        });

        expect(riskResults[0]?.cardId).toBe('demo-risk');
        expect(riskResults[0]?.mode).toBe('lexical');
    });

    test('falls back to lexical retrieval when embedding calls fail and supports strict mode', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const root = await fs.mkdtemp(path.join(artifactRoot, 'embedding-fallback-'));
        try {
            const [card] = createDemoKnowledgeCards({ selectedText: 'const value = 1;', now: 1_000 });
            const embeddings = { client: { async embed(): Promise<number[][]> { throw new Error('embedding service unavailable'); } } };
            const options = { workspaceId: `embedding-fallback-${root}`, cards: [card], query: 'value', embeddings, indexDir: root };
            const results = await searchKnowledgeCards(options);
            expect(results[0]?.mode).toBe('lexical');
            expect(results[0]?.fallbackReason).toBe('embedding service unavailable');
            await expect(searchKnowledgeCards({ ...options, strictEmbedding: true })).rejects.toThrow('embedding service unavailable');
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('migrates legacy cards read from the workspace directory', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const workspaceRoot = await fs.mkdtemp(path.join(artifactRoot, 'legacy-card-'));
        const cardsDir = path.join(workspaceRoot, '.CoVSCode', 'knowledge', 'cards');
        await fs.mkdir(cardsDir, { recursive: true });
        await fs.writeFile(path.join(cardsDir, 'card-legacy.json'), JSON.stringify({
            schemaVersion: 2,
            id: 'legacy-card',
            type: 'context',
            title: 'Legacy context',
            summary: 'Legacy summary',
            content: 'Legacy content',
            source: 'manual',
            status: 'reviewed',
            tags: [],
            createdAt: 1,
            updatedAt: 1,
            metadata: {},
            anchors: [],
            evolution: []
        }), 'utf8');

        const results = await searchKnowledgeCards({
            workspaceRoot,
            cardsDirectory: cardsDir,
            query: 'legacy context',
            indexDir: path.join(workspaceRoot, '.index'),
            now: () => 10
        });
        expect(results[0]?.cardId).toBe('legacy-card');
    });

    test('migrates legacy cards supplied explicitly', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const workspaceRoot = await fs.mkdtemp(path.join(artifactRoot, 'legacy-explicit-card-'));
        const legacy = {
            schemaVersion: 2,
            id: 'legacy-explicit',
            type: 'context',
            title: 'Explicit legacy context',
            summary: 'Explicit legacy summary',
            content: 'Explicit legacy content',
            source: 'event',
            status: 'reviewed',
            tags: [],
            createdAt: 1,
            updatedAt: 1,
            metadata: { createdBy: { peerId: 'member-1' } },
            anchors: [],
            evolution: []
        };
        const results = await searchKnowledgeCards({
            workspaceRoot,
            cards: [legacy as never],
            query: 'explicit legacy context',
            indexDir: path.join(workspaceRoot, '.index')
        });
        expect(results[0]?.cardId).toBe('legacy-explicit');
    });

    test('applies a custom filter to cards loaded from a directory', async () => {
        const artifactRoot = path.join(process.cwd(), '.test-artifacts');
        await fs.mkdir(artifactRoot, { recursive: true });
        const workspaceRoot = await fs.mkdtemp(path.join(artifactRoot, 'directory-filter-'));
        const cardsDir = path.join(workspaceRoot, 'cards');
        const indexDir = path.join(workspaceRoot, 'index');
        await fs.mkdir(cardsDir, { recursive: true });
        const cards = createDemoKnowledgeCards({
            workspaceFolderName: 'demo',
            workspaceRelativePath: 'src/filter.ts',
            selectedText: 'const value = 1;',
            now: 1_000
        });
        await Promise.all(cards.map(card => fs.writeFile(path.join(cardsDir, `card-${card.id}.json`), JSON.stringify(card), 'utf8')));
        const result = await buildKnowledgeContext({
            workspaceRoot,
            cardsDirectory: cardsDir,
            query: 'eager synchronization rejected noisy updates',
            indexDir,
            filter: card => card.id === 'demo-negative',
            maxTotalChars: 2_000
        });
        expect(result.cards.map(card => card.id)).toEqual(['demo-negative']);
    });
});
