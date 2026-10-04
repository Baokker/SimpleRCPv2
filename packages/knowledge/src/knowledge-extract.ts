// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { KnowledgeCardType } from './schema.js';
import type { LlmClient } from './client.js';
import { knowledgeExtractionSystemPrompt } from './knowledge-prompt.js';

export interface KnowledgeExtractionInput {
    triggerType: string;
    suggestedType?: KnowledgeCardType;
    suggestedTitle?: string;
    suggestedSummary?: string;
    anchors?: unknown[];
    evidence: Record<string, unknown>;
    projectHints?: Record<string, unknown>;
}

export interface KnowledgeCardDraftV2 {
    type: KnowledgeCardType;
    title: string;
    summary: string;
    content: string;
    tags: string[];
    confidence: number;
    evidenceCitations: string[];
    unknowns: string[];
}

export interface ExtractKnowledgeCardDraftOptions {
    model: string;
    maxAttempts?: number;
    client?: LlmClient;
    timeoutMs?: number;
}

export async function extractKnowledgeCardDraft(
    input: KnowledgeExtractionInput,
    options: ExtractKnowledgeCardDraftOptions
): Promise<KnowledgeCardDraftV2> {
    const maxAttempts = Math.max(1, Math.min(3, Math.floor(options.maxAttempts ?? 3)));
    const baseTimeoutMs = options.timeoutMs ?? 30_000;
    const maxAbortRetries = 2;

    // Intentionally do NOT include suggested* fields in the model payload to avoid biasing outputs
    // toward fixed phrases. We still keep them in `input` for fallback/normalization.
    const payload = {
        triggerType: input.triggerType,
        anchors: input.anchors ?? [],
        projectHints: input.projectHints ?? {},
        evidence: input.evidence ?? {}
    };

    const baseUserMessage: { role: 'user'; content: string } = {
        role: 'user',
        content: `KNOWLEDGE EXTRACTION INPUT (JSON):\n${safeJsonStringify(payload, 24_000)}`
    };

    let lastText = '';
    let attempt = 1;
    while (attempt <= maxAttempts) {
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [baseUserMessage];
        if (attempt > 1) {
            messages.push({
                role: 'user',
                content:
                    `Your previous output was invalid or incomplete.\n` +
                    `You MUST output a single strict JSON object, and it MUST include non-empty: type, title, summary, content, evidenceCitations.\n` +
                    `Do not include markdown fences. Do not include extra text.\n` +
                    `Previous output:\n` +
                    lastText.slice(0, 8000)
            });
        }

        let abortRetries = 0;
        while (true) {
            const timeoutMs = Math.min(300_000, baseTimeoutMs * Math.max(1, Math.pow(2, abortRetries)));
            try {
                if (!options.client) return createHeuristicFallbackDraft(input);
                const result = await options.client.complete({ model: options.model, messages: [{ role: 'system', content: knowledgeExtractionSystemPrompt }, ...messages], responseFormat: { type: 'json_object' }, timeoutMs });
                lastText = result.text;
                break;
            } catch (err: any) {
                if (isAbortError(err) && abortRetries < maxAbortRetries) {
                    abortRetries++;
                    await sleepMs(250 * abortRetries);
                    continue;
                }
                throw err;
            }
        }

        const parsed = parseKnowledgeCardDraftFromText(lastText);
        const normalized = normalizeDraft(parsed, input);
        if (isAcceptableDraft(normalized, input)) {
            return normalized;
        }
        attempt++;
    }

    // Deterministic, grounded fallback (never invents facts).
    return createHeuristicFallbackDraft(input);
}

export function parseKnowledgeCardDraftFromText(text: string): Partial<KnowledgeCardDraftV2> {
    const jsonText = extractFirstJsonObject(text);
    if (!jsonText) {
        return {};
    }
    try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        return parsed as Partial<KnowledgeCardDraftV2>;
    } catch {
        return {};
    }
}

