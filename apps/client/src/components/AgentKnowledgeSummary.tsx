import { BookOpen, CheckCircle2, CircleAlert, FileCode2 } from "lucide-react";
import type { AgentTraceEvent, KnowledgeCard } from "../types";
import { L } from "../i18n/legacy";

interface PostCheckHit {
  cardId: string;
  file: string;
  lines: { start: number; end: number };
  checkResult?: { passed: boolean; message: string };
}

export function AgentKnowledgeSummary({
  trace,
  cards,
  updateCardIds = [],
  testIdPrefix,
  onOpenFile
}: {
  trace: AgentTraceEvent[];
  cards: KnowledgeCard[];
  updateCardIds?: string[];
  testIdPrefix: "agent" | "chat-agent";
  onOpenFile(path: string): void;
}) {
  const injection = trace.find(event => event.type === "knowledge_injected");
  const references = (injection?.data?.cards as Array<{ id: string; title: string }> | undefined) ?? [];
  const postCheck = trace.find(event => event.type === "knowledge_post_check");
  const hits = (postCheck?.data?.hits as PostCheckHit[] | undefined) ?? [];
  const failed = hits.some(hit => hit.checkResult?.passed === false);
  const cardTitle = (id: string) => cards.find(card => card.id === id)?.title
    ?? references.find(card => card.id === id)?.title
    ?? L("查看相关知识卡片");

  return (
    <>
      {updateCardIds.length ? (
        <section className="agent-knowledge-card agent-knowledge-update" data-testid={`${testIdPrefix}-knowledge-update`}>
          <h4><CircleAlert size={15} aria-hidden="true" />{L("有新的知识可参考")}</h4>
          <p>{L("任务运行期间确认了以下知识，可在下一次任务中参考。")}</p>
          <ul className="agent-knowledge-list">
            {updateCardIds.map(id => <li key={id}><button type="button" onClick={() => openKnowledgeCard(id)}><BookOpen size={14} aria-hidden="true" />{cardTitle(id)}</button></li>)}
          </ul>
        </section>
      ) : null}
      {injection ? (
        <section className="agent-knowledge-card agent-knowledge-reference" data-testid={`${testIdPrefix}-knowledge-reference`}>
          <h4><BookOpen size={15} aria-hidden="true" />{L("本次参考的知识")}<span className="ui-badge">{references.length} {L("条")}</span></h4>
          {references.length ? (
            <ul className="agent-knowledge-list">
              {references.map(card => <li key={card.id}><button type="button" onClick={() => openKnowledgeCard(card.id)}>{card.title}</button></li>)}
            </ul>
          ) : <p>{L("本次任务未参考知识卡片。")}</p>}
        </section>
      ) : null}
      {postCheck ? (
        <section className={`agent-knowledge-card agent-knowledge-post-check${failed ? " failed" : ""}`} data-testid={`${testIdPrefix}-knowledge-post-check`}>
          <h4>{failed ? <CircleAlert size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}{L("任务后核对")}</h4>
          <p>{hits.length ? L("这些修改涉及已知问题，共 {0} 处。", hits.length) : L("未发现已知问题。")}</p>
          {hits.length ? (
            <ul className="agent-knowledge-list">
              {hits.map((hit, index) => (
                <li key={`${hit.cardId}-${hit.file}-${index}`} className={hit.checkResult?.passed === false ? "failed" : ""}>
                  <button type="button" onClick={() => openKnowledgeCard(hit.cardId)}>{cardTitle(hit.cardId)}</button>
                  <button type="button" className="agent-knowledge-location" onClick={() => onOpenFile(hit.file)}><FileCode2 size={13} aria-hidden="true" />{hit.file}<span>{L("第")} {hit.lines.start}–{hit.lines.end} {L("行")}</span></button>
                  <span className={`ui-badge ${hit.checkResult ? hit.checkResult.passed ? "success" : "error" : "warning"}`}>
                    {hit.checkResult ? hit.checkResult.passed ? L("检查通过") : L("检查未通过") : L("请人工核对")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function openKnowledgeCard(cardId: string) {
  window.dispatchEvent(new CustomEvent("knowledge-open-card", { detail: cardId }));
}
