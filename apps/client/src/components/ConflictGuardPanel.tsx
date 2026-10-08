import { ArrowRight, BarChart3, Bot, Check, CheckCheck, ChevronDown, GitBranch, MessageSquareText, ShieldAlert, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { actOnOwnerCard, confirmConflictPair, getConflictGuardSymbol, revertConflictPair } from "../api";
import type { ActiveSymbol, AgentIntent, ConflictGuardState, ConflictGuardSymbol, GuardActorRef, GuardConflict } from "../conflictGuardTypes";
import type { RoomMember } from "../types";
import { relationPathLines, guardActorName, guardActorKey, humanConflict } from "../conflictGuardPresentation";
import { GuardBadge, GuardMetrics, GuardScope, ReadableText } from "./ConflictGuardText";

const statuses = { modified: "修改", added: "新增", deleted: "删除" };

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
  const performAction = (pairId: string, action: () => Promise<unknown>) => {
    setActionErrors((current) => ({ ...current, [pairId]: undefined }));
    void action().catch((error) => {
      setActionErrors((current) => ({ ...current, [pairId]: error instanceof Error ? error.message : String(error) }));
      onError(error);
    });
  };
  return <section className="collab-section conflict-guard-panel" data-testid="conflict-guard-panel">
    <h3><Bot size={14} aria-hidden="true" />意图板</h3>
    <div data-testid="intent-board">{intents.filter((intent) => !["done", "reverted"].includes(intent.status)).map((intent) => <article key={intent.actor.runId} className="conflict-candidate" data-testid="agent-intent">
      <div className="conflict-item-header"><strong>{actorName(intent.actor)}</strong><GuardBadge tone={intent.status === "blocked" || intent.status === "waiting" ? "warning" : "info"}>{({ planning: "正在规划", running: "正在执行", waiting: "等待审批", blocked: "等待属主处理", done: "已经完成", reverted: "已经撤回" })[intent.status]}</GuardBadge></div>
      <ReadableText text={intent.task} />
      <GuardScope label="计划范围" scope={intent.plannedScope} />
      <GuardScope label="实际范围" scope={intent.actualScope} extraScope={intent.actualScope.filter((key) => !intent.plannedScope.includes(key))} empty="尚未修改" />
      <small className="conflict-caption">任务修订 {intent.taskRevision}</small>
    </article>)}</div>
    {intents.every((intent) => ["done", "reverted"].includes(intent.status)) ? <p className="empty-panel-state">当前没有 Agent 任务。</p> : null}
    <div data-testid="owner-cards">{state.ownerCards?.filter((card) => card.status === "waiting").map((card) => <article className="conflict-card" key={card.id} data-testid="owner-intent-card">
      <h4 className="conflict-card-title">跨属主意图差异</h4>
      <div className="conflict-tags"><GuardBadge tone="warning">等待双方处理</GuardBadge></div>
      {card.intents.map((intent) => <section className="conflict-owner-side" key={intent.actor.runId}><strong>{actorName(intent.actor)}</strong><ReadableText text={intent.task} /><GuardScope label="计划范围" scope={intent.plannedScope} /><GuardScope label="已修改" scope={intent.actualScope} empty="尚未修改" /></section>)}
      <PairParticipants sides={[{ actor: card.conflict.self, symbol: card.conflict.symbols.self }, { actor: card.conflict.other, symbol: card.conflict.symbols.other }]} actorName={actorName} />
      <RelationPath lines={card.path.split(" → ")} />
      <ReadableText text={card.explanation} />
      <ReadableText text={card.suggestionStatus === "analyzing" ? "正在生成折中建议" : card.suggestion ? `折中建议：${card.suggestion}` : "当前没有模型建议，请协商修改方式。"} />
      {memberId && card.owners.includes(memberId) ? <ul className="conflict-card-actions" aria-label="意图差异处理方式"><li><button className="primary" disabled={!card.suggestion || card.accepted.includes(memberId)} onClick={() => performAction(card.id, () => actOnOwnerCard(projectId, card.id, "accept"))}><CheckCheck size={14} />{card.accepted.includes(memberId) ? "已采纳，等待对方" : "采纳建议"}</button></li><li><button onClick={() => performAction(card.id, () => actOnOwnerCard(projectId, card.id, "yield"))}><Undo2 size={14} />让我的 Agent 让路</button></li><li><button className="auxiliary" onClick={() => performAction(card.id, () => actOnOwnerCard(projectId, card.id, "chat"))}><MessageSquareText size={14} />去聊天里商量</button></li></ul> : null}
      {actionErrors[card.id] ? <p role="alert">{actionErrors[card.id]}</p> : null}
    </article>)}</div>
    <h3><Users size={14} aria-hidden="true" />正在修改</h3>
    {state.activeSymbols.filter((group) => group.symbols.length > 0).map((group) => <div key={guardActorKey(group.actor)}>
      <strong>{actorName(group.actor)}</strong>
      <ul className="conflict-symbol-list">{group.symbols.map((symbol) => <li key={symbol.key}>
        <button type="button" data-symbol={symbol.key} aria-label={`${symbol.file}:${symbol.startLine}–${symbol.endLine} ${displayName(symbol.key, symbol.kind)}`} data-testid={`conflict-symbol-${group.actor.memberId ?? group.actor.runId}-${symbol.key}`} onClick={() => { if (symbol.status === "deleted") onError(new Error("该符号已删除")); onOpenSymbol(symbol.file, symbol.status === "deleted" ? 1 : symbol.startLine); }}>
          <span className="conflict-symbol-heading"><code>{displayName(symbol.key, symbol.kind)}</code><GuardBadge tone={symbol.status === "deleted" ? "danger" : symbol.status === "added" ? "success" : "neutral"}>{statuses[symbol.status]}</GuardBadge></span>
          <span className="conflict-symbol-location">{symbol.file}:{symbol.startLine}–{symbol.endLine}</span>
        </button>
        <small>{elapsed(symbol.lastTouchedAt)}</small>
      </li>)}</ul>
    </div>)}
    {state.activeSymbols.every((group) => group.symbols.length === 0) ? <p className="empty-panel-state">当前没有符号修改。</p> : null}
    <h3><ShieldAlert size={14} aria-hidden="true" />当前冲突</h3>
    <div data-testid="conflict-current">
      {(state.pairDecisions ?? []).filter((record) => state.arbitration?.mode !== "all-auto" && humanConflict(record.pair) && record.status === "judged" && record.verdict?.decision === "lock").map((record) => {
        const participant = Boolean(memberId && (record.pair.left.actor.memberId === memberId || record.pair.right.actor.memberId === memberId));
        const ownConfirmed = record.pair.left.actor.memberId === memberId ? record.leftConfirmed : record.rightConfirmed;
        const otherConfirmed = record.pair.left.actor.memberId === memberId ? record.rightConfirmed : record.leftConfirmed;
        return <article key={record.pair.id} className="conflict-card" data-testid="conflict-card">
          <h4 className="conflict-card-title">{participant ? `与 ${memberName(record.pair.left.actor.memberId === memberId ? record.pair.right.actor.memberId : record.pair.left.actor.memberId)} 的修改冲突` : `${memberName(record.pair.left.actor.memberId)} 与 ${memberName(record.pair.right.actor.memberId)} 的修改冲突`}</h4>
          <div className="conflict-tags" data-testid="conflict-tags"><GuardBadge tone="danger">{record.verdict ? zoneName(record.verdict.zone) : "黑区"}</GuardBadge><GuardBadge tone={state.mode === "observe" ? "neutral" : "danger"}>{state.mode === "observe" ? "观察" : "冻结"}</GuardBadge><GuardBadge>{ruleName(record.conflict?.ruleId ?? record.verdict?.ruleId)}</GuardBadge></div>
          <ReadableText text={record.conflict?.summaryZh ?? record.verdict?.summary ?? ""} testId="conflict-summary" />
          <ModelDetail metadata={record.verdict?.adjudication} conflict={record.conflict} />
          <PairParticipants sides={[record.pair.left, record.pair.right]} actorName={actorName} symbolKinds={symbolKinds} />
          <RelationPath lines={relationPathLines(record.pair.path)} />
          <PairCode pair={record.pair} projectId={projectId} actorName={actorName} onError={onError} />
          {participant && (state.mode === "rules" || state.mode === "full") ? <>
            <p className="conflict-confirmation">{ownConfirmed ? "你已确认，等待对方确认" : otherConfirmed ? "对方已确认，等待你的确认" : "双方尚未确认"}</p>
            <ul className="conflict-card-actions" aria-label="冲突处理方式" data-testid="conflict-action-list">
              <li><button className="primary" type="button" onClick={() => { if (window.confirm("将撤回你在该文件本轮的全部修改，是否继续？")) performAction(record.pair.id, () => revertConflictPair(projectId, record.pair.id)); }}><Undo2 size={14} aria-hidden="true" />我来改</button></li>
              <li><button type="button" disabled={ownConfirmed} onClick={() => performAction(record.pair.id, () => confirmConflictPair(projectId, record.pair.id))}>{ownConfirmed ? <Check size={14} aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />}<span>双方确认后继续{ownConfirmed ? "（已确认）" : ""}</span></button></li>
              <li><button className="auxiliary" type="button" onClick={() => onChat(`@${memberName(record.pair.left.actor.memberId)} @${memberName(record.pair.right.actor.memberId)} 冲突摘要：${record.verdict?.summary ?? ""}`, record.pair.id)}><MessageSquareText size={14} aria-hidden="true" />去聊天里商量</button></li>
            </ul>
          </> : null}
          {actionErrors[record.pair.id] ? <p role="alert" data-testid="conflict-action-error">{actionErrors[record.pair.id]}</p> : null}
        </article>;
      })}
      {(state.blockedPersists ?? []).map((entry) => <div key={entry.file} className="conflict-persist-row"><div className="conflict-item-header"><GuardBadge tone={entry.reason === "lock" ? "danger" : "warning"}>暂停写入</GuardBadge><span className="conflict-caption">{persistReason(entry.reason)}</span></div><code>{entry.file}</code></div>)}
      {(state.pairDecisions ?? []).every((record) => !humanConflict(record.pair) || record.status !== "judged" || record.verdict?.decision !== "lock") && !(state.blockedPersists?.length) ? <p className="empty-panel-state">当前没有冻结。</p> : null}
    </div>
    <h3><GitBranch size={14} aria-hidden="true" />相互关联的修改</h3>
    <div data-testid="conflict-candidates">{[...state.candidatePairs].sort((left, right) => Number(Boolean(left.path?.typeOnly)) - Number(Boolean(right.path?.typeOnly)) || right.updatedAt - left.updatedAt).map((pair) => {
      const record = [...(state.pairDecisions ?? [])].reverse().find((record) => record.pair.id === pair.id || record.pair.id.endsWith(`:${pair.id}`));
      return <Candidate key={pair.id} pair={pair} projectId={projectId} actorName={actorName} symbolKinds={symbolKinds} onError={onError} decision={record?.verdict} recordStatus={record?.status} />;
    })}</div>
    {state.candidatePairs.length === 0 ? <p className="empty-panel-state">当前没有相互关联的修改。</p> : null}
    <h3><Bot size={14} aria-hidden="true" />Agent 检查</h3>
    {(state.pairDecisions ?? []).filter((record) => record.point).map((record) => <article key={record.pair.id} className={`conflict-candidate ${record.verdict?.zone ?? ""}`} data-testid="agent-conflict-record">
      <div className="conflict-item-header"><strong>{record.point === "T2" ? "写入前检查（T2）" : "结束后复检（T3）"}</strong><GuardBadge tone={record.status === "analyzing" ? "warning" : zoneTone(record.verdict?.zone)}>{agentOutcome(record)}</GuardBadge></div>
      {record.verdict ? <div className="conflict-tags"><GuardBadge tone={zoneTone(record.verdict.zone)}>{zoneName(record.verdict.zone)}</GuardBadge><GuardBadge>{ruleName(record.verdict.ruleId)}</GuardBadge></div> : null}
      <ReadableText text={record.conflict?.summaryZh ?? record.verdict?.summary ?? "正在检查修改之间的影响。"} />
      <PairParticipants sides={[record.pair.left, record.pair.right]} actorName={actorName} symbolKinds={symbolKinds} />
      <RelationPath lines={relationPathLines(record.pair.path)} />
      <ModelDetail metadata={record.verdict?.adjudication} conflict={record.conflict} />
    </article>)}
    {(state.pairDecisions ?? []).every((record) => !record.point) ? <p className="empty-panel-state">当前没有 Agent 检查记录。</p> : null}
    <h3><BarChart3 size={14} aria-hidden="true" />统计</h3>
    <GuardStatistics state={state} memberName={memberName} />
    {state.indexing ? <p>语义索引正在建立。</p> : null}
    {state.degraded ? <p>冲突预防已降级：{state.degradedReason ?? "内部错误"}</p> : null}
    {state.traceWriteFailures ? <p>轨迹写入失败 {state.traceWriteFailures} 次。</p> : null}
    {state.index.truncated ? <p>文件数量超过 2000，当前只索引前 2000 个文件。</p> : null}
  </section>;
}

