import type { KnowledgeActivityItem, RoomMember } from "../types";
import { knowledgeTriggers } from "../knowledgePresentation";

const categories = { capture: "捕获", confirmation: "确认", application: "应用", evolution: "演化" };

export function KnowledgeActivity({ items, members, onOpenCard, onOpenSuggestion }: { items: KnowledgeActivityItem[]; members: RoomMember[]; onOpenCard(id: string): void; onOpenSuggestion(id: string): void }) {
  const days = [...new Set(items.map(item => new Date(item.at).toLocaleDateString("zh-CN")))];
  if (!items.length) return <p className="empty-panel-state">项目还没有知识活动记录。</p>;
  return <>{days.map(day => <section className="knowledge-history-day" key={day}>
    <h3>{day}</h3>
    <ol className="knowledge-list">{items.filter(item => new Date(item.at).toLocaleDateString("zh-CN") === day).map(item => <li key={item.id} className="knowledge-timeline-item">
      <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString("zh-CN")}</time>
      <span className="ui-badge">{categories[item.category]}</span>
      {item.triggerType ? <span className="ui-badge">{knowledgeTriggers[item.triggerType] ?? "知识建议"}</span> : null}
      <button className="knowledge-text-button" onClick={() => { if (item.cardId) onOpenCard(item.cardId); else if (item.suggestionId) onOpenSuggestion(item.suggestionId); }}>
        {item.memberName ?? members.find(member => member.id === item.memberId)?.displayName ?? "系统"} {item.text}
        {item.participantIds?.length ? `（参与成员：${item.participantIds.map(id => members.find(member => member.id === id)?.displayName ?? "成员").join("、")}）` : ""}
      </button>
    </li>)}</ol>
  </section>)}</>;
}