export function extractFirstJsonObject(text: string): string | undefined {
    const raw = String(text ?? '').trim();
    if (!raw) {
        return undefined;
    }

    const withoutFences = raw
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

    const start = withoutFences.indexOf('{');
    if (start === -1) {
        return undefined;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < withoutFences.length; i++) {
        const ch = withoutFences[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            depth++;
            continue;
        }
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return withoutFences.slice(start, i + 1);
            }
        }
    }
    return undefined;
}

function normalizeDraft(parsed: Partial<KnowledgeCardDraftV2>, input: KnowledgeExtractionInput): KnowledgeCardDraftV2 {
    const type = normalizeType(parsed.type, defaultTypeForTrigger(input.triggerType));
    const title = normalizeNonEmptyString(parsed.title, input.suggestedTitle, `[${input.triggerType}]`);
    const summary = normalizeNonEmptyString(parsed.summary, '');

    const evidenceCitationsRaw = normalizeStringArray((parsed as any).evidenceCitations);
    let evidenceCitations = filterResolvableCitations(evidenceCitationsRaw, input);
    const unknowns = normalizeStringArray((parsed as any).unknowns);

    let confidence = normalizeConfidence((parsed as any).confidence);
    if (!evidenceCitations.length) {
        evidenceCitations = defaultEvidenceCitations(input);
        confidence = Math.min(confidence, 0.55);
    }
    if (!summary) {
        confidence = Math.min(confidence, 0.6);
    }

    const tags = normalizeStringArray(parsed.tags).map(t => t.trim()).filter(Boolean).slice(0, 24);
    let content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    content = ensureGroundedSections(content, evidenceCitations, unknowns, input.evidence);

    const mustMention = readMustMention(input.projectHints);
    if (mustMention.length) {
        const hay = `${summary}\n${content}`;
        const ok = mustMention.some(m => m && hay.includes(m));
        if (!ok) {
            unknowns.push(`Draft did not mention any required hint strings (mustMention). Missing: ${mustMention.slice(0, 4).join(' | ')}`);
            confidence = Math.min(confidence, 0.58);
        }
    }

    return {
        type,
        title,
        summary,
        content,
        tags,
        confidence,
        evidenceCitations,
        unknowns
    };
}

function isAcceptableDraft(d: KnowledgeCardDraftV2, input: KnowledgeExtractionInput): boolean {
    if (!d) {
        return false;
    }
    if (!d.title || d.title.trim().length < 4) {
        return false;
    }
    if (!d.summary || d.summary.trim().length < 12) {
        return false;
    }
    if (!d.content || d.content.trim().length < 40) {
        return false;
    }
    if (!Array.isArray(d.evidenceCitations) || d.evidenceCitations.length < 1) {
        return false;
    }
    return true;
}

function ensureGroundedSections(
    content: string,
    evidenceCitations: string[],
    unknowns: string[],
    evidence: Record<string, unknown>
): string {
    const lines: string[] = [];
    if (content) {
        lines.push(content);
    }

    const hasEvidenceHeader = /\n##\s+Evidence\b/i.test('\n' + content);
    if (!hasEvidenceHeader) {
        lines.push('');
        lines.push('## Evidence');
        if (evidenceCitations.length) {
            for (const c of evidenceCitations.slice(0, 12)) {
                lines.push(`- ${c}`);
            }
        } else {
            lines.push('- (no citations provided)');
        }
        lines.push('');
        lines.push('```json');
        lines.push(safeJsonStringify(evidence ?? {}, 4000));
        lines.push('```');
    }

    const hasUnknownsHeader = /\n##\s+Unknowns\b/i.test('\n' + content);
    if (!hasUnknownsHeader && unknowns.length) {
        lines.push('');
        lines.push('## Unknowns');
        for (const u of unknowns.slice(0, 12)) {
            lines.push(`- ${u}`);
        }
    }

    return lines.join('\n').trim();
}

