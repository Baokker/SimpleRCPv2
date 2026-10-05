// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import { describe, expect, test } from 'vitest';
import { assessAnchorReviewHint } from '../src/anchor/review.js';
import { resolveKnowledgeAnchorInText } from '../src/anchor/resolver.js';
import type { KnowledgeAnchor } from '../src/schema/card.js';

interface PilotCase {
    id: string;
    editType: string;
    original: string;
    selection: string;
    updated: string;
    expected: 'correct' | 'review-needed';
}

const cases: PilotCase[] = [
    {
        id: 'A001',
        editType: 'insert-before',
        original: 'function boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}\n',
        selection: 'const timeoutMs = 200;',
        updated: 'import { delay } from "./delay";\nfunction boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A002',
        editType: 'move-within-file',
        original: 'function boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}\nfunction main(){\n  return boot();\n}\n',
        selection: 'function boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}',
        updated: 'function main(){\n  return boot();\n}\nfunction boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A003',
        editType: 'duplicate-snapshot-with-context',
        original: 'function a(){\n  console.log("x");\n}\nfunction b(){\n  console.log("x");\n}\n',
        selection: 'console.log("x");',
        updated: 'function a(){\n  console.log("x");\n}\nfunction b(){\n  console.log("x");\n}\n',
        expected: 'correct'
    },
    {
        id: 'A004',
        editType: 'partial-rewrite',
        original: 'function boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}\n',
        selection: 'const timeoutMs = 200;\n  return timeoutMs;',
        updated: 'function boot(){\n  const timeoutMs = 250;\n  return timeoutMs;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A005',
        editType: 'deleted-anchor',
        original: 'function boot(){\n  const timeoutMs = 200;\n  return timeoutMs;\n}\n',
        selection: 'const timeoutMs = 200;',
        updated: 'function boot(){\n  return 0;\n}\n',
        expected: 'review-needed'
    },
    {
        id: 'A006',
        editType: 'insert-imports-before',
        original: 'export function parse(){\n  const retries = 3;\n  return retries;\n}\n',
        selection: 'const retries = 3;',
        updated: 'import fs from "node:fs";\nimport path from "node:path";\nexport function parse(){\n  const retries = 3;\n  return retries;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A007',
        editType: 'insert-comment-before',
        original: 'const limit = 10;\nfunction clamp(x: number){\n  return Math.min(x, limit);\n}\n',
        selection: 'function clamp(x: number){\n  return Math.min(x, limit);\n}',
        updated: '// Keep this helper close to limit configuration.\nconst limit = 10;\nfunction clamp(x: number){\n  return Math.min(x, limit);\n}\n',
        expected: 'correct'
    },
    {
        id: 'A008',
        editType: 'move-within-file-helper',
        original: 'function normalize(v: string){\n  return v.trim().toLowerCase();\n}\nexport function run(v: string){\n  return normalize(v);\n}\n',
        selection: 'function normalize(v: string){\n  return v.trim().toLowerCase();\n}',
        updated: 'export function run(v: string){\n  return normalize(v);\n}\nfunction normalize(v: string){\n  return v.trim().toLowerCase();\n}\n',
        expected: 'correct'
    },
    {
        id: 'A009',
        editType: 'move-within-file-method',
        original: 'class Store {\n  load(){\n    return "data";\n  }\n  save(){\n    return true;\n  }\n}\n',
        selection: 'load(){\n    return "data";\n  }',
        updated: 'class Store {\n  save(){\n    return true;\n  }\n  load(){\n    return "data";\n  }\n}\n',
        expected: 'correct'
    },
    {
        id: 'A010',
        editType: 'duplicate-snapshot-with-prefix-context',
        original: 'if (mode === "fast") {\n  retry();\n}\nif (mode === "safe") {\n  retry();\n}\n',
        selection: 'retry();',
        updated: 'if (mode === "fast") {\n  retry();\n}\nif (mode === "safe") {\n  retry();\n}\n',
        expected: 'correct'
    },
    {
        id: 'A011',
        editType: 'duplicate-snapshot-after-insert-with-context',
        original: 'function first(){\n  return cache.get(key);\n}\nfunction second(){\n  return cache.get(key);\n}\n',
        selection: 'return cache.get(key);',
        updated: 'const key = "demo";\nfunction first(){\n  return cache.get(key);\n}\nfunction second(){\n  return cache.get(key);\n}\n',
        expected: 'correct'
    },
    {
        id: 'A012',
        editType: 'partial-rewrite-number',
        original: 'function poll(){\n  const intervalMs = 500;\n  return intervalMs;\n}\n',
        selection: 'const intervalMs = 500;\n  return intervalMs;',
        updated: 'function poll(){\n  const intervalMs = 750;\n  return intervalMs;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A013',
        editType: 'partial-rewrite-string',
        original: 'function label(){\n  const prefix = "draft";\n  return prefix + "-card";\n}\n',
        selection: 'const prefix = "draft";\n  return prefix + "-card";',
        updated: 'function label(){\n  const prefix = "reviewed";\n  return prefix + "-card";\n}\n',
        expected: 'correct'
    },
    {
        id: 'A014',
        editType: 'formatting-eol-spacing',
        original: 'function add(a: number, b: number){\n  return a + b;\n}\n',
        selection: 'return a + b;',
        updated: 'function add(a: number, b: number) {\n  return a + b;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A015',
        editType: 'formatting-with-surrounding-context',
        original: 'const config = {\n  retry: true,\n  timeout: 200\n};\n',
        selection: 'retry: true,\n  timeout: 200',
        updated: 'const config = {\n  retry: true,\n  timeout: 250\n};\n',
        expected: 'correct'
    },
    {
        id: 'A016',
        editType: 'deleted-function',
        original: 'function oldPath(){\n  return legacy();\n}\nfunction newPath(){\n  return modern();\n}\n',
        selection: 'function oldPath(){\n  return legacy();\n}',
        updated: 'function newPath(){\n  return modern();\n}\n',
        expected: 'review-needed'
    },
    {
        id: 'A017',
        editType: 'deleted-branch',
        original: 'if (featureFlag) {\n  enableBeta();\n}\nrunStable();\n',
        selection: 'enableBeta();',
        updated: 'runStable();\n',
        expected: 'review-needed'
    },
    {
        id: 'A018',
        editType: 'insert-before-and-partial-rewrite',
        original: 'function connect(){\n  const backoffMs = 100;\n  return backoffMs;\n}\n',
        selection: 'const backoffMs = 100;\n  return backoffMs;',
        updated: 'const DEFAULT_BACKOFF = 150;\nfunction connect(){\n  const backoffMs = DEFAULT_BACKOFF;\n  return backoffMs;\n}\n',
        expected: 'correct'
    },
    {
        id: 'A019',
        editType: 'move-and-format-review-needed',
        original: 'function guard(){\n  if (!ready) {\n    return false;\n  }\n  return true;\n}\nfunction start(){\n  return guard();\n}\n',
        selection: 'function guard(){\n  if (!ready) {\n    return false;\n  }\n  return true;\n}',
        updated: 'function start(){\n  return guard();\n}\nfunction guard() {\n  if (!ready) {\n    return false;\n  }\n  return true;\n}\n',
        expected: 'review-needed'
    },
    {
        id: 'A020',
        editType: 'renamed-nearby-symbol-with-same-body',
        original: 'function loadUser(){\n  return repo.find(id);\n}\n',
        selection: 'return repo.find(id);',
        updated: 'function fetchUser(){\n  return repo.find(id);\n}\n',
        expected: 'correct'
    }
];