function GuardStatistics({ state, memberName }: { state: ConflictGuardState; memberName(id?: string): string }) {
  const decisions = state.pairDecisions ?? [];
  return <div className="conflict-statistics-groups">
    <section className="conflict-stat-group" data-testid="conflict-statistics">
      <h4>冲突处理</h4>
      <GuardMetrics items={[
        { id: "pairs", label: "变更对", value: `${state.intervention?.decisions ?? decisions.length} 个` },
        ...(["white", "grey", "black"] as const).map((zone) => ({ id: zone, label: zoneName(zone), value: <span className="conflict-metric-zone" data-tone={zoneTone(zone)}>{state.intervention?.[zone] ?? decisions.filter((record) => record.verdict?.zone === zone).length} 个</span> })),
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
      {state.arbitration.members.map((entry) => <section className="conflict-member-stat" key={entry.memberId}><strong>{memberName(entry.memberId)}</strong><GuardMetrics items={[
        { id: "interruptions-hour", label: "每小时打扰", value: `${entry.perHour} 次` },
        { id: "interruptions-total", label: "累计", value: `${entry.interruptions} 次` },
        { id: "light-notices", label: "轻提示", value: `${entry.light} 次` }
      ]} />{Object.keys(entry.byKind).length ? <details className="conflict-stat-details"><summary>按冲突类型查看</summary><GuardMetrics items={Object.entries(entry.byKind).map(([kind, count]) => ({ id: kind, label: actorKindName(kind), value: `${count} 次` }))} /></details> : null}</section>)}
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

function zoneTone(zone?: "white" | "black" | "grey") { return zone === "black" ? "danger" : zone === "grey" ? "warning" : zone === "white" ? "success" : "neutral"; }
function agentOutcome(record: NonNullable<ConflictGuardState["pairDecisions"]>[number]) {
  if (record.status === "analyzing") return "分析中";
  if (record.shadow) return record.verdict?.decision === "lock" ? "若启用将被拒绝" : "观察记录";
  if (record.verdict?.decision === "lock") return record.point === "T2" ? "修改被拒绝" : "结束检查发现冲突";
  return record.verdict?.decision === "warn" ? "修改警告" : "放行";
}

function Candidate({ pair, projectId, actorName, symbolKinds, onError, decision, recordStatus }: {
  pair: ConflictGuardState["candidatePairs"][number]; projectId: string; actorName(actor: GuardActorRef): string; symbolKinds: Map<string, ActiveSymbol["kind"]>; onError(error: unknown): void; decision?: NonNullable<ConflictGuardState["pairDecisions"]>[number]["verdict"]; recordStatus?: string;
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
  const degraded = metadata.point === "T2" ? "Agent 研判未完成，本次修改被拒绝" : metadata.point === "T3" ? "Agent 结束研判未完成，请检查撤回结果" : "研判失败，已降级为警告";
  return <div className="conflict-model-detail" data-testid="adjudication-result">
    <div className="conflict-tags"><GuardBadge tone={metadata.status === "degraded" ? "warning" : "info"}>{metadata.status === "degraded" ? degraded : "已判定"}</GuardBadge>{metadata.status !== "degraded" ? <GuardBadge>由{metadata.source === "fast" ? "快判" : "深判"}模型判定</GuardBadge> : null}</div>
    <GuardMetrics items={[
      { id: "confidence", label: "置信度", value: metadata.confidence === undefined ? "未提供" : `${(metadata.confidence * 100).toFixed(1)}%` },
      { id: "latency", label: "研判耗时", value: `${Math.round(metadata.latencyMs)} ms` }
    ]} />
    <ReadableText text={conflict?.explanationZh ?? metadata.userExplanation} testId="model-explanation" />
    <ReadableText text={`建议：${conflict?.suggestionZh ?? metadata.suggestedAction}`} testId="model-suggestion" />
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
function zoneName(zone: "white" | "black" | "grey") { return zone === "white" ? "白区" : zone === "black" ? "黑区" : "灰区"; }
function decisionName(decision: "allow" | "warn" | "lock") { return decision === "allow" ? "放行" : decision === "lock" ? "冻结" : "警告"; }
function persistReason(reason: string) { return ({ lock: "冻结", analyzing: "分析中", "pending-judgement": "等待判定", "agent-write": "等待 Agent 写入" } as Record<string, string>)[reason] ?? "等待检查"; }
function actorKindName(kind: string) { return ({ "human-human": "人与人", "human-agent": "人与 Agent", "agent-agent": "Agent 与 Agent", "agent-agent-same-owner": "同属主 Agent", "agent-agent-cross-owner": "跨属主 Agent", "agent-system": "Agent 运行检查" } as Record<string, string>)[kind] ?? "协作冲突"; }
function outcomeName(outcome: string) { return ({ accepted: "双方采纳", yielded: "主动让路", timeout: "等待超时", closed: "已经关闭", timedout: "等待超时", expired: "等待超时", cancelled: "已经取消", stale: "重新判定", failed: "处理失败" } as Record<string, string>)[outcome] ?? "其他处理"; }
function ruleName(ruleId?: string) { return ({ "same-symbol-concurrent-write": "同一声明并发修改", "comment-only-edit": "双方仅修改注释", "comment-format-only": "注释或空白修改", "declaration-body-unrelated": "同一声明的不同部分", "observability-only": "只改日志", "equivalent-refactor": "等价重构", "referenced-symbol-removed": "引用的符号已删除", "runtime-export-removed": "运行时导出已删除", "call-signature-incompatible": "调用签名不兼容", "consumed-return-property-removed": "返回属性已删除", "interface-required-member-incompatible": "接口必需成员不兼容", "merge-only-type-error": "合并后才出现类型错误", "type-only-unchanged": "仅类型关联", "unparsable-side": "修改暂时无法解析", "semantic-interaction-uncertain": "语义交互不确定", "model-unavailable": "模型研判未完成", "policy-error": "判定未完成", "agent-analysis-unavailable": "Agent 研判未完成" } as Record<string, string>)[ruleId ?? ""] ?? "规则判定"; }