function normalizeType(value: unknown, fallback?: KnowledgeCardType): KnowledgeCardType {
    if (value === 'decision' || value === 'constraint' || value === 'risk' || value === 'context' || value === 'negative' || value === 'tutorial') {
        return value;
    }
    if (fallback === 'decision' || fallback === 'constraint' || fallback === 'risk' || fallback === 'context' || fallback === 'negative' || fallback === 'tutorial') {
        return fallback;
    }
    return 'context';
}

function defaultTypeForTrigger(triggerType: string): KnowledgeCardType {
    switch (triggerType) {
        case 'diagnostics.fixed':
        case 'todo.cleared':
            return 'tutorial';
        case 'magicNumber.added':
            return 'constraint';
        case 'packageJson.dependencySwitch':
            return 'decision';
        case 'rollback.detected':
            return 'risk';
        case 'chat.dense':
        default:
            return 'context';
    }
}

function readMustMention(projectHints: Record<string, unknown> | undefined): string[] {
    const raw = (projectHints as any)?.mustMention;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
        .map(s => (s.length > 140 ? s.slice(0, 140) : s))
        .slice(0, 12);
}

function filterResolvableCitations(citations: string[], input: KnowledgeExtractionInput): string[] {
    const root = {
        triggerType: input.triggerType,
        anchors: input.anchors ?? [],
        projectHints: input.projectHints ?? {},
        evidence: input.evidence ?? {}
    };
    const out: string[] = [];
    for (const c of citations) {
        let path = String(c ?? '').trim();
        if (!path) {
            continue;
        }
        if (path.startsWith('$.')) {
            path = path.slice(2);
        }
        if (path.startsWith('input.')) {
            path = path.slice('input.'.length);
        }
        if (path.startsWith('payload.')) {
            path = path.slice('payload.'.length);
        }
        if (!(
            path === 'evidence' ||
            path === 'anchors' ||
            path === 'projectHints' ||
            path.startsWith('evidence.') ||
            path.startsWith('anchors[') ||
            path.startsWith('anchors.') ||
            path.startsWith('projectHints.') ||
            path.startsWith('triggerType')
        )) {
            continue;
        }
        const resolved = resolveJsonPath(root as any, path);
        if (typeof resolved !== 'undefined') {
            out.push(path);
        }
    }
    return out.slice(0, 24);
}

function defaultEvidenceCitations(input: KnowledgeExtractionInput): string[] {
    const triggerType = input.triggerType;
    const candidates: string[] = [];
    switch (triggerType) {
        case 'diagnostics.fixed':
            candidates.push(
                'evidence.lastErrors[0].message',
                'evidence.errorSnippets[0].snippet',
                'evidence.beforeAfter.before',
                'evidence.beforeAfter.after',
                'evidence.editedRanges[0].startLine',
                'anchors[0].snapshot.text'
            );
            break;
        case 'todo.cleared':
            candidates.push(
                'evidence.todo.before[0].text',
                'evidence.diff.before',
                'evidence.diff.after',
                'anchors[0].snapshot.text'
            );
            break;
        case 'magicNumber.added':
            candidates.push(
                'evidence.added[0].number',
                'evidence.added[0].lineText',
                'evidence.usage[0].occurrences[0].context',
                'anchors[0].snapshot.text'
            );
            break;
        case 'packageJson.dependencySwitch':
            candidates.push(
                'evidence.added[0]',
                'evidence.removed[0]',
                'evidence.diff.before',
                'evidence.diff.after',
                'evidence.dependencyUsages'
            );
            break;
        case 'rollback.detected':
            candidates.push(
                'evidence.deletion.removedChars',
                'evidence.beforeAfter.before',
                'evidence.beforeAfter.after',
                'evidence.snapshots.beforeDelete',
                'evidence.snapshots.afterDelete',
                'anchors[0].snapshot.text'
            );
            break;
        case 'chat.dense':
        default:
            candidates.push(
                'evidence.chatMessages[0].text',
                'evidence.chatMessages[1].text',
                'evidence.chatContextItems[0].content'
            );
            break;
    }
    const filtered = filterResolvableCitations(candidates, input);
    return filtered.length ? filtered : ['evidence'];
}

