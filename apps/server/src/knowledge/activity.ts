import type { KnowledgeCard } from "@simplercp/knowledge";
import type { EventRecord } from "../types.js";

export interface KnowledgeActivityItem {
  id: string; at: number; category: "capture" | "confirmation" | "application" | "evolution";
  memberId?: string; memberName?: string; text: string; cardId?: string; suggestionId?: string; runId?: string; triggerType?: string; participantIds?: string[];
}

export function buildKnowledgeActivity(cards: KnowledgeCard[], suggestions: Array<{ id: string; createdAt: number; triggerType: string; suggestedSummary?: string; suggestedTitle?: string; actors: { memberIds: string[] } }>, events: EventRecord[]): KnowledgeActivityItem[] {
  const items: KnowledgeActivityItem[] = [];
  const byId = new Map(cards.map(card => [card.id, card]));
  for (const card of cards) for (const [index, entry] of card.evolution.entries()) {
    const confirmed = entry.action === "confirmed" || (entry.action === "scopeChanged" && entry.note === "team");
    const evolving = ["reviewed", "archived", "orphaned", "recurrence", "superseded"].includes(entry.action) || entry.note === "anchor review";
    if (!confirmed && !evolving) continue;
    const text = entry.summary ? `${entry.summary}（${card.title}）` : (entry.action === "confirmed" ? `${card.review?.editedBeforeConfirm ? "修改并确认" : "确认"}了「${card.title}」` : entry.action === "scopeChanged" ? `将「${card.title}」升级为团队知识` : entry.action === "archived" ? `归档了「${card.title}」${entry.note ? `：${entry.note}` : ""}` : entry.action === "superseded" ? `「${card.title}」已被另一张卡片取代` : entry.action === "recurrence" ? `为「${card.title}」记录了一次复现` : entry.note === "anchor review" ? `「${card.title}」需要复核关联代码` : `${entry.note ?? "完成复核"}（${card.title}）`);
    items.push({ id: `${card.id}:${index}`, at: entry.at, category: confirmed ? "confirmation" : "evolution", memberId: entry.by?.peerId, memberName: entry.by?.name, text, cardId: card.id });
  }
  const captured = new Set<string>();
  for (const suggestion of suggestions) {
    captured.add(suggestion.id);
    items.push({ id: `suggestion:${suggestion.id}`, at: suggestion.createdAt, category: "capture", triggerType: suggestion.triggerType, participantIds: suggestion.actors.memberIds, text: `发现知识建议：${suggestion.suggestedSummary ?? suggestion.suggestedTitle ?? "请查看原始证据"}`, suggestionId: suggestion.id, cardId: cards.find(card => card.provenance?.trigger?.suggestionId === suggestion.id)?.id });
  }
  for (const event of events) {
    if (event.type === "knowledge_suggestion_created" && typeof event.payload?.suggestionId === "string" && !captured.has(event.payload.suggestionId)) {
      const id = event.payload.suggestionId;
      captured.add(id);
      const actors = event.payload.actors as string[] | { memberIds?: string[] } | undefined;
      items.push({ id: `suggestion:${id}`, at: Date.parse(event.timestamp), category: "capture", triggerType: typeof event.payload.trigger === "string" ? event.payload.trigger : undefined, participantIds: Array.isArray(actors) ? actors : actors?.memberIds, text: `发现知识建议：${String(event.payload.summary ?? event.payload.title ?? "请查看原始证据")}`, suggestionId: id, cardId: cards.find(card => card.provenance?.trigger?.suggestionId === id)?.id });
    }
    if (!["knowledge_injected", "knowledge_post_check", "knowledge_tool_used"].includes(event.type)) continue;
    const payload = event.payload ?? {};
    const ids = event.type === "knowledge_post_check" && Array.isArray(payload.hits) ? payload.hits.map(hit => (hit as { cardId?: string }).cardId) : Array.isArray(payload.cardIds) ? payload.cardIds : [];
    for (const id of new Set(ids)) {
      if (typeof id !== "string" || !byId.has(id)) continue;
      items.push({ id: `${event.id}:${id}`, at: Date.parse(event.timestamp), category: "application", memberId: event.memberId, text: event.type === "knowledge_post_check" ? `任务后核对发现修改涉及「${byId.get(id)!.title}」` : `Agent 任务${event.type === "knowledge_tool_used" ? "通过工具读取" : "参考"}了「${byId.get(id)!.title}」`, cardId: id, runId: typeof payload.runId === "string" ? payload.runId : undefined });
    }
  }
  return items.sort((left, right) => right.at - left.at);
}
