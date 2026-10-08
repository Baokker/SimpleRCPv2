import { BookOpen, CircleAlert, Compass, GitBranch, Info, ShieldCheck } from "lucide-react";
import type { KnowledgeCard, KnowledgeCardType, KnowledgeTimelineItem } from "./types";

export const knowledgeTypes = {
  decision: { label: "决策", icon: GitBranch },
  constraint: { label: "约束", icon: ShieldCheck },
  risk: { label: "风险", icon: CircleAlert },
  context: { label: "上下文", icon: Info },
  negative: { label: "负向经验", icon: Compass },
  tutorial: { label: "教程", icon: BookOpen }
} satisfies Record<KnowledgeCardType, { label: string; icon: typeof BookOpen }>;

export const knowledgeStatuses = { draft: "草稿", reviewed: "有效", needsReview: "待复核", archived: "已归档", superseded: "已归档", orphaned: "待复核" };
export const knowledgeScopes = { team: "团队", personal: "个人", proposedTeam: "待确认" };
export const knowledgeTriggers: Record<string, string> = {
  "chat.dense": "讨论中发现的知识", "todo.cleared": "待办处理完成", "magicNumber.added": "新增数字常量",
  "dependency.changed": "依赖配置变化", "packageJson.dependencySwitch": "依赖切换", "rollback.detected": "代码恢复记录",
  "diagnostics.fixed": "诊断问题修复", "edit.overwritten": "成员改写了协作内容", "agent.interrupted": "Agent 任务被打断",
  "agent.revised": "成员改写了 Agent 的内容", "agent.corrected": "对 Agent 追加纠正", "agent.retried": "Agent 重试成功",
  "agent.toolRecovered": "Agent 修复了命令错误", "agent.proposed": "Agent 提议的知识", "preset.imported": "规范文档草稿"
};

export function pendingKnowledgeSeen(projectId: string, memberId: string, card: KnowledgeCard) {
  return Number(sessionStorage.getItem(`simplercp.knowledge.pending.${projectId}.${memberId}.${card.id}`)) >= card.updatedAt;
}

export function markPendingKnowledgeSeen(projectId: string, memberId: string, cards: KnowledgeCard[]) {
  const changed = cards.some(card => !pendingKnowledgeSeen(projectId, memberId, card));
  for (const card of cards) sessionStorage.setItem(`simplercp.knowledge.pending.${projectId}.${memberId}.${card.id}`, String(card.updatedAt));
  if (changed) window.dispatchEvent(new Event("knowledge-pending-read"));
}

export function timelineDescription(item: KnowledgeTimelineItem, members: Array<{ id: string; displayName: string }> = []) {
  const entry = item.evolution;
  const actor = entry?.by ? entry.by.name ?? members.find(member => member.id === entry.by?.peerId)?.displayName ?? "成员" : item.card.metadata?.createdBy?.name ?? "成员";
  if (!entry) return item.kind === "created" ? `${actor} 创建了这张卡片` : "这张卡片更新了内容";
  const note = entry.note;
  if (entry.summary) return `${actor} ${entry.summary}`;
  if (note === "anchor review") return entry.action === "orphaned" ? "关联的代码长期无法定位，仍需复核" : "代码发生较大变化，标记为待复核";
  if (note === "reanchor") return `${actor} 重新关联了代码锚点`;
  if (entry.action === "recurrence") return `${actor} 作为复现记录第 ${item.card.evolution.filter(candidate => candidate.action === "recurrence" && candidate.at <= entry.at).length} 次`;
  if (entry.action === "superseded") return `${actor} 记录了知识替代关系`;
  if (note && /^(contradicts|duplicates|refines):/.test(note)) return `${actor} 建立了${{ contradicts: "矛盾", duplicates: "重复", refines: "补充说明" }[note.split(":")[0] as "contradicts" | "duplicates" | "refines"]}关系`;
  const labels = {
    created: "创建了这张卡片", updated: "修改了这张卡片", confirmed: "确认了这张卡片", reviewed: "完成了复核",
    archived: "归档了这张卡片", orphaned: "关联的代码长期无法定位，仍需复核", scopeChanged: note === "proposedTeam" ? "申请升级为团队知识" : note === "team" ? "确认升级为团队知识" : "修改了作用域",
    superseded: "记录了知识替代关系", recurrence: "记录了一次复现"
  };
  return `${actor} ${labels[entry.action]}${note && !["proposedTeam", "team"].includes(note) ? `：${note}` : ""}`;
}

export function distinctTimeline(items: KnowledgeTimelineItem[]) {
  return items.filter(item => item.kind === "evolution" || !items.some(other => other.card.id === item.card.id && other.kind === "evolution" && other.at === item.at))
    .sort((left, right) => right.at - left.at);
}
