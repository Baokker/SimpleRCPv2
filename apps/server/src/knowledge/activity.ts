import type { KnowledgeCard } from "@simplercp/knowledge";
import type { EventRecord } from "../types.js";
import { L } from "@simplercp/knowledge/util/lang";

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
    const text = entry.summary ? `${entry.summary}（${card.title}）` : (entry.action === "confirmed" ? L("{0}了「{1}」", card.review?.editedBeforeConfirm ? L("修改并确认") : L("确认"), card.title) : entry.action === "scopeChanged" ? L("将「{0}」升级为团队知识", card.title) : entry.action === "archived" ? L("归档了「{0}」{1}", card.title, entry.note ? `：${entry.note}` : "") : entry.action === "superseded" ? L("「{0}」已被另一张卡片取代", card.title) : entry.action === "recurrence" ? L("为「{0}」记录了一次复现", card.title) : entry.note === "anchor review" ? L("「{0}」需要复核关联代码", card.title) : L("{0}（{1}）", entry.note ?? L("完成复核"), card.title));
    items.push({ id: `${card.id}:${index}`, at: entry.at, category: confirmed ? "confirmation" : "evolution", memberId: entry.by?.peerId, memberName: entry.by?.name, text, cardId: card.id });
  }
  const captured = new Set<string>();
  for (const suggestion of suggestions) {
    captured.add(suggestion.id);
    items.push({ id: `suggestion:${suggestion.id}`, at: suggestion.createdAt, category: "capture", triggerType: suggestion.triggerType, participantIds: suggestion.actors.memberIds, text: L("发现知识建议：{0}", suggestion.suggestedSummary ?? suggestion.suggestedTitle ?? L("请查看原始证据")), suggestionId: suggestion.id, cardId: cards.find(card => card.provenance?.trigger?.suggestionId === suggestion.id)?.id });
  }
  for (const event of events) {
    if (event.type === "knowledge_suggestion_created" && typeof event.payload?.suggestionId === "string" && !captured.has(event.payload.suggestionId)) {
      const id = event.payload.suggestionId;
      captured.add(id);
      const actors = event.payload.actors as string[] | { memberIds?: string[] } | undefined;
      items.push({ id: `suggestion:${id}`, at: Date.parse(event.timestamp), category: "capture", triggerType: typeof event.payload.trigger === "string" ? event.payload.trigger : undefined, participantIds: Array.isArray(actors) ? actors : actors?.memberIds, text: L("发现知识建议：{0}", String(event.payload.summary ?? event.payload.title ?? L("请查看原始证据"))), suggestionId: id, cardId: cards.find(card => card.provenance?.trigger?.suggestionId === id)?.id });
    }
    if (!["knowledge_injected", "knowledge_post_check", "knowledge_tool_used"].includes(event.type)) continue;
    const payload = event.payload ?? {};
    const ids = event.type === "knowledge_post_check" && Array.isArray(payload.hits) ? payload.hits.map(hit => (hit as { cardId?: string }).cardId) : Array.isArray(payload.cardIds) ? payload.cardIds : [];
    for (const id of new Set(ids)) {
      if (typeof id !== "string" || !byId.has(id)) continue;
      items.push({ id: `${event.id}:${id}`, at: Date.parse(event.timestamp), category: "application", memberId: event.memberId, text: event.type === "knowledge_post_check" ? L("任务后核对发现修改涉及「{0}」", byId.get(id)!.title) : L("Agent 任务{0}了「{1}」", event.type === "knowledge_tool_used" ? L("通过工具读取") : L("参考"), byId.get(id)!.title), cardId: id, runId: typeof payload.runId === "string" ? payload.runId : undefined });
    }
  }
  return items.sort((left, right) => right.at - left.at);
}
