import { useEffect, useState } from "react";
import { confirmConflictPair, getConflictGuardSymbol, revertConflictPair } from "../api";
import type { ActiveSymbol, ConflictGuardState, ConflictGuardSymbol } from "../conflictGuardTypes";
import type { RoomMember } from "../types";
import { relationPathText } from "../conflictGuardPresentation";

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
  const memberName = (id?: string) => members.find((member) => member.id === id)?.displayName ?? id ?? "成员";
  const symbolKinds = new Map(state.activeSymbols.flatMap((group) => group.symbols.map((symbol) => [symbol.key, symbol.kind] as const)));
  const performAction = (pairId: string, action: () => Promise<unknown>) => {
    setActionErrors((current) => ({ ...current, [pairId]: undefined }));
    void action().catch((error) => {
      setActionErrors((current) => ({ ...current, [pairId]: error instanceof Error ? error.message : String(error) }));
      onError(error);
    });
  };
  return <section className="collab-section conflict-guard-panel" data-testid="conflict-guard-panel">
    <h3>正在修改</h3>
    {state.activeSymbols.filter((group) => group.symbols.length > 0).map((group) => <div key={group.actor.memberId}>
      <strong>{memberName(group.actor.memberId)}</strong>
      <ul className="conflict-symbol-list">{group.symbols.map((symbol) => <li key={symbol.key}>
        <button type="button" data-testid={`conflict-symbol-${group.actor.memberId}-${symbol.key}`} onClick={() => { if (symbol.status === "deleted") onError(new Error("该符号已删除")); onOpenSymbol(symbol.file, symbol.status === "deleted" ? 1 : symbol.startLine); }}>
          {symbol.file}:{symbol.startLine}–{symbol.endLine} {displayName(symbol.key, symbol.kind)}
        </button>
        <small>{statuses[symbol.status]} · {elapsed(symbol.lastTouchedAt)}</small>
      </li>)}</ul>
    </div>)}
    {state.activeSymbols.every((group) => group.symbols.length === 0) ? <p>当前没有符号修改。</p> : null}
    <h3>当前冲突</h3>
    <div data-testid="conflict-current">
      {(state.pairDecisions ?? []).filter((record) => record.status === "judged" && record.verdict?.decision === "lock").map((record) => {
        const participant = Boolean(memberId && (record.pair.left.actor.memberId === memberId || record.pair.right.actor.memberId === memberId));
        const ownConfirmed = record.pair.left.actor.memberId === memberId ? record.leftConfirmed : record.rightConfirmed;
        const otherConfirmed = record.pair.left.actor.memberId === memberId ? record.rightConfirmed : record.leftConfirmed;
        return <article key={record.pair.id} className="conflict-card" data-testid="conflict-card">
          <strong>{participant ? `与 ${memberName(record.pair.left.actor.memberId === memberId ? record.pair.right.actor.memberId : record.pair.left.actor.memberId)} 的修改冲突` : `${memberName(record.pair.left.actor.memberId)} 与 ${memberName(record.pair.right.actor.memberId)} 的修改冲突`}</strong>
          <p>{record.verdict ? zoneName(record.verdict.zone) : "黑区"} · {state.mode === "observe" ? "观察" : "冻结"} · {ruleName(record.verdict?.ruleId)}：{record.verdict?.summary}</p>
          <ModelDetail metadata={record.verdict?.adjudication} />
          {participant && (state.mode === "rules" || state.mode === "full") ? <div className="conflict-card-actions">
            <p>{ownConfirmed ? "你已确认，等待对方确认" : otherConfirmed ? "对方已确认，等待你的确认" : "双方尚未确认"}</p>
            <button type="button" onClick={() => { if (window.confirm("将撤回你在该文件本轮的全部修改，是否继续？")) performAction(record.pair.id, () => revertConflictPair(projectId, record.pair.id)); }}>我来改</button>
            <button type="button" disabled={ownConfirmed} onClick={() => performAction(record.pair.id, () => confirmConflictPair(projectId, record.pair.id))}>双方确认后继续</button>
            <button type="button" onClick={() => onChat(`@${memberName(record.pair.left.actor.memberId)} @${memberName(record.pair.right.actor.memberId)} 冲突摘要：${record.verdict?.summary ?? ""}`, record.pair.id)}>去聊天里商量</button>
          </div> : null}
          {actionErrors[record.pair.id] ? <p role="alert" data-testid="conflict-action-error">{actionErrors[record.pair.id]}</p> : null}
        </article>;
      })}
      {(state.blockedPersists ?? []).map((entry) => <p key={entry.file} className="conflict-lock">{entry.file} · 写盘已暂停（{entry.reason}）</p>)}
      {(state.pairDecisions ?? []).every((record) => record.status !== "judged" || record.verdict?.decision !== "lock") && !(state.blockedPersists?.length) ? <p>当前没有冻结。</p> : null}
    </div>
    <h3>相互关联的修改</h3>
    <div data-testid="conflict-candidates">{[...state.candidatePairs].sort((left, right) => Number(Boolean(left.path?.typeOnly)) - Number(Boolean(right.path?.typeOnly)) || right.updatedAt - left.updatedAt).map((pair) => {
      const record = (state.pairDecisions ?? []).find((record) => record.pair.id === pair.id);
      return <Candidate key={pair.id} pair={pair} projectId={projectId} memberName={memberName} symbolKinds={symbolKinds} onError={onError} onChat={onChat} onAction={performAction} actionError={actionErrors[pair.id]} decision={record?.verdict} recordStatus={record?.status} memberId={memberId} interventionEnabled={state.mode === "rules" || state.mode === "full"} />;
    })}</div>
    {state.candidatePairs.length === 0 ? <p>当前没有相互关联的修改。</p> : null}
    <h3>统计</h3>
    {state.adjudication ? <p data-testid="adjudication-statistics">模型调用 {state.adjudication.calls} 次 · 缓存命中 {state.adjudication.cacheHits} 次 · 升级比例 {(state.adjudication.escalationRatio * 100).toFixed(1)}%<br />延迟 p50/p95 {Math.round(state.adjudication.p50Ms)}/{Math.round(state.adjudication.p95Ms)} ms · 失败 {state.adjudication.failures} 次 · 费用估算 ${state.adjudication.costUsd.toFixed(6)}</p> : null}
    <p data-testid="conflict-statistics">{state.index.files} 个文件 · {state.index.symbols} 个符号 · {state.index.edges} 条关系<br />最近更新 {state.index.latestUpdate.durationMs.toFixed(1)} ms<br />变更单元 {state.statistics.total} 个 · 无关系 {state.statistics.unrelated} 个（{(state.statistics.unrelatedRatio * 100).toFixed(1)}%） · 仅类型关联 {state.statistics.typeOnly ?? 0} 个<br />变更对 {state.intervention?.decisions ?? (state.pairDecisions ?? []).length} 个 · 白区 {state.intervention?.white ?? (state.pairDecisions ?? []).filter((record) => record.verdict?.zone === "white").length} · 黑区 {state.intervention?.black ?? (state.pairDecisions ?? []).filter((record) => record.verdict?.zone === "black").length} · 灰区 {state.intervention?.grey ?? (state.pairDecisions ?? []).filter((record) => record.verdict?.zone === "grey").length}<br />本地决定比例 {((state.intervention?.localDecisionRatio ?? 0) * 100).toFixed(1)}% · 冻结总时长 {Math.round(state.intervention?.frozenDurationMs ?? 0)} ms<br />写盘被挡 {state.intervention?.persistBlockedCount ?? state.persistBlockedCount ?? 0} 次 · 卡片操作 {state.intervention?.uiActionCount ?? state.uiActionCount ?? 0} 次 · 轨迹写盘冲突 {state.persistConflicts ?? 0} 次</p>
    {state.indexing ? <p>语义索引正在建立。</p> : null}
    {state.degraded ? <p>冲突预防已降级：{state.degradedReason ?? "内部错误"}</p> : null}
    {state.traceWriteFailures ? <p>轨迹写入失败 {state.traceWriteFailures} 次。</p> : null}
    {state.index.truncated ? <p>文件数量超过 2000，当前只索引前 2000 个文件。</p> : null}
  </section>;
}

