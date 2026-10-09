import { ArrowRight, BarChart3, Bot, Check, CheckCheck, ChevronDown, Download, GitBranch, MessageSquareText, ShieldAlert, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { acknowledgeConflictWarning, actOnOwnerCard, confirmConflictPair, downloadConflictGuardTrace, getConflictGuardSymbol, revertConflictPair } from "../api";
import type { ActiveSymbol, AgentIntent, ConflictGuardState, ConflictGuardSymbol, GuardActorRef, GuardConflict } from "../conflictGuardTypes";
import type { RoomMember } from "../types";
import { relationPathLines, guardActorName, guardActorKey, humanConflict, conflictActionCount, guardDecisionCounts } from "../conflictGuardPresentation";
import { activeSymbolRows, pairKind, pairKindLabels, pairMatches, type GuardListFilter, type PairKind } from "../conflictGuardFilters";
import { decisionName, guardCheckLabels, readableGuardText, ruleName, zoneName } from "../conflictGuardLabels";
import { GuardBadge, GuardMetrics, GuardScope, ReadableText } from "./ConflictGuardText";

const statuses = { modified: "修改", added: "新增", deleted: "删除" };
type ListKey = "active" | "candidates" | "checks";
interface PanelPreferences {
  progressOpen: boolean;
  historyOpen: boolean;
  filters: Record<ListKey, GuardListFilter>;
  limits: Record<ListKey | "intents" | "actions" | "persists" | "warnings", number>;
}
const defaultPreferences: PanelPreferences = {
  progressOpen: false, historyOpen: false,
  filters: { active: { kinds: [], mine: false }, candidates: { kinds: [], mine: false }, checks: { kinds: [], mine: false } },
  limits: { active: 10, candidates: 10, checks: 20, intents: 10, actions: 10, persists: 10, warnings: 10 }
};

export function ConflictGuardPanel({ state, projectId, members, memberId, onOpenSymbol, onError, onChat }: {
  state: ConflictGuardState;
  projectId: string;
  members: RoomMember[];
  memberId?: string;
  onOpenSymbol(file: string, line: number): void;
  onError(error: unknown): void;
  onChat(text: string, pairId: string): void;
}) {
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});
  const [intents, setIntents] = useState<AgentIntent[]>(state.intents ?? []);
  const storageKey = `simplercp.conflictGuard.panel.${projectId}.${memberId ?? "visitor"}`;
  const [preferences, setPreferences] = useState<PanelPreferences>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) as PanelPreferences : defaultPreferences;
  });
  const [guideOpen, setGuideOpen] = useState(() => localStorage.getItem("simplercp.conflictGuard.guide") !== "closed");
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(preferences)); }, [preferences, storageKey]);
  useEffect(() => { setIntents(state.intents ?? []); }, [state.intents]);
  useEffect(() => {
    if (!memberId) return;
    const document = new Y.Doc();
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const provider = new WebsocketProvider(`${protocol}://${window.location.host}/yjs/${encodeURIComponent(projectId)}`, "conflict-guard-intents", document, { disableBc: true, params: { memberId } });
    const map = document.getMap<AgentIntent>("intents");
    const update = () => setIntents([...map.values()]);
    map.observe(update);
    return () => { map.unobserve(update); provider.destroy(); document.destroy(); };
  }, [projectId, memberId]);
  const memberName = (id?: string) => members.find((member) => member.id === id)?.displayName ?? id ?? "成员";
  const actorName = (actor: GuardActorRef) => guardActorName(actor, members);
  const symbolKinds = new Map(state.activeSymbols.flatMap((group) => group.symbols.map((symbol) => [symbol.key, symbol.kind] as const)));
  const records = [...(state.pairDecisions ?? [])].sort((left, right) => (right.updatedAt ?? right.pair.updatedAt) - (left.updatedAt ?? left.pair.updatedAt));
  const ownCards = (state.ownerCards ?? []).filter((card) => !["observe", "off"].includes(state.mode) && state.arbitration?.mode !== "all-auto" && card.status === "waiting" && Boolean(memberId && card.owners.includes(memberId)) && !card.accepted.includes(memberId!));
  const locks = records.filter((record) => !["observe", "off"].includes(state.mode) && state.arbitration?.mode !== "all-auto" && humanConflict(record.pair) && ["judged", "stale"].includes(record.status) && record.verdict?.decision === "lock" && Boolean(memberId && [record.pair.left.actor.memberId, record.pair.right.actor.memberId].includes(memberId)));
  const actions = [...ownCards.map((card) => ({ card, record: undefined })), ...locks.map((record) => ({ record, card: undefined }))];
  const activeIntents = intents.filter((intent) => !["done", "reverted"].includes(intent.status));
  const activeRows = activeSymbolRows(state, preferences.filters.active, memberId);
  const candidates = [...state.candidatePairs].sort((left, right) => Number(Boolean(left.path?.typeOnly)) - Number(Boolean(right.path?.typeOnly)) || right.updatedAt - left.updatedAt);
  const visibleCandidates = candidates.filter((pair) => pairMatches(pair, preferences.filters.candidates, memberId));
  const checks = records.filter((record) => pairMatches(record.pair, preferences.filters.checks, memberId));
  const warnings = records.filter((record) => record.verdict?.decision === "warn" && !record.acknowledged && pairMatches(record.pair, { kinds: [], mine: true }, memberId));
  const humanCount = new Set(state.activeSymbols.filter((group) => group.actor.kind === "human" && group.symbols.length).map((group) => guardActorKey(group.actor))).size;
  const agentCount = new Set([...state.activeSymbols.filter((group) => group.actor.kind === "agent" && group.symbols.length).map((group) => guardActorKey(group.actor)), ...activeIntents.map((intent) => guardActorKey(intent.actor))]).size;
  const symbolCount = new Set(state.activeSymbols.flatMap((group) => group.symbols.map((symbol) => symbol.key))).size;
  const actionCount = conflictActionCount(state, memberId);
  const updateFilter = (key: ListKey, filter: GuardListFilter) => setPreferences((current) => ({ ...current, filters: { ...current.filters, [key]: filter }, limits: { ...current.limits, [key]: key === "checks" ? 20 : 10 } }));
  const setLimit = (key: keyof PanelPreferences["limits"], count: number) => setPreferences((current) => ({ ...current, limits: { ...current.limits, [key]: count } }));
  const countsForPairs = (pairs: ConflictGuardState["candidatePairs"], mine: boolean) => Object.fromEntries(Object.keys(pairKindLabels).map((kind) => [kind, pairs.filter((pair) => pairKind(pair) === kind && pairMatches(pair, { kinds: [], mine }, memberId)).length])) as Record<PairKind, number>;
  const performAction = (pairId: string, action: () => Promise<unknown>) => {
    setActionErrors((current) => ({ ...current, [pairId]: undefined }));
    void action().catch((error) => {
      setActionErrors((current) => ({ ...current, [pairId]: error instanceof Error ? error.message : String(error) }));
      onError(error);
    });
  };
  return <section className="collab-section conflict-guard-panel" data-testid="conflict-guard-panel">
    <details className="conflict-guide" open={guideOpen} data-testid="conflict-guide" onToggle={(event) => { const open = event.currentTarget.open; setGuideOpen(open); localStorage.setItem("simplercp.conflictGuard.guide", open ? "open" : "closed"); }}>
      <summary>面板功能</summary>
      <p>将协作者之间的冲突分为三种等级。</p>
      <ul className="conflict-guide-zones">
        <li><GuardBadge>白区</GuardBadge><span>修改不会影响别人，系统直接放行。</span></li>
        <li><GuardBadge tone="danger">黑区</GuardBadge><span>修改会破坏别人正在使用的函数或导出，系统拦住。</span></li>
        <li><GuardBadge tone="warning">灰区</GuardBadge><span>影响难以判断，交给大模型研判，决定放行、提醒或拦住。</span></li>
      </ul>
      <ul className="conflict-guide-actors">
        <li>人之间的冲突，由双方处理。</li>
        <li>Agent 给人让路，同一属主的 Agent 自动排队。</li>
        <li>跨属主的 Agent 冲突，需要属主决定。</li>
      </ul>
    </details>
    <GuardOverview state={state} />
    <section className="conflict-attention" data-testid="conflict-attention">
      <h3><ShieldAlert size={14} aria-hidden="true" />需要你处理<GuardBadge tone={actionCount ? "danger" : "neutral"}>{actionCount} 项</GuardBadge></h3>
      {actions.length === 0 ? <p className="empty-panel-state">{state.mode === "observe" ? "当前仅观察，无需处理。" : "当前没有需要你处理的冲突。"}</p> : null}
      <div data-testid="owner-cards">{actions.slice(0, preferences.limits.actions).flatMap(({ card }) => card ? [<article className="conflict-card" key={card.id} data-testid="owner-intent-card">
        <h4 className="conflict-card-title">跨属主意图差异</h4>
        <div className="conflict-tags"><GuardBadge tone="warning">等待双方处理</GuardBadge></div>
        {card.intents.map((intent) => <section className="conflict-owner-side" key={intent.actor.runId}><strong>{actorName(intent.actor)}</strong><ReadableText text={intent.task} /><GuardScope label="计划范围" scope={intent.plannedScope} /><GuardScope label="已修改" scope={intent.actualScope} empty="尚未修改" /></section>)}
        <PairParticipants sides={[{ actor: card.conflict.self, symbol: card.conflict.symbols.self }, { actor: card.conflict.other, symbol: card.conflict.symbols.other }]} actorName={actorName} />
        <RelationPath lines={card.path.split(" → ")} />
        <ReadableText text={readableGuardText(card.explanation)} />
        <ReadableText text={card.suggestionStatus === "analyzing" ? "正在生成折中建议" : card.suggestion ? `折中建议：${card.suggestion}` : "当前没有模型建议，请协商修改方式。"} />
        <ul className="conflict-card-actions" aria-label="意图差异处理方式"><li><button className="primary" disabled={!card.suggestion} onClick={() => performAction(card.id, () => actOnOwnerCard(projectId, card.id, "accept"))}><CheckCheck size={14} />采纳建议</button></li><li><button onClick={() => performAction(card.id, () => actOnOwnerCard(projectId, card.id, "yield"))}><Undo2 size={14} />让我的 Agent 让路</button></li><li><button className="auxiliary" onClick={() => performAction(card.id, () => actOnOwnerCard(projectId, card.id, "chat"))}><MessageSquareText size={14} />去聊天里商量</button></li></ul>
        <TechnicalDetail ruleId={card.conflict.ruleId} pairId={card.conflict.pairId} revision={card.conflict.revision} />
        {actionErrors[card.id] ? <p role="alert">{actionErrors[card.id]}</p> : null}
      </article>] : [])}</div>
      <div data-testid="conflict-current">{actions.slice(0, preferences.limits.actions).flatMap(({ record }) => {
        if (!record) return [];
        const ownConfirmed = record.pair.left.actor.memberId === memberId ? record.leftConfirmed : record.rightConfirmed;
        const otherConfirmed = record.pair.left.actor.memberId === memberId ? record.rightConfirmed : record.leftConfirmed;
        return [<article key={record.pair.id} className="conflict-card" data-testid="conflict-card">
          <h4 className="conflict-card-title">与 {memberName(record.pair.left.actor.memberId === memberId ? record.pair.right.actor.memberId : record.pair.left.actor.memberId)} 的修改冲突</h4>
          <div className="conflict-tags" data-testid="conflict-tags"><GuardBadge tone={zoneTone(record.verdict?.zone)}>{record.verdict ? zoneName(record.verdict.zone) : "黑区"}</GuardBadge><GuardBadge tone="danger">冻结</GuardBadge><GuardBadge>{ruleName(record.conflict?.ruleId ?? record.verdict?.ruleId)}</GuardBadge></div>
          <ReadableText text={readableGuardText(record.conflict?.summaryZh ?? record.verdict?.summary ?? "")} testId="conflict-summary" />
          <ModelDetail metadata={record.verdict?.adjudication} conflict={record.conflict} />
          <PairParticipants sides={[record.pair.left, record.pair.right]} actorName={actorName} symbolKinds={symbolKinds} />
          <RelationPath lines={relationPathLines(record.pair.path)} />
          <PairCode pair={record.pair} projectId={projectId} actorName={actorName} onError={onError} />
          <p className="conflict-confirmation">{ownConfirmed ? "你已确认，等待对方确认" : otherConfirmed ? "对方已确认，等待你的确认" : "双方尚未确认"}</p>
          <ul className="conflict-card-actions" aria-label="冲突处理方式" data-testid="conflict-action-list">
            <li><button className="primary" type="button" onClick={() => { if (window.confirm("将撤回你在该文件本轮的全部修改，是否继续？")) performAction(record.pair.id, () => revertConflictPair(projectId, record.pair.id)); }}><Undo2 size={14} aria-hidden="true" />我来改</button></li>
            <li><button type="button" disabled={ownConfirmed} onClick={() => performAction(record.pair.id, () => confirmConflictPair(projectId, record.pair.id))}>{ownConfirmed ? <Check size={14} aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />}<span>双方确认后继续{ownConfirmed ? "（已确认）" : ""}</span></button></li>
            <li><button className="auxiliary" type="button" onClick={() => onChat(`@${memberName(record.pair.left.actor.memberId)} @${memberName(record.pair.right.actor.memberId)} 冲突摘要：${readableGuardText(record.verdict?.summary ?? "")}`, record.pair.id)}><MessageSquareText size={14} aria-hidden="true" />去聊天里商量</button></li>
          </ul>
          <TechnicalDetail ruleId={record.verdict?.ruleId} pairId={record.pair.id} revision={record.revision} />
          {actionErrors[record.pair.id] ? <p role="alert" data-testid="conflict-action-error">{actionErrors[record.pair.id]}</p> : null}
        </article>];
      })}</div>
      <ListLimit total={actions.length} limit={preferences.limits.actions} initial={10} onChange={(count) => setLimit("actions", count)} />
      {warnings.length ? <section data-testid="conflict-warnings">
        <h3>待了解的提醒<GuardBadge tone="warning">{warnings.length} 项</GuardBadge></h3>
        {warnings.slice(0, preferences.limits.warnings ?? 10).map((record) => <article className="conflict-candidate" key={`${record.pair.id}:${record.revision}`}>
          <div className="conflict-tags"><GuardBadge tone="warning">提醒</GuardBadge><GuardBadge>{ruleName(record.verdict?.ruleId)}</GuardBadge></div>
          <ReadableText text={readableGuardText(record.conflict?.summaryZh ?? record.verdict?.summary ?? "")} />
          <button type="button" onClick={() => performAction(record.pair.id, () => acknowledgeConflictWarning(projectId, record.pair.id, record.revision, record.warningKey))}><Check size={14} aria-hidden="true" />我已了解</button>
          {actionErrors[record.pair.id] ? <p role="alert">{actionErrors[record.pair.id]}</p> : null}
        </article>)}
        <ListLimit total={warnings.length} limit={preferences.limits.warnings ?? 10} initial={10} onChange={(count) => setLimit("warnings", count)} />
      </section> : null}
    </section>
    <details className="conflict-layer" open={preferences.progressOpen} data-testid="conflict-progress" onToggle={(event) => { const open = event.currentTarget.open; setPreferences((current) => current.progressOpen === open ? current : { ...current, progressOpen: open }); }}>
      <summary><Users size={14} aria-hidden="true" /><span>正在进行的修改与关联关系<small data-testid="conflict-progress-summary">当前 {humanCount} 人 / {agentCount} 个 Agent 在修改 {symbolCount} 个符号，其中有 {candidates.length} 组关联</small></span></summary>
      <h3><Bot size={14} aria-hidden="true" />意图板<GuardBadge>{activeIntents.length} 项</GuardBadge></h3>
      <div data-testid="intent-board">{activeIntents.slice(0, preferences.limits.intents).map((intent) => <article key={intent.actor.runId} className="conflict-candidate" data-testid="agent-intent">
      <div className="conflict-item-header"><strong>{actorName(intent.actor)}</strong><GuardBadge tone={intent.status === "blocked" || intent.status === "waiting" ? "warning" : "info"}>{({ planning: "正在规划", running: "正在执行", waiting: "等待审批", blocked: "等待属主处理", done: "已经完成", reverted: "已经撤回" })[intent.status]}</GuardBadge></div>
      <ReadableText text={intent.task} />
      <GuardScope label="计划范围" scope={intent.plannedScope} />
      <GuardScope label="实际范围" scope={intent.actualScope} extraScope={intent.actualScope.filter((key) => !intent.plannedScope.includes(key))} empty="尚未修改" />
      <small className="conflict-caption">任务修订 {intent.taskRevision}</small>
      {state.ownerCards?.some((card) => card.status === "waiting" && card.accepted.includes(memberId ?? "") && card.intents.some((side) => side.actor.runId === intent.actor.runId)) ? <GuardBadge>你已采纳，等待对方</GuardBadge> : null}
    </article>)}</div>
      {activeIntents.length === 0 ? <p className="empty-panel-state">当前没有 Agent 任务。</p> : null}
      <ListLimit total={activeIntents.length} limit={preferences.limits.intents} initial={10} showAll onChange={(count) => setLimit("intents", count)} />
      <h3><Users size={14} aria-hidden="true" />正在修改<GuardBadge>{activeRows.length} 条</GuardBadge></h3>
      <FilterControls name="active" filter={preferences.filters.active} counts={Object.fromEntries(Object.keys(pairKindLabels).map((kind) => [kind, activeSymbolRows(state, { kinds: [kind as PairKind], mine: preferences.filters.active.mine }, memberId).length])) as Record<PairKind, number>} total={activeSymbolRows(state, { kinds: [], mine: preferences.filters.active.mine }, memberId).length} onChange={(filter) => updateFilter("active", filter)} />
      <ul className="conflict-symbol-list" data-testid="conflict-active-list">{activeRows.slice(0, preferences.limits.active).map(({ actor, symbol }) => <li key={`${guardActorKey(actor)}:${symbol.key}`}>
        <strong className="conflict-actor">{actorName(actor)}</strong>
        <button type="button" data-symbol={symbol.key} aria-label={`${symbol.file}:${symbol.startLine}–${symbol.endLine} ${displayName(symbol.key, symbol.kind)}`} data-testid={`conflict-symbol-${actor.memberId ?? actor.runId}-${symbol.key}`} onClick={() => { if (symbol.status === "deleted") onError(new Error("该符号已删除")); onOpenSymbol(symbol.file, symbol.status === "deleted" ? 1 : symbol.startLine); }}>
          <span className="conflict-symbol-heading"><code>{displayName(symbol.key, symbol.kind)}</code><GuardBadge tone={symbol.status === "deleted" ? "danger" : symbol.status === "added" ? "success" : "neutral"}>{statuses[symbol.status]}</GuardBadge></span>
          <span className="conflict-symbol-location">{symbol.file}:{symbol.startLine}–{symbol.endLine}</span>
        </button>
        <small>{elapsed(symbol.lastTouchedAt)}</small>
      </li>)}</ul>
      {activeRows.length === 0 ? <p className="empty-panel-state">当前筛选下没有符号修改。</p> : null}
      <ListLimit total={activeRows.length} limit={preferences.limits.active} initial={10} showAll onChange={(count) => setLimit("active", count)} />
      <h3><GitBranch size={14} aria-hidden="true" />相互关联的修改<GuardBadge>{visibleCandidates.length} 组</GuardBadge></h3>
      <FilterControls name="candidates" filter={preferences.filters.candidates} counts={countsForPairs(candidates, preferences.filters.candidates.mine)} total={candidates.filter((pair) => pairMatches(pair, { kinds: [], mine: preferences.filters.candidates.mine }, memberId)).length} onChange={(filter) => updateFilter("candidates", filter)} />
      <div data-testid="conflict-candidates">{visibleCandidates.slice(0, preferences.limits.candidates).map((pair) => {
      const record = records.find((record) => record.pair.id === pair.id || record.pair.id.endsWith(`:${pair.id}`));
      return <Candidate key={pair.id} pair={pair} projectId={projectId} actorName={actorName} symbolKinds={symbolKinds} onError={onError} decision={record?.verdict} recordStatus={record?.status} revision={record?.revision} />;
    })}</div>
      {visibleCandidates.length === 0 ? <p className="empty-panel-state">当前筛选下没有相互关联的修改。</p> : null}
      <ListLimit total={visibleCandidates.length} limit={preferences.limits.candidates} initial={10} showAll onChange={(count) => setLimit("candidates", count)} />
    </details>
    <details className="conflict-layer" open={preferences.historyOpen} data-testid="conflict-history" onToggle={(event) => { const open = event.currentTarget.open; setPreferences((current) => current.historyOpen === open ? current : { ...current, historyOpen: open }); }}>
      <summary><BarChart3 size={14} aria-hidden="true" /><span>检查记录与统计<small>共 {records.length} 条检查记录</small></span></summary>
      <h3>检查记录<GuardBadge>{checks.length} 条</GuardBadge></h3>
      <FilterControls name="checks" filter={preferences.filters.checks} counts={countsForPairs(records.map((record) => record.pair), preferences.filters.checks.mine)} total={records.filter((record) => pairMatches(record.pair, { kinds: [], mine: preferences.filters.checks.mine }, memberId)).length} onChange={(filter) => updateFilter("checks", filter)} />
      <div className="conflict-check-list" data-testid="conflict-check-list">{checks.slice(0, preferences.limits.checks).map((record) => <details key={record.pair.id} className={`conflict-check-row ${record.verdict?.zone ?? ""}`} data-testid={record.point ? "agent-conflict-record" : "human-conflict-record"}>
        <summary><time dateTime={new Date(record.updatedAt ?? record.pair.updatedAt).toISOString()}>{new Date(record.updatedAt ?? record.pair.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</time><span title={guardCheckLabels[record.point ?? "T1"]}>{guardCheckLabels[record.point ?? "T1"]}</span><GuardBadge tone={zoneTone(record.verdict?.zone)}>{agentOutcome(record)}</GuardBadge><code title={[record.pair.left.symbol, record.pair.right.symbol].join("，")}>{[...new Set([...(record.pair.left.symbols ?? [record.pair.left.symbol]), ...(record.pair.right.symbols ?? [record.pair.right.symbol])])].join("，")}</code></summary>
        <div className="conflict-check-content">
          {record.verdict ? <div className="conflict-tags"><GuardBadge tone={zoneTone(record.verdict.zone)}>{zoneName(record.verdict.zone)}</GuardBadge><GuardBadge>{ruleName(record.verdict.ruleId)}</GuardBadge></div> : null}
          <ReadableText text={readableGuardText(record.conflict?.summaryZh ?? record.verdict?.summary ?? "正在检查修改之间的影响。")} />
          <PairParticipants sides={[record.pair.left, record.pair.right]} actorName={actorName} symbolKinds={symbolKinds} />
          <RelationPath lines={relationPathLines(record.pair.path)} />
          <ModelDetail metadata={record.verdict?.adjudication} conflict={record.conflict} />
          {record.verdict?.decision === "warn" && pairMatches(record.pair, { kinds: [], mine: true }, memberId) ? <button type="button" disabled={record.acknowledged} onClick={() => performAction(record.pair.id, () => acknowledgeConflictWarning(projectId, record.pair.id, record.revision, record.warningKey))}>{record.acknowledged ? "已经了解" : "我已了解"}</button> : null}
          <TechnicalDetail ruleId={record.verdict?.ruleId} point={record.point} pairId={record.pair.id} revision={record.revision} />
        </div>
      </details>)}</div>
      {checks.length === 0 ? <p className="empty-panel-state">当前筛选下没有检查记录。</p> : null}
      <ListLimit total={checks.length} limit={preferences.limits.checks} initial={20} onChange={(count) => setLimit("checks", count)} />
      <button className="conflict-export" type="button" onClick={() => { void downloadConflictGuardTrace(projectId).catch(onError); }}><Download size={14} aria-hidden="true" />导出轨迹</button>
      <details className="conflict-stat-details" data-testid="conflict-detailed-statistics"><summary>查看详细统计</summary><GuardStatistics state={state} memberName={memberName} /></details>
      <details className="conflict-stat-details"><summary>文件写入状态（{state.blockedPersists?.length ?? 0} 个）</summary>{(state.blockedPersists ?? []).slice(0, preferences.limits.persists).map((entry) => <div key={entry.file} className="conflict-persist-row"><div className="conflict-item-header"><GuardBadge tone={entry.reason === "lock" ? "danger" : "warning"}>暂停写入</GuardBadge><span className="conflict-caption">{persistReason(entry.reason)}</span></div><code>{entry.file}</code></div>)}<ListLimit total={state.blockedPersists?.length ?? 0} limit={preferences.limits.persists} initial={10} onChange={(count) => setLimit("persists", count)} /></details>
    {state.indexing ? <p>语义索引正在建立。</p> : null}
    {state.degraded ? <p>冲突预防已降级：{state.degradedReason ?? "内部错误"}</p> : null}
    {state.traceWriteFailures ? <p>轨迹写入失败 {state.traceWriteFailures} 次。</p> : null}
    {state.index.truncated ? <p>文件数量超过 2000，当前只索引前 2000 个文件。</p> : null}
    </details>
  </section>;
}

function GuardOverview({ state }: { state: ConflictGuardState }) {
  const counts = guardDecisionCounts(state);
  return <dl className="conflict-overview" data-testid="conflict-overview">
    {(["white", "black", "grey"] as const).map((zone) => <div key={zone} data-tone={zoneTone(zone)} data-metric={zone}><dt>{zoneName(zone)}</dt><dd>{counts[zone]}</dd></div>)}
    <div data-metric="decisions"><dt>判定</dt><dd>{counts.decisions}</dd></div>
    <div data-metric="interruptions"><dt>打扰</dt><dd>{state.arbitration?.members.reduce((count, entry) => count + entry.interruptions, 0) ?? 0}</dd></div>
  </dl>;
}

function FilterControls({ name, filter, counts, total, onChange }: { name: ListKey; filter: GuardListFilter; counts: Record<PairKind, number>; total: number; onChange(filter: GuardListFilter): void }) {
  return <div className="conflict-filters" data-testid={`conflict-filter-${name}`}>
    <div className="conflict-filter-buttons" role="group" aria-label="按冲突双方类型筛选">
      <button type="button" aria-pressed={filter.kinds.length === 0} onClick={() => onChange({ ...filter, kinds: [] })}>全部 <span>{total}</span></button>
      {(Object.entries(pairKindLabels) as Array<[PairKind, string]>).map(([kind, label]) => <button key={kind} type="button" aria-pressed={filter.kinds.includes(kind)} onClick={() => onChange({ ...filter, kinds: filter.kinds.includes(kind) ? filter.kinds.filter((value) => value !== kind) : [...filter.kinds, kind] })}>{label} <span>{counts[kind]}</span></button>)}
    </div>
    <label><input type="checkbox" checked={filter.mine} onChange={(event) => onChange({ ...filter, mine: event.target.checked })} />只看与我相关</label>
  </div>;
}

function ListLimit({ total, limit, initial, showAll = false, onChange }: { total: number; limit: number; initial: number; showAll?: boolean; onChange(count: number): void }) {
  if (!total) return null;
  return <div className="conflict-list-limit"><span>显示 {Math.min(total, limit)} / {total} 条</span>{total > limit ? <button type="button" onClick={() => onChange(showAll ? total : limit + initial)}>{showAll ? `显示全部（共 ${total} 条）` : `显示更多（还有 ${total - limit} 条）`}</button> : null}{limit > initial ? <button type="button" onClick={() => onChange(initial)}>收起列表</button> : null}</div>;
}

function TechnicalDetail({ ruleId, pairId, revision, point }: { ruleId?: string; pairId: string; revision?: number; point?: "T2" | "T3" }) {
  return <details className="conflict-stat-details" data-testid="conflict-technical-detail"><summary>技术细节（调试信息）</summary><dl className="conflict-debug-fields"><div><dt>变更对标识</dt><dd><code>{pairId}</code></dd></div><div><dt>修订次数</dt><dd>{revision ?? "未提供"}</dd></div>{point ? <div><dt>检查标识</dt><dd><code>{point}</code></dd></div> : null}{ruleId ? <div><dt>规则标识</dt><dd><code>{ruleId}</code></dd></div> : null}</dl></details>;
}

function GuardStatistics({ state, memberName }: { state: ConflictGuardState; memberName(id?: string): string }) {
  const [memberLimit, setMemberLimit] = useState(10);
  const counts = guardDecisionCounts(state);
  return <div className="conflict-statistics-groups">
    <section className="conflict-stat-group" data-testid="conflict-statistics">
      <h4>冲突处理</h4>
      <GuardMetrics items={[
        { id: "pairs", label: "变更对", value: `${counts.decisions} 个` },
        ...(["white", "grey", "black"] as const).map((zone) => ({ id: zone, label: zoneName(zone), value: <span className="conflict-metric-zone" data-tone={zoneTone(zone)}>{counts[zone]} 个</span> })),
        { id: "local-decisions", label: "本地决定比例", value: `${((state.intervention?.localDecisionRatio ?? 0) * 100).toFixed(1)}%` },
        { id: "freeze-duration", label: "冻结总时长", value: `${Math.round(state.intervention?.frozenDurationMs ?? 0)} ms` },
        { id: "blocked-writes", label: "写入被阻止", value: `${state.intervention?.persistBlockedCount ?? state.persistBlockedCount ?? 0} 次` },
        { id: "card-actions", label: "卡片操作", value: `${state.intervention?.uiActionCount ?? state.uiActionCount ?? 0} 次` }
      ]} />
      <details className="conflict-stat-details"><summary>索引与运行统计</summary><GuardMetrics items={[
        { id: "indexed-files", label: "文件数量", value: `${state.index.files} 个` },
        { id: "indexed-symbols", label: "符号数量", value: `${state.index.symbols} 个` },
        { id: "indexed-edges", label: "关系数量", value: `${state.index.edges} 条` },
        { id: "index-duration", label: "最近更新时间", value: `${state.index.latestUpdate.durationMs.toFixed(1)} ms` },
        { id: "change-units", label: "变更单元", value: `${state.statistics.total} 个` },
        { id: "unrelated-units", label: "无关系的变更", value: `${state.statistics.unrelated} 个` },
        { id: "unrelated-ratio", label: "无关系比例", value: `${(state.statistics.unrelatedRatio * 100).toFixed(1)}%` },
        { id: "type-only", label: "仅类型关联", value: `${state.statistics.typeOnly ?? 0} 个` },
        { id: "persist-conflicts", label: "文件写入冲突", value: `${state.persistConflicts ?? 0} 次` }
      ]} /></details>
    </section>
    {state.adjudication ? <section className="conflict-stat-group"><h4>模型研判</h4><GuardMetrics testId="adjudication-statistics" items={[
      { id: "model-calls", label: "模型调用", value: `${state.adjudication.calls} 次` },
      { id: "cache-hits", label: "缓存命中", value: `${state.adjudication.cacheHits} 次` },
      { id: "escalation-ratio", label: "升级比例", value: `${(state.adjudication.escalationRatio * 100).toFixed(1)}%` },
      { id: "model-failures", label: "研判失败", value: `${state.adjudication.failures} 次` },
      { id: "latency-p50", label: "延迟中位数（p50）", value: `${Math.round(state.adjudication.p50Ms)} ms` },
      { id: "latency-p95", label: "延迟第 95 百分位（p95）", value: `${Math.round(state.adjudication.p95Ms)} ms` },
      { id: "estimated-cost", label: "费用估算", value: `$${state.adjudication.costUsd.toFixed(6)}` }
    ]} /></section> : null}
    {state.arbitration ? <section className="conflict-stat-group" data-testid="arbitration-statistics"><h4>属主处理</h4>
      {state.arbitration.members.slice(0, memberLimit).map((entry) => <section className="conflict-member-stat" key={entry.memberId}><strong>{memberName(entry.memberId)}</strong><GuardMetrics items={[
        { id: "interruptions-hour", label: "每小时打扰", value: `${entry.perHour} 次` },
        { id: "interruptions-total", label: "累计", value: `${entry.interruptions} 次` },
        { id: "light-notices", label: "轻提示", value: `${entry.light} 次` }
      ]} />{Object.keys(entry.byKind).length ? <details className="conflict-stat-details"><summary>按冲突类型查看</summary><GuardMetrics items={Object.entries(entry.byKind).map(([kind, count]) => ({ id: kind, label: actorKindName(kind), value: `${count} 次` }))} /></details> : null}</section>)}
      <ListLimit total={state.arbitration.members.length} limit={memberLimit} initial={10} onChange={setMemberLimit} />
      <GuardMetrics items={[
        { id: "suspended-duration", label: "等待属主处理", value: `${Math.round(state.arbitration.suspendedMs / 1000)} 秒` },
        { id: "automatic-retries", label: "同属主自动处理", value: `${state.arbitration.automaticRetries ?? 0} 次` },
        ...Object.entries(state.arbitration.outcomes).map(([outcome, count]) => ({ id: outcome, label: outcomeName(outcome), value: `${count} 次` }))
      ]} />
    </section> : null}
  </div>;
}

function PairParticipants({ sides, actorName, symbolKinds, editing = false }: { sides: Array<{ actor: GuardActorRef; symbol: string }>; actorName(actor: GuardActorRef): string; symbolKinds?: Map<string, ActiveSymbol["kind"]>; editing?: boolean }) {
  return <span className="conflict-participants" data-testid="conflict-participants">{sides.map((side) => <span className="conflict-participant" key={`${guardActorKey(side.actor)}-${side.symbol}`}><span className="conflict-actor">{actorName(side.actor)}{editing ? <span className="conflict-caption">正在修改</span> : null}</span><code>{displayName(side.symbol, symbolKinds?.get(side.symbol))}</code></span>)}</span>;
}

function RelationPath({ lines }: { lines: string[] }) {
  return <div className="conflict-relation" data-testid="conflict-relation"><span className="conflict-field-label">关联路径</span><ul className="conflict-relation-lines">{lines.map((line, index) => <li key={index}><ArrowRight size={12} aria-hidden="true" /><span>{line}</span></li>)}</ul></div>;
}

function zoneTone(zone?: "white" | "black" | "grey") { return zone === "black" ? "danger" : zone === "grey" ? "warning" : "neutral"; }
function agentOutcome(record: NonNullable<ConflictGuardState["pairDecisions"]>[number]) {
  if (record.status === "analyzing") return "分析中";
  if (record.shadow) return record.verdict?.decision === "lock" ? "若启用将被拒绝" : "观察记录";
  return record.verdict ? decisionName(record.verdict.decision) : "等待检查";
}

function Candidate({ pair, projectId, actorName, symbolKinds, onError, decision, recordStatus, revision }: {
  pair: ConflictGuardState["candidatePairs"][number]; projectId: string; actorName(actor: GuardActorRef): string; symbolKinds: Map<string, ActiveSymbol["kind"]>; onError(error: unknown): void; decision?: NonNullable<ConflictGuardState["pairDecisions"]>[number]["verdict"]; recordStatus?: string; revision?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [texts, setTexts] = useState<ConflictGuardSymbol[]>();
  const [detailError, setDetailError] = useState<string>();
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setDetailError(undefined);
    void Promise.all([getConflictGuardSymbol(projectId, pair.left.symbol), getConflictGuardSymbol(projectId, pair.right.symbol)]).then((next) => { if (active) setTexts(next); }).catch((error) => { if (active) setDetailError(error instanceof Error ? error.message : String(error)); onError(error); });
    return () => { active = false; };
  }, [expanded, projectId, pair.id, pair.updatedAt]);
  const leftKind = texts?.[0]?.symbol?.kind ?? symbolKinds.get(pair.left.symbol);
  const rightKind = texts?.[1]?.symbol?.kind ?? symbolKinds.get(pair.right.symbol);
  const lines = pair.distance === 0 ? [zeroDistanceText(leftKind, rightKind, pair.left.symbol, pair.right.symbol)] : relationPathLines(pair.path);
  return <article className={`conflict-candidate ${decision?.zone ?? ""}`} data-testid="conflict-candidate">
    <button className="conflict-candidate-toggle" type="button" aria-label={`查看 ${actorName(pair.left.actor)} 与 ${actorName(pair.right.actor)} 的关联修改`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <PairParticipants sides={[pair.left, pair.right]} actorName={actorName} symbolKinds={new Map([[pair.left.symbol, leftKind], [pair.right.symbol, rightKind]])} editing />
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    <div className="conflict-candidate-labels" data-testid="conflict-candidate-labels">{decision ? <div className="conflict-tags"><GuardBadge tone={zoneTone(decision.zone)}>{zoneName(decision.zone)}</GuardBadge><GuardBadge tone={zoneTone(decision.zone)}>{recordStatus === "resolved" ? "已解除" : recordStatus === "stale" ? "等待重新判定" : decision.decision === "lock" && !humanConflict(pair) ? "Agent 修改被拒绝" : decisionName(decision.decision)}</GuardBadge><GuardBadge>{ruleName(decision.ruleId)}</GuardBadge></div> : null}{pair.path?.typeOnly ? <GuardBadge>仅类型关联</GuardBadge> : null}</div>
    <RelationPath lines={lines} />
    {recordStatus === "analyzing" ? <p data-testid="adjudication-analyzing">分析中，相关文件等待研判结果。</p> : <ModelDetail metadata={decision?.adjudication} />}
    {detailError ? <p role="alert">读取符号详情失败：{detailError}</p> : null}
    <TechnicalDetail ruleId={decision?.ruleId} pairId={pair.id} revision={revision} />
    {expanded ? <div className="conflict-pair-texts">{[pair.left, pair.right].map((side, index) => {
      const change = texts?.[index]?.changes.find((change) => guardActorKey(change.actor) === guardActorKey(side.actor));
      return <div key={`${guardActorKey(side.actor)}-${side.symbol}`}>
        <header className="conflict-side-heading"><strong>{actorName(side.actor)}</strong><code>{displayName(side.symbol, texts?.[index]?.symbol?.kind)}</code></header>
        <h4>修改前</h4><pre>{detailError ? "读取失败" : change?.before ?? "正在读取"}</pre>
        <h4>修改后</h4><pre>{detailError ? "读取失败" : change?.after ?? "正在读取"}</pre>
      </div>;
    })}</div> : null}
  </article>;
}

function symbolName(key: string) { return key.slice(key.indexOf("#") + 1); }
function displayName(key: string, kind?: string) { return `${symbolName(key)}${kind === "function" || kind === "method" ? "()" : ""}`; }
function zeroDistanceText(leftKind: string | undefined, rightKind: string | undefined, left: string, right: string) {
  if (left === right) return leftKind === "function" || rightKind === "function" || leftKind === "method" || rightKind === "method" ? "两人在改同一个函数" : leftKind === "class" || rightKind === "class" ? "两人在改同一个类" : "两人在改同一个声明";
  return symbolName(left).includes(".") || symbolName(right).includes(".") ? "两人在改同一个类的不同部分" : "两人在改同一个声明";
}
function elapsed(at: number) { const seconds = Math.max(0, Math.floor((Date.now() - at) / 1_000)); return seconds < 60 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分钟前`; }
function ModelDetail({ metadata, conflict }: { metadata?: NonNullable<NonNullable<ConflictGuardState["pairDecisions"]>[number]["verdict"]>["adjudication"]; conflict?: GuardConflict }) {
  if (!metadata) return null;
  const degraded = metadata.point === "T2" ? "Agent 研判未完成，本次修改被拒绝" : metadata.point === "T3" ? "Agent 结束研判未完成，请检查撤回结果" : "研判失败，已改为提醒";
  return <div className="conflict-model-detail" data-testid="adjudication-result">
    <div className="conflict-tags"><GuardBadge tone={metadata.status === "degraded" ? "warning" : "info"}>{metadata.status === "degraded" ? degraded : "已判定"}</GuardBadge>{metadata.status !== "degraded" ? <GuardBadge>由{metadata.source === "fast" ? "快判" : "深判"}模型判定</GuardBadge> : null}</div>
    <GuardMetrics items={[
      { id: "confidence", label: "置信度", value: metadata.confidence === undefined ? "未提供" : `${(metadata.confidence * 100).toFixed(1)}%` },
      { id: "latency", label: "研判耗时", value: `${Math.round(metadata.latencyMs)} ms` }
    ]} />
    <ReadableText text={readableGuardText(conflict?.explanationZh ?? metadata.userExplanation)} testId="model-explanation" />
    <ReadableText text={readableGuardText(`建议：${conflict?.suggestionZh ?? metadata.suggestedAction}`)} testId="model-suggestion" />
  </div>;
}

function PairCode({ pair, projectId, actorName, onError }: { pair: ConflictGuardState["candidatePairs"][number]; projectId: string; actorName(actor: GuardActorRef): string; onError(error: unknown): void }) {
  const [expanded, setExpanded] = useState(false);
  const [texts, setTexts] = useState<ConflictGuardSymbol[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setTexts(undefined);
    setError(undefined);
    void Promise.all([getConflictGuardSymbol(projectId, pair.left.symbol), getConflictGuardSymbol(projectId, pair.right.symbol)]).then((next) => { if (active) setTexts(next); }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); onError(failure); });
    return () => { active = false; };
  }, [expanded, pair.id, pair.updatedAt, projectId]);
  return <details className="conflict-code-detail" onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>查看双方修改前后代码</summary>{expanded ? <div className="conflict-pair-texts">{[pair.left, pair.right].map((side, index) => {
    const change = texts?.[index]?.changes.find((entry) => guardActorKey(entry.actor) === guardActorKey(side.actor));
    return <section key={guardActorKey(side.actor)}><header className="conflict-side-heading"><strong>{actorName(side.actor)}</strong><code>{displayName(side.symbol)}</code></header><h4>修改前</h4><pre>{error ?? change?.before ?? (texts ? "当前没有符号修改" : "正在读取")}</pre><h4>修改后</h4><pre>{error ?? change?.after ?? (texts ? "当前没有符号修改" : "正在读取")}</pre></section>;
  })}</div> : null}</details>;
}
function persistReason(reason: string) { return ({ lock: "冻结", analyzing: "分析中", "pending-judgement": "等待判定", "agent-write": "等待 Agent 写入" } as Record<string, string>)[reason] ?? "等待检查"; }
function actorKindName(kind: string) { return ({ "human-human": "人与人", "human-agent": "人与 Agent", "agent-agent": "Agent 与 Agent", "agent-agent-same-owner": "同属主 Agent", "agent-agent-cross-owner": "跨属主 Agent", "agent-system": "Agent 运行检查" } as Record<string, string>)[kind] ?? "协作冲突"; }
function outcomeName(outcome: string) { return ({ accepted: "双方采纳", yielded: "主动让路", timeout: "等待超时", closed: "已经关闭", timedout: "等待超时", expired: "等待超时", cancelled: "已经取消", stale: "重新判定", failed: "处理失败" } as Record<string, string>)[outcome] ?? "其他处理"; }
