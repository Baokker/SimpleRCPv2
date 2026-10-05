// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createDemoKnowledgeCards } from '../../open-collaboration-knowledge/src/demo-cards.js';
import { searchKnowledgeCards } from '../src/knowledge-index.js';

describe('knowledge-index demo cards retrieval', () => {
    test('RAG lexical fallback retrieves generated demo cards from workspace JSON', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oct-demo-cards-'));
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
            query: 'intermittent failure guard risky cleanup regression',
            activeFile: 'src/session.ts',
            topK: 3,
            embeddings: {},
            indexDir
        });

        expect(riskResults[0]?.cardId).toBe('demo-risk');
        expect(riskResults[0]?.mode).toBe('lexical');
    });
});
