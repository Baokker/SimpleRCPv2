// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { describe, expect, test } from 'vitest';
import { assessAnchorReviewHint } from '../src/anchor-review.js';
import type { KnowledgeAnchor } from '../src/schema.js';

describe('anchor review hint', () => {
    test('does not request review when the captured range still resolves', () => {
        const anchor = makeAnchor('const timeoutMs = 200;');

        const result = assessAnchorReviewHint('const timeoutMs = 200;', anchor);

        expect(result.needsReview).toBe(false);
    });

    test('requests review when only the stale captured range fallback is available', () => {
        const anchor = makeAnchor('const timeoutMs = 200;');

        const result = assessAnchorReviewHint('const timeoutMs = 250;', anchor);

        expect(result.needsReview).toBe(true);
        expect(result.reason).toContain('could not be resolved');
    });

    test('does not request review for file-level anchors', () => {
        const anchor = {
            ...makeAnchor(''),
            associationLevel: 'file' as const,
            snapshot: { text: '' }
        };

        const result = assessAnchorReviewHint('const timeoutMs = 250;', anchor);

        expect(result.needsReview).toBe(false);
    });
});

function makeAnchor(snapshotText: string): KnowledgeAnchor {
    return {
        anchorId: 'a1',
        file: { workspaceRelativePath: 'src/app.ts' },
        associationLevel: 'block',
        rangeAtCapture: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: snapshotText.length }
        },
        snapshot: { text: snapshotText },
        fingerprint: { prefix: '', suffix: '', landmarkLines: [] }
    };
}