function resolveJsonPath(root: any, path: string): unknown {
    // Supports a small JSONPath-like subset:
    // - dot: evidence.todo.before
    // - brackets: [0], ['key'], ["key"]
    // Returns undefined when not resolvable.
    let cur: any = root;
    let i = 0;
    const s = String(path ?? '').trim();
    const readIdentifier = (): string => {
        let start = i;
        while (i < s.length) {
            const ch = s[i] ?? '';
            if (!/[A-Za-z0-9_$]/.test(ch)) {
                break;
            }
            i++;
        }
        return s.slice(start, i);
    };
    const skipDot = () => {
        if (s[i] === '.') {
            i++;
        }
    };

    while (i < s.length) {
        skipDot();
        if (s[i] === '[') {
            i++;
            while (i < s.length && /\s/.test(s[i] ?? '')) {
                i++;
            }
            if (i >= s.length) {
                return undefined;
            }
            if (s[i] === '"' || s[i] === "'") {
                const quote = s[i++];
                let key = '';
                let escaped = false;
                while (i < s.length) {
                    const ch = s[i++];
                    if (escaped) {
                        key += ch;
                        escaped = false;
                        continue;
                    }
                    if (ch === '\\\\') {
                        escaped = true;
                        continue;
                    }
                    if (ch === quote) {
                        break;
                    }
                    key += ch;
                }
                while (i < s.length && s[i] !== ']') {
                    i++;
                }
                if (s[i] !== ']') {
                    return undefined;
                }
                i++;
                cur = cur?.[key];
                continue;
            }
            // number index
            let numText = '';
            while (i < s.length && /[0-9]/.test(s[i] ?? '')) {
                numText += s[i++];
            }
            while (i < s.length && s[i] !== ']') {
                i++;
            }
            if (s[i] !== ']') {
                return undefined;
            }
            i++;
            const idx = Number(numText);
            if (!Number.isFinite(idx)) {
                return undefined;
            }
            cur = cur?.[idx];
            continue;
        }

        const id = readIdentifier();
        if (!id) {
            return undefined;
        }
        cur = cur?.[id];
    }
    return cur;
}

