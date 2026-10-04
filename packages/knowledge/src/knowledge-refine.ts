import type { KnowledgeCardType } from './schema.js';
import type { LlmClient } from './client.js';
import { knowledgeFieldRefinementSystemPrompt } from './knowledge-refine-prompt.js';

export type KnowledgeFieldRefinementTarget = 'content' | 'summary';
export interface KnowledgeFieldRefinementInput { target: KnowledgeFieldRefinementTarget; title?: string; type?: KnowledgeCardType; summary?: string; content?: string; codeSnapshot?: string; }
export interface KnowledgeFieldRefinementResult { target: KnowledgeFieldRefinementTarget; text: string; }
export interface RefineKnowledgeFieldOptions { model: string; client: LlmClient; timeoutMs?: number; }

export async function refineKnowledgeField(input: KnowledgeFieldRefinementInput, options: RefineKnowledgeFieldOptions): Promise<KnowledgeFieldRefinementResult> {
    const target = input.target === 'summary' ? 'summary' : 'content';
    const payload = { target, title: input.title?.trim() ?? '', type: input.type, summary: input.summary?.trim() ?? '', content: input.content?.trim() ?? '', codeSnapshot: input.codeSnapshot?.trim() ?? '' };
    const result = await options.client.complete({ model: options.model, messages: [{ role: 'system', content: knowledgeFieldRefinementSystemPrompt }, { role: 'user', content: `KNOWLEDGE FIELD REFINEMENT INPUT (JSON):\n${JSON.stringify(payload, undefined, 2)}` }], timeoutMs: options.timeoutMs });
    const text = normalizeRefinedText(result.text, target);
    if (!text) throw new Error(`LLM returned empty ${target}.`);
    return { target, text };
}

function normalizeRefinedText(text: string | undefined, target: KnowledgeFieldRefinementTarget): string { const stripped = String(text ?? '').replace(/^\s*```(?:markdown|md|text)?\s*/i, '').replace(/\s*```\s*$/i, '').trim(); return target === 'summary' ? stripped.replace(/\n{2,}/g, '\n').trim() : stripped; }
