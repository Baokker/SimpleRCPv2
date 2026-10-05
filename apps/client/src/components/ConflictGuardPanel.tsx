import { useEffect, useState } from "react";
import { getConflictGuardSymbol } from "../api";
import type { ActiveSymbol, ConflictGuardState, ConflictGuardSymbol } from "../conflictGuardTypes";
import type { RoomMember } from "../types";

const statuses = { modified: "修改", added: "新增", deleted: "删除" };
const relations: Record<string, string> = { call: "调用", "value-reference": "引用值", "type-reference": "引用类型", inheritance: "继承", implementation: "实现", "state-read": "读取状态", "state-write": "写入状态", contains: "包含", override: "覆写", "implements-member": "实现成员" };

export function ConflictGuardPanel({ state, projectId, members, onOpenSymbol, onError }: {
  state: ConflictGuardState;
  projectId: string;
  members: RoomMember[];
  onOpenSymbol(file: string, line: number): void;
  onError(error: unknown): void;
}) {
  const memberName = (id?: string) => members.find((member) => member.id === id)?.displayName ?? id ?? "成员";
  const symbolKinds = new Map(state.activeSymbols.flatMap((group) => group.symbols.map((symbol) => [symbol.key, symbol.kind] as const)));
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
    <h3>相互关联的修改</h3>
    <div data-testid="conflict-candidates">{[...state.candidatePairs].sort((left, right) => Number(Boolean(left.path?.typeOnly)) - Number(Boolean(right.path?.typeOnly)) || right.updatedAt - left.updatedAt).map((pair) => <Candidate key={pair.id} pair={pair} projectId={projectId} memberName={memberName} symbolKinds={symbolKinds} onError={onError} />)}</div>
    {state.candidatePairs.length === 0 ? <p>当前没有相互关联的修改。</p> : null}
    <h3>统计</h3>
    <p data-testid="conflict-statistics">{state.index.files} 个文件 · {state.index.symbols} 个符号 · {state.index.edges} 条关系<br />最近更新 {state.index.latestUpdate.durationMs.toFixed(1)} ms<br />变更单元 {state.statistics.total} 个 · 无关系 {state.statistics.unrelated} 个（{(state.statistics.unrelatedRatio * 100).toFixed(1)}%） · 仅类型关联 {state.statistics.typeOnly ?? 0} 个</p>
    {state.indexing ? <p>语义索引正在建立。</p> : null}
    {state.degraded ? <p>冲突预防已降级：{state.degradedReason ?? "内部错误"}</p> : null}
    {state.traceWriteFailures ? <p>轨迹写入失败 {state.traceWriteFailures} 次。</p> : null}
    {state.index.truncated ? <p>文件数量超过 2000，当前只索引前 2000 个文件。</p> : null}
  </section>;
}

function Candidate({ pair, projectId, memberName, symbolKinds, onError }: {
  pair: ConflictGuardState["candidatePairs"][number]; projectId: string; memberName(id?: string): string; symbolKinds: Map<string, ActiveSymbol["kind"]>; onError(error: unknown): void;
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
  const path = pair.distance === 0 ? zeroDistanceText(leftKind, rightKind, pair.left.symbol, pair.right.symbol) : pair.path!.hops.map((hop) => {
    const from = hop.direction === "forward" ? hop.from : hop.to;
    const to = hop.direction === "forward" ? hop.to : hop.from;
    return `${symbolName(from)} ${relations[hop.kind]} ${symbolName(to)}`;
  }).join("；");
  return <article className="conflict-candidate" data-testid="conflict-candidate">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {memberName(pair.left.actor.memberId)} 正在改 {displayName(pair.left.symbol, leftKind)} ⟷ {memberName(pair.right.actor.memberId)} 正在改 {displayName(pair.right.symbol, rightKind)}
    </button>
    <small>{pair.path?.typeOnly ? "仅类型关联：" : ""}{path}</small>
    {detailError ? <p role="alert">读取符号详情失败：{detailError}</p> : null}
    {expanded ? <div className="conflict-pair-texts">{[pair.left, pair.right].map((side, index) => {
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
