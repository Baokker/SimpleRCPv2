import { describe, expect, test } from 'vitest';
import { resolveKnowledgeAnchorInText } from '../src/anchor-resolver.js';
import type { KnowledgeAnchor } from '../src/schema/card.js';

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

function makeRange(text: string, startOffset: number, endOffset: number) {
    return { start: posFromOffset(text, startOffset), end: posFromOffset(text, endOffset) };
}

function makeAnchor(docText: string, startOffset: number, endOffset: number): KnowledgeAnchor {
    const selectionText = docText.slice(startOffset, endOffset);
    const rangeAtCapture = makeRange(docText, startOffset, endOffset);
    const ctxN = 80;
    const prefix = docText.slice(Math.max(0, startOffset - ctxN), startOffset);
    const suffix = docText.slice(endOffset, Math.min(docText.length, endOffset + ctxN));
    const landmarkLines = selectionText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && l.length >= 4)
        .slice(0, 5);

    return {
        anchorId: 'a1',
        file: { workspaceRelativePath: 'src/test.ts' },
        associationLevel: 'block',
        rangeAtCapture,
        snapshot: { text: selectionText },
        fingerprint: {
            prefix,
            suffix,
            landmarkLines
        }
    };
}

describe('knowledge anchor resolver', () => {
    test('resolves when document is unchanged (range fast-path)', () => {
        const doc = 'function a() {\n  return 1;\n}\n';
        const start = doc.indexOf('return 1;');
        const end = start + 'return 1;'.length;
        const anchor = makeAnchor(doc, start, end);
        const resolved = resolveKnowledgeAnchorInText(doc, anchor);
        expect(resolved).toBeTruthy();
        expect(resolved?.startOffset).toBe(start);
        expect(resolved?.confidence).toBe(1);
    });

    test('inserting a line above shifts offsets but still resolves (unique exact search)', () => {
        const doc = 'function a() {\n  return 1;\n}\n';
        const start = doc.indexOf('return 1;');
        const end = start + 'return 1;'.length;
        const anchor = makeAnchor(doc, start, end);

        const updated = '// header\n' + doc;
        const resolved = resolveKnowledgeAnchorInText(updated, anchor);
        expect(resolved).toBeTruthy();
        expect(resolved?.startOffset).toBe(start + '// header\n'.length);
    });

    test('when selection text occurs multiple times, uses context to pick the right one', () => {
        const doc =
            'function a(){\n' +
            '  console.log("x");\n' +
            '}\n' +
            'function b(){\n' +
            '  console.log("x");\n' +
            '}\n';
        const first = doc.indexOf('console.log("x");');
        const second = doc.indexOf('console.log("x");', first + 1);
        const end = second + 'console.log("x");'.length;
        const anchor = makeAnchor(doc, second, end);

        const resolved = resolveKnowledgeAnchorInText(doc, anchor);
        expect(resolved).toBeTruthy();
        expect(resolved?.startOffset).toBe(second);
    });

    test('when selection text was modified, can still resolve via prefix/suffix context', () => {
        const doc =
            'function a(){\n' +
            '  const v = 1;\n' +
            '  return v;\n' +
            '}\n';
        const start = doc.indexOf('const v');
        const end = doc.indexOf('return v;') + 'return v;'.length;
        const anchor = makeAnchor(doc, start, end);

        const updated =
            'function a(){\n' +
            '  const v = 2;\n' +
            '  return v;\n' +
            '}\n';

        const resolved = resolveKnowledgeAnchorInText(updated, anchor);
        expect(resolved).toBeTruthy();
        expect(resolved?.startOffset).toBe(updated.indexOf('const v'));
    });
});
