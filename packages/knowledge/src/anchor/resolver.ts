import type { KnowledgeAnchor, TextRange } from '../schema/card.js';

export interface ResolvedAnchor {
    startOffset: number;
    endOffset: number;
    /** 0..1 */
    confidence: number;
}

const DEFAULT_CONTEXT_SEARCH_WINDOW = 4_000;

export function resolveKnowledgeAnchorInText(docText: string, anchor: KnowledgeAnchor): ResolvedAnchor | undefined {
    const selectionText = anchor.snapshot?.text ?? '';
    if (!selectionText) {
        return undefined;
    }

    // 1) Range check (fast path).
    if (anchor.rangeAtCapture) {
        const rangeOffsets = offsetsFromRange(docText, anchor.rangeAtCapture);
        if (rangeOffsets) {
            const slice = docText.slice(rangeOffsets.startOffset, rangeOffsets.endOffset);
            if (slice === selectionText) {
                return { ...rangeOffsets, confidence: 1 };
            }
        }
    }

    // 2) Exact search (unique).
    const first = docText.indexOf(selectionText);
    if (first !== -1) {
        const second = docText.indexOf(selectionText, first + 1);
        if (second === -1) {
            return { startOffset: first, endOffset: first + selectionText.length, confidence: 0.95 };
        }
    }

    // 3) Fuzzy: derive candidates from landmark lines.
    const fp = anchor.fingerprint;
    const landmarks = (fp?.landmarkLines ?? []).filter(Boolean);
    if (!landmarks.length) {
        return undefined;
    }

    const candidates: ResolvedAnchor[] = [];
    for (const landmark of landmarks) {
        const occ = allOccurrences(docText, landmark, 200);
        if (!occ.length) {
            continue;
        }
        const inSelectionIndex = selectionText.indexOf(landmark);
        if (inSelectionIndex === -1) {
            continue;
        }
        for (const pos of occ) {
            const startCandidate = pos - inSelectionIndex;
            const scored = scoreCandidate(docText, selectionText, startCandidate, fp?.prefix ?? '', fp?.suffix ?? '');
            if (scored) {
                candidates.push(scored);
            }
        }
    }

    if (!candidates.length) {
        return undefined;
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    if (!best || best.confidence < 0.35) {
        return undefined;
    }
    return best;
}

export function offsetsFromRange(docText: string, range: TextRange): { startOffset: number; endOffset: number } | undefined {
    const lineStarts = computeLineStarts(docText);
    const startOffset = offsetAt(lineStarts, range.start.line, range.start.character);
    const endOffset = offsetAt(lineStarts, range.end.line, range.end.character);
    if (startOffset === undefined || endOffset === undefined) {
        return undefined;
    }
    if (startOffset < 0 || endOffset < startOffset || endOffset > docText.length) {
        return undefined;
    }
    return { startOffset, endOffset };
}

function scoreCandidate(
    docText: string,
    selectionText: string,
    startOffset: number,
    prefixContext: string,
    suffixContext: string
): ResolvedAnchor | undefined {
    if (startOffset < 0 || startOffset >= docText.length) {
        return undefined;
    }
    const endOffset = startOffset + selectionText.length;
    if (endOffset < 0 || endOffset > docText.length) {
        return undefined;
    }

    if (docText.slice(startOffset, endOffset) === selectionText) {
        return { startOffset, endOffset, confidence: 0.9 };
    }

    let score = 0;
    let max = 0;

    if (prefixContext) {
        max += 1;
        const prefixStart = Math.max(0, startOffset - prefixContext.length);
        const actual = docText.slice(prefixStart, startOffset);
        if (actual.endsWith(prefixContext)) {
            score += 1;
        }
    }

    if (suffixContext) {
        max += 1;
        const suffixEnd = Math.min(docText.length, endOffset + suffixContext.length);
        const actual = docText.slice(endOffset, suffixEnd);
        if (actual.startsWith(suffixContext)) {
            score += 1;
        }
    }

    if (!max) {
        return undefined;
    }

    const windowStart = Math.max(0, startOffset - DEFAULT_CONTEXT_SEARCH_WINDOW);
    const windowEnd = Math.min(docText.length, endOffset + DEFAULT_CONTEXT_SEARCH_WINDOW);
    const windowHasSelectionPrefix = prefixContext ? docText.slice(windowStart, startOffset).includes(prefixContext.slice(-Math.min(40, prefixContext.length))) : true;
    const windowHasSelectionSuffix = suffixContext ? docText.slice(endOffset, windowEnd).includes(suffixContext.slice(0, Math.min(40, suffixContext.length))) : true;
    if (windowHasSelectionPrefix && windowHasSelectionSuffix) {
        score += 0.25;
        max += 0.25;
    }

    return { startOffset, endOffset, confidence: score / max };
}

function allOccurrences(haystack: string, needle: string, maxHits: number): number[] {
    if (!needle) {
        return [];
    }
    const hits: number[] = [];
    let idx = 0;
    while (hits.length < maxHits) {
        const found = haystack.indexOf(needle, idx);
        if (found === -1) {
            break;
        }
        hits.push(found);
        idx = found + Math.max(1, needle.length);
    }
    return hits;
}

function computeLineStarts(text: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10 /* \n */) {
            starts.push(i + 1);
        }
    }
    return starts;
}

function offsetAt(lineStarts: number[], line: number, character: number): number | undefined {
    if (line < 0 || character < 0 || line >= lineStarts.length) {
        return undefined;
    }
    const start = lineStarts[line];
    if (start === undefined) {
        return undefined;
    }
    const nextStart = line + 1 < lineStarts.length ? lineStarts[line + 1] : undefined;
    const lineEnd = nextStart !== undefined ? nextStart - 1 : undefined;
    const maxChar = lineEnd !== undefined ? Math.max(0, lineEnd - start) : Number.MAX_SAFE_INTEGER;
    const ch = Math.min(character, maxChar);
    return start + ch;
}