function createHeuristicFallbackDraft(input: KnowledgeExtractionInput): KnowledgeCardDraftV2 {
    const type = defaultTypeForTrigger(input.triggerType);
    const title = normalizeNonEmptyString(input.suggestedTitle, `[${input.triggerType}]`);
    const evidence = (input.evidence ?? {}) as any;

    const unknowns: string[] = [];
    const citations: string[] = [];
    const tags: string[] = [];

    unknowns.push('LLM output was invalid/incomplete; this draft was generated by a deterministic fallback. Re-run AI Draft after improving evidence or adjusting the prompt/model.');

    const addCitationIf = (path: string, value: unknown) => {
        if (typeof value !== 'undefined' && value !== null) {
            citations.push(path);
        }
    };

    let summary = '';
    let contentLines: string[] = [];

    switch (input.triggerType) {
        case 'diagnostics.fixed': {
            const file = typeof evidence.file === 'string' ? evidence.file : '';
            const errs = Array.isArray(evidence.lastErrors) ? evidence.lastErrors : [];
            const msg0 = typeof errs?.[0]?.message === 'string' ? errs[0].message : '';
            addCitationIf('evidence.file', evidence.file);
            addCitationIf('evidence.lastErrors[0].message', errs?.[0]?.message);
            addCitationIf('evidence.beforeAfter.before', evidence?.beforeAfter?.before);
            addCitationIf('evidence.beforeAfter.after', evidence?.beforeAfter?.after);
            addCitationIf('evidence.editedRanges[0].startLine', evidence?.editedRanges?.[0]?.startLine);

            summary = summary || (msg0
                ? `Fixed diagnostics error: ${msg0}${file ? ` (${file})` : ''}.`
                : `Fixed diagnostics errors${file ? ` in ${file}` : ''}.`);
            contentLines = [
                '## What happened',
                file ? `- File: \`${file}\`` : '- File: (unknown)',
                errs.length ? `- Errors (examples):` : '- Errors: (unknown)',
                ...errs.slice(0, 4).map((e: any, idx: number) => `  - ${idx + 1}. ${String(e?.message ?? '')}${e?.source ? ` (${e.source})` : ''}`),
                '',
                '## What changed (before → after)',
                (typeof evidence?.beforeAfter?.before === 'string' && evidence.beforeAfter.before.trim().length > 0) &&
                (typeof evidence?.beforeAfter?.after === 'string' && evidence.beforeAfter.after.trim().length > 0)
                    ? [
                        '```diff',
                        String(evidence.beforeAfter.before),
                        '---',
                        String(evidence.beforeAfter.after),
                        '```'
                    ].join('\n')
                    : '(No before/after snippet captured in evidence.)',
                '',
                '## Takeaway',
                '- When a syntax/invalid-token diagnostic appears, inspect the exact offending character and surrounding separator/newline rules; fix with the smallest edit and re-run diagnostics.'
            ];
            if (!evidence?.beforeAfter) {
                unknowns.push('Exact code change that fixed the error (no before/after snippet in evidence).');
            }
            break;
        }
        case 'todo.cleared': {
            const file = typeof evidence.file === 'string' ? evidence.file : '';
            const before = evidence?.todo?.before;
            addCitationIf('evidence.todo.before[0].text', before?.[0]?.text);
            addCitationIf('evidence.diff.before', evidence?.diff?.before);
            addCitationIf('evidence.diff.after', evidence?.diff?.after);
            summary = summary || `Cleared TODO/FIXME markers${file ? ` in ${file}` : ''} on save.`;
            contentLines = [
                '## TODOs cleared',
                Array.isArray(before) && before.length
                    ? ['- Before (examples):', ...before.slice(0, 8).map((t: any) => `  - ${t?.token ?? 'TODO'} @ line ${t?.line ?? '?'}: ${String(t?.text ?? '')}`)].join('\n')
                    : '- Before: (unknown)',
                '',
                '## Change (before → after)',
                (typeof evidence?.diff?.before === 'string' && evidence.diff.before.trim().length > 0) &&
                (typeof evidence?.diff?.after === 'string' && evidence.diff.after.trim().length > 0)
                    ? ['```diff', String(evidence.diff.before), '---', String(evidence.diff.after), '```'].join('\n')
                    : '(No diff snippet captured in evidence.)',
                '',
                '## Guidance',
                '- Turn cleared TODOs into durable documentation: explain why the final implementation is correct and what to check if the issue reappears.'
            ];
            break;
        }
        case 'magicNumber.added': {
            const file = typeof evidence.file === 'string' ? evidence.file : '';
            const added = Array.isArray(evidence.added) ? evidence.added : [];
            const nums = [...new Set(added.map((a: any) => String(a?.number ?? '')).filter(Boolean))].slice(0, 6);
            if (nums.length) {
                tags.push('magic-number');
            }
            addCitationIf('evidence.added[0].number', added?.[0]?.number);
            addCitationIf('evidence.usage[0].occurrences[0].context', evidence?.usage?.[0]?.occurrences?.[0]?.context);
            summary = summary || `New magic number(s) added${nums.length ? `: ${nums.join(', ')}` : ''}${file ? ` in ${file}` : ''}.`;
            contentLines = [
                '## Added magic number(s)',
                nums.length ? `- Numbers: ${nums.join(', ')}` : '- Numbers: (unknown)',
                added.length ? `- Added lines (examples):` : '- Added lines: (unknown)',
                ...added.slice(0, 6).map((a: any) => `  - line ${a?.line ?? '?'}: ${String(a?.lineText ?? '')}`),
                '',
                '## Usage (context)',
                Array.isArray(evidence?.usage) && evidence.usage.length
                    ? evidence.usage.slice(0, 6).map((u: any) => {
                        const occ = Array.isArray(u?.occurrences) ? u.occurrences : [];
                        return [
                            `### ${String(u?.number ?? '')}`,
                            ...occ.slice(0, 6).map((o: any) => `- line ${o?.line ?? '?'}: ${String(o?.context ?? '')}`)
                        ].join('\n');
                    }).join('\n\n')
                    : '(No usage context captured in evidence.)',
                '',
                '## Recommendation',
                '- If the number has a domain meaning, extract it to a named constant/config and add a comment explaining the unit and valid range.'
            ];
            if (!nums.length) {
                unknowns.push('Which exact numeric literal(s) were added (not present in evidence.added).');
            }
            break;
        }
        case 'packageJson.dependencySwitch': {
            const file = typeof evidence.file === 'string' ? evidence.file : '';
            const added = Array.isArray(evidence.added) ? evidence.added : [];
            const removed = Array.isArray(evidence.removed) ? evidence.removed : [];
            if (added.length || removed.length) {
                tags.push('dependencies');
            }
            addCitationIf('evidence.added[0]', added?.[0]);
            addCitationIf('evidence.removed[0]', removed?.[0]);
            addCitationIf('evidence.dependencyUsages', evidence?.dependencyUsages);
            addCitationIf('evidence.diff.before', evidence?.diff?.before);
            addCitationIf('evidence.diff.after', evidence?.diff?.after);
            summary = summary || `package.json dependencies changed${file ? ` (${file})` : ''}: +${added.length}/-${removed.length}.`;
            contentLines = [
                '## Dependency change',
                added.length ? `- Added: ${added.slice(0, 12).join(', ')}` : '- Added: (none captured)',
                removed.length ? `- Removed: ${removed.slice(0, 12).join(', ')}` : '- Removed: (none captured)',
                '',
                '## package.json diff (before → after)',
                (typeof evidence?.diff?.before === 'string' && evidence.diff.before.trim().length > 0) &&
                (typeof evidence?.diff?.after === 'string' && evidence.diff.after.trim().length > 0)
                    ? ['```diff', String(evidence.diff.before), '---', String(evidence.diff.after), '```'].join('\n')
                    : '(No package.json diff snippet captured in evidence.)',
                '',
                '## Usage hits',
                typeof evidence?.dependencyUsages === 'object' && evidence?.dependencyUsages
                    ? Object.entries(evidence.dependencyUsages as any).slice(0, 6).map(([dep, hits]: any) => {
                        const arr = Array.isArray(hits) ? hits : [];
                        return [`- ${dep}:`, ...arr.slice(0, 6).map((h: any) => `  - ${h?.file ?? ''}:${h?.line ?? ''} ${String(h?.preview ?? '')}`)].join('\n');
                    }).join('\n')
                    : '(No usage hits captured in evidence.)',
                '',
                '## Notes',
                '- If this dependency switch was intentional, record the rationale (feature, bundle size, licensing, DX) and any migration steps.'
            ];
            if (!added.length && !removed.length) {
                unknowns.push('Which dependencies were added/removed (not present in evidence.added/evidence.removed).');
            }
            break;
        }
        case 'rollback.detected': {
            const file = typeof evidence.file === 'string' ? evidence.file : '';
            addCitationIf('evidence.deletedAt', evidence?.deletedAt);
            addCitationIf('evidence.beforeAfter.before', evidence?.beforeAfter?.before);
            addCitationIf('evidence.beforeAfter.after', evidence?.beforeAfter?.after);
            addCitationIf('evidence.deletion.removedChars', evidence?.deletion?.removedChars);
            addCitationIf('anchors[0].snapshot.text', (input.anchors as any)?.[0]?.snapshot?.text);
            summary = summary || `A large deletion was reverted shortly afterwards${file ? ` in ${file}` : ''}.`;
            contentLines = [
                '## Rollback detected',
                file ? `- File: \`${file}\`` : '- File: (unknown)',
                typeof evidence?.deletion?.removedChars === 'number' ? `- Removed chars (approx): ${evidence.deletion.removedChars}` : '- Removed chars: (unknown)',
                '',
                '## Before → after deletion (snippet)',
                (typeof evidence?.beforeAfter?.before === 'string' && evidence.beforeAfter.before.trim().length > 0) &&
                (typeof evidence?.beforeAfter?.after === 'string' && evidence.beforeAfter.after.trim().length > 0)
                    ? ['```diff', String(evidence.beforeAfter.before), '---', String(evidence.beforeAfter.after), '```'].join('\n')
                    : '(No before/after deletion snippet captured in evidence.)',
                '',
                '## Restored code snapshot (anchor)',
                typeof (input.anchors as any)?.[0]?.snapshot?.text === 'string' && String((input.anchors as any)[0].snapshot.text).trim()
                    ? ['```', String((input.anchors as any)[0].snapshot.text).trim().slice(0, 4000), '```'].join('\n')
                    : '(No anchor snapshot text available.)',
                '',
                '## Guidance',
                '- If rollbacks happen often, consider smaller commits, feature flags, or safer refactors to reduce “big delete then revert” cycles.'
            ];
            break;
        }
        case 'chat.dense':
        default: {
            const msgs = Array.isArray(evidence.chatMessages) ? evidence.chatMessages : [];
            addCitationIf('evidence.chatMessages[0].text', msgs?.[0]?.text);
            summary = summary || 'Summarize the recent discussion into durable knowledge (decisions, constraints, risks, pitfalls).';
            contentLines = [
                '## Discussion evidence (examples)',
                ...msgs.slice(0, 10).map((m: any, idx: number) => `- ${idx + 1}. ${String(m?.userName ?? 'User')}: ${String(m?.text ?? '')}`),
                '',
                '## Unknowns',
                '- Exact decisions/outcomes (requires human confirmation if not explicit in messages).'
            ];
            unknowns.push('Whether a final decision was made and what the accepted trade-offs were.');
            break;
        }
    }

    const mustMention = readMustMention(input.projectHints);
    const hay = `${summary}\n${contentLines.join('\n')}`;
    if (mustMention.length && !mustMention.some(m => m && hay.includes(m))) {
        unknowns.push('Required mustMention hint(s) were not present in the generated fallback; evidence may be incomplete.');
    }

    const content = [
        ...contentLines,
        '',
        '## Evidence',
        ...citations.slice(0, 12).map(c => `- ${c}`),
        '',
        unknowns.length ? ['## Unknowns', ...unknowns.slice(0, 12).map(u => `- ${u}`)].join('\n') : ''
    ].filter(Boolean).join('\n').trim();

    const normalizedCitations = filterResolvableCitations(citations, input);
    return {
        type,
        title,
        summary: summary || `[${input.triggerType}]`,
        content,
        tags: [...new Set(tags)].slice(0, 24),
        confidence: 0.45,
        evidenceCitations: normalizedCitations.length ? normalizedCitations : ['evidence'],
        unknowns: unknowns.slice(0, 24)
    };
}

function normalizeNonEmptyString(...candidates: Array<unknown>): string {
    for (const c of candidates) {
        const s = typeof c === 'string' ? c.trim() : '';
        if (s) {
            return s;
        }
    }
    return '';
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(v => (typeof v === 'string' ? v : '')).map(s => s.trim()).filter(Boolean);
}

function normalizeConfidence(value: unknown): number {
    const n = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(n)) {
        return 0.65;
    }
    return Math.max(0, Math.min(1, n));
}

function safeJsonStringify(value: unknown, maxChars: number): string {
    let text = '';
    try {
        text = JSON.stringify(value, undefined, 2);
    } catch {
        text = '{}';
    }
    if (text.length <= maxChars) {
        return text;
    }
    return text.slice(0, maxChars) + '\n...';
}

function isAbortError(err: unknown): boolean {
    const anyErr = err as any;
    const name = typeof anyErr?.name === 'string' ? anyErr.name : '';
    const msg = typeof anyErr?.message === 'string' ? anyErr.message : String(err ?? '');
    return name === 'AbortError' || /aborted/i.test(msg);
}

function sleepMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