describe('anchor robustness pilot fixture', () => {
    test('contains 20 manually curated pilot cases', () => {
        expect(cases).toHaveLength(20);
    });

    for (const pilotCase of cases) {
        test(`${pilotCase.id} ${pilotCase.editType}`, () => {
            const anchor = makeAnchor(pilotCase.original, pilotCase.selection);
            const resolved = resolveKnowledgeAnchorInText(pilotCase.updated, anchor);
            const review = assessAnchorReviewHint(pilotCase.updated, anchor);

            if (pilotCase.expected === 'correct') {
                expect(resolved, pilotCase.id).toBeTruthy();
                expect(review.needsReview, pilotCase.id).toBe(false);
                return;
            }

            expect(resolved, pilotCase.id).toBeUndefined();
            expect(review.needsReview, pilotCase.id).toBe(true);
        });
    }
});

function makeAnchor(docText: string, selectionText: string): KnowledgeAnchor {
    const startOffset = docText.indexOf(selectionText);
    if (startOffset === -1) {
        throw new Error(`Selection not found: ${selectionText}`);
    }
    const endOffset = startOffset + selectionText.length;
    const ctxN = 80;
    return {
        anchorId: 'a1',
        file: { workspaceRelativePath: 'src/pilot.ts' },
        associationLevel: 'block',
        rangeAtCapture: {
            start: posFromOffset(docText, startOffset),
            end: posFromOffset(docText, endOffset)
        },
        snapshot: { text: selectionText },
        fingerprint: {
            prefix: docText.slice(Math.max(0, startOffset - ctxN), startOffset),
            suffix: docText.slice(endOffset, Math.min(docText.length, endOffset + ctxN)),
            landmarkLines: selectionText
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length >= 4)
                .slice(0, 5)
        }
    };
}

function posFromOffset(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let lastLineStart = 0;
    for (let i = 0; i < text.length && i < offset; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
            lastLineStart = i + 1;
        }
    }
    return { line, character: offset - lastLineStart };
}