function Candidate({ pair, projectId, memberName, symbolKinds, onError, onChat, onAction, actionError, decision, recordStatus, memberId, interventionEnabled }: {
  pair: ConflictGuardState["candidatePairs"][number]; projectId: string; memberName(id?: string): string; symbolKinds: Map<string, ActiveSymbol["kind"]>; onError(error: unknown): void; onChat(text: string, pairId: string): void; onAction(pairId: string, action: () => Promise<unknown>): void; actionError?: string; decision?: NonNullable<ConflictGuardState["pairDecisions"]>[number]["verdict"]; recordStatus?: string; memberId?: string; interventionEnabled: boolean;
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
  const path = pair.distance === 0 ? zeroDistanceText(leftKind, rightKind, pair.left.symbol, pair.right.symbol) : relationPathText(pair.path);
  return <article className={`conflict-candidate ${decision?.zone ?? ""}`} data-testid="conflict-candidate">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {memberName(pair.left.actor.memberId)} 正在改 {displayName(pair.left.symbol, leftKind)} ⟷ {memberName(pair.right.actor.memberId)} 正在改 {displayName(pair.right.symbol, rightKind)}
    </button>
    <small>{decision ? `${zoneName(decision.zone)} · ${recordStatus === "resolved" ? "已解除" : recordStatus === "stale" ? "等待重新判定" : decisionName(decision.decision)} · ${ruleName(decision.ruleId)}：${decision.summary}` : null}<br />{pair.path?.typeOnly ? "仅类型关联：" : ""}{path}</small>
    {recordStatus === "analyzing" ? <p data-testid="adjudication-analyzing">分析中，相关文件等待研判结果。</p> : <ModelDetail metadata={decision?.adjudication} />}
    {detailError ? <p role="alert">读取符号详情失败：{detailError}</p> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
    {expanded ? <div className="conflict-pair-texts">{recordStatus === "judged" && decision?.decision === "lock" && memberId && (memberId === pair.left.actor.memberId || memberId === pair.right.actor.memberId) && interventionEnabled ? <div className="conflict-card-actions"><button type="button" onClick={() => { if (window.confirm("将撤回你在该文件本轮的全部修改，是否继续？")) onAction(pair.id, () => revertConflictPair(projectId, pair.id)); }}>我来改</button><button type="button" onClick={() => onAction(pair.id, () => confirmConflictPair(projectId, pair.id))}>双方确认后继续</button><button type="button" onClick={() => onChat(`@${memberName(pair.left.actor.memberId)} @${memberName(pair.right.actor.memberId)} 冲突摘要：${decision.summary}`, pair.id)}>去聊天里商量</button></div> : null}{[pair.left, pair.right].map((side, index) => {
      const change = texts?.[index]?.changes.find((change) => change.actor.memberId === side.actor.memberId);
      return <div key={`${side.actor.memberId}-${side.symbol}`}>
        <strong>{memberName(side.actor.memberId)} · {displayName(side.symbol, texts?.[index]?.symbol?.kind)}</strong>
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
function ModelDetail({ metadata }: { metadata?: NonNullable<NonNullable<ConflictGuardState["pairDecisions"]>[number]["verdict"]>["adjudication"] }) {
  if (!metadata) return null;
  return <p data-testid="adjudication-result">{metadata.status === "degraded" ? "研判失败，已降级为警告" : `已判定 · 由${metadata.source === "fast" ? "快判" : "深判"}模型判定 · 置信度 ${((metadata.confidence ?? 0) * 100).toFixed(1)}% · ${Math.round(metadata.latencyMs)} ms`}<br />{metadata.userExplanation}<br />建议：{metadata.suggestedAction}</p>;
}
function zoneName(zone: "white" | "black" | "grey") { return zone === "white" ? "白区" : zone === "black" ? "黑区" : "灰区"; }
function decisionName(decision: "allow" | "warn" | "lock") { return decision === "allow" ? "放行" : decision === "lock" ? "冻结" : "警告"; }
function ruleName(ruleId?: string) { return ({ "same-symbol-concurrent-write": "同一声明并发修改", "comment-format-only": "注释或空白修改", "observability-only": "只改日志", "equivalent-refactor": "等价重构", "referenced-symbol-removed": "引用的符号已删除", "runtime-export-removed": "运行时导出已删除", "call-signature-incompatible": "调用签名不兼容", "consumed-return-property-removed": "返回属性已删除", "interface-required-member-incompatible": "接口必需成员不兼容", "merge-only-type-error": "合并后才出现类型错误", "type-only-unchanged": "仅类型关联", "unparsable-side": "修改暂时无法解析", "semantic-interaction-uncertain": "语义交互不确定" } as Record<string, string>)[ruleId ?? ""] ?? ruleId ?? "规则判定"; }
