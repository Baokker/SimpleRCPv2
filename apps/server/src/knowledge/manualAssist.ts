import crypto from "node:crypto";
import { extractKnowledgeCardDraft, type LlmClient, type LlmUsage } from "@simplercp/knowledge";
import { redactSensitive } from "../agent/traceStore.js";

export async function assistManualKnowledge(input: { description: string; selection?: { file: string; text: string }; client?: LlmClient; provider?: string; model: string; sensitiveValues?: string[] }) {
  if (typeof input.description !== "string" || !input.description.trim() || input.description.length > 8000) throw new Error("请用 1 至 8000 个字符描述这条知识");
  const evidence = redactSensitive({ description: input.description.trim(), ...(input.selection ? { selection: input.selection } : {}) }, input.sensitiveValues) as Record<string, unknown>;
  const started = Date.now();
  const promptHashes: string[] = [];
  const usage: LlmUsage = {};
  let fallback = false;
  let completed = false;
  const call = () => ({ at: started, mode: "manual-assist", provider: input.provider, model: input.model, durationMs: Date.now() - started, completed, fallback, attempts: promptHashes.length, promptHashes, usage });
  try {
    const draft = await extractKnowledgeCardDraft({ triggerType: "manual.assist", suggestedTitle: String(evidence.description).slice(0, 80), suggestedSummary: String(evidence.description).slice(0, 200), evidence, projectHints: { language: "zh", instructions: "使用中文整理成员描述，只依据描述和选中代码，不添加证据 JSON。代码标识符保持原样。附带 appliesTo：适用于整个项目时使用 {kind:project}，适用于一类文件时使用 {kind:glob,patterns:[路径模式]}。有选中代码时，界面会建议关联这段代码。" } }, {
      model: input.model, onFallback() { fallback = true; },
      client: input.client ? { async complete(request) {
        promptHashes.push(crypto.createHash("sha256").update(JSON.stringify(request.messages)).digest("hex"));
        const result = await input.client!.complete(request);
        for (const key of ["promptTokens", "completionTokens", "totalTokens", "reasoningTokens", "cost"] as const) if (result.usage?.[key] !== undefined) usage[key] = (usage[key] ?? 0) + result.usage[key]!;
        return { ...result, text: redactSensitive(result.text, input.sensitiveValues) as string };
      } } : undefined
    });
    completed = true;
    return { draft, fallback, applicability: input.selection ? { kind: "block" as const, file: input.selection.file } : draft.appliesTo ?? { kind: "project" as const }, call: call() };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { knowledgeCall: call() });
  }
}
