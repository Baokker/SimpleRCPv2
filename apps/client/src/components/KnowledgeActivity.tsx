import type { KnowledgeActivityItem, RoomMember } from "../types";
import { knowledgeTriggers } from "../knowledgePresentation";
import { L, dateLocale } from "../i18n/legacy";

const categories = { capture: L("捕获"), confirmation: L("确认"), application: L("应用"), evolution: L("演化") };

export function KnowledgeActivity({ items, members, onOpenCard, onOpenSuggestion }: { items: KnowledgeActivityItem[]; members: RoomMember[]; onOpenCard(id: string): void; onOpenSuggestion(id: string): void }) {
  const days = [...new Set(items.map(item => new Date(item.at).toLocaleDateString(dateLocale())))];
  if (!items.length) return <p className="empty-panel-state">{L("项目还没有知识活动记录。")}</p>;
  return <>{days.map(day => <section className="knowledge-history-day" key={day}>
    <h3>{day}</h3>
    <ol className="knowledge-list">{items.filter(item => new Date(item.at).toLocaleDateString(dateLocale()) === day).map(item => <li key={item.id} className="knowledge-timeline-item">
      <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString(dateLocale())}</time>
      <span className="ui-badge">{categories[item.category]}</span>
      {item.triggerType ? <span className="ui-badge">{knowledgeTriggers[item.triggerType] ?? L("知识建议")}</span> : null}
      <button className="knowledge-text-button" onClick={() => { if (item.cardId) onOpenCard(item.cardId); else if (item.suggestionId) onOpenSuggestion(item.suggestionId); }}>
        {item.memberName ?? members.find(member => member.id === item.memberId)?.displayName ?? L("系统")} {item.text}
        {item.participantIds?.length ? L("（参与成员：{0}）", item.participantIds.map(id => members.find(member => member.id === id)?.displayName ?? L("成员")).join("、")) : ""}
      </button>
    </li>)}</ol>
  </section>)}</>;
}
