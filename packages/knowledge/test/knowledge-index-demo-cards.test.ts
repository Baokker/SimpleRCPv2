// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createDemoKnowledgeCards } from '../src/demo-cards.js';
import { searchKnowledgeCards } from '../src/knowledge-index.js';
import { buildKnowledgeContext } from '../src/knowledge-inject.js';

describe('knowledge-index demo cards retrieval', () => {
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
