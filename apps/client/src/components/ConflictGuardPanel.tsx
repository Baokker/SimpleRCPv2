import { useEffect, useState } from "react";
import { getConflictGuardSymbol } from "../api";
import type { ConflictGuardState, ConflictGuardSymbol } from "../conflictGuardTypes";
import type { RoomMember } from "../types";

const statuses = { modified: "修改", added: "新增", deleted: "删除" };
const relations: Record<string, string> = { call: "调用", "value-reference": "引用值", "type-reference": "引用类型", inheritance: "继承", implementation: "实现", "state-read": "读取状态", "state-write": "写入状态" };

export function ConflictGuardPanel({ state, projectId, members, onOpenSymbol, onError }: {
  state: ConflictGuardState;
  projectId: string;
  members: RoomMember[];
  onOpenSymbol(file: string, line: number): void;
  onError(error: unknown): void;
}) {
  const memberName = (id?: string) => members.find((member) => member.id === id)?.displayName ?? id ?? "成员";
  return <section className="collab-section conflict-guard-panel" data-testid="conflict-guard-panel">
    <h3>正在修改</h3>
    {state.activeSymbols.filter((group) => group.symbols.length > 0).map((group) => <div key={group.actor.memberId}>
      <strong>{memberName(group.actor.memberId)}</strong>
      <ul className="conflict-symbol-list">{group.symbols.map((symbol) => <li key={symbol.key}>
        <button type="button" data-testid={`conflict-symbol-${group.actor.memberId}-${symbol.key}`} onClick={() => onOpenSymbol(symbol.file, symbol.startLine)}>
          {symbol.file}:{symbol.startLine}–{symbol.endLine} {symbol.name}
        </button>
        <small>{statuses[symbol.status]} · {elapsed(symbol.lastTouchedAt)}</small>
      </li>)}</ul>
    </div>)}
    {state.activeSymbols.every((group) => group.symbols.length === 0) ? <p>当前没有符号修改。</p> : null}
    <h3>相互关联的修改</h3>
    <div data-testid="conflict-candidates">{state.candidatePairs.map((pair) => <Candidate key={pair.id} pair={pair} projectId={projectId} memberName={memberName} onError={onError} />)}</div>
    {state.candidatePairs.length === 0 ? <p>当前没有相互关联的修改。</p> : null}
    <h3>统计</h3>
    <p data-testid="conflict-statistics">{state.index.files} 个文件 · {state.index.symbols} 个符号 · {state.index.edges} 条关系<br />最近更新 {state.index.latestUpdate.durationMs.toFixed(1)} ms<br />变更单元 {state.statistics.total} 个 · 无关系 {state.statistics.unrelated} 个（{(state.statistics.unrelatedRatio * 100).toFixed(1)}%）</p>
    {state.index.truncated ? <p>文件数量超过 2000，当前只索引前 2000 个文件。</p> : null}
  </section>;
}

function Candidate({ pair, projectId, memberName, onError }: {
  pair: ConflictGuardState["candidatePairs"][number]; projectId: string; memberName(id?: string): string; onError(error: unknown): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [texts, setTexts] = useState<ConflictGuardSymbol[]>();
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    void Promise.all([getConflictGuardSymbol(projectId, pair.left.symbol), getConflictGuardSymbol(projectId, pair.right.symbol)]).then((next) => { if (active) setTexts(next); }).catch(onError);
    return () => { active = false; };
  }, [expanded, projectId, pair.id, pair.updatedAt]);
  const path = pair.distance === 0 ? "两人在改同一个函数" : pair.path!.hops.map((hop) => {
    const from = hop.direction === "forward" ? hop.from : hop.to;
    const to = hop.direction === "forward" ? hop.to : hop.from;
    return `${symbolName(from)} ${relations[hop.kind]} ${symbolName(to)}`;
  }).join("；");
  return <article className="conflict-candidate" data-testid="conflict-candidate">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {memberName(pair.left.actor.memberId)} 正在改 {symbolName(pair.left.symbol)}() ⟷ {memberName(pair.right.actor.memberId)} 正在改 {symbolName(pair.right.symbol)}()
    </button>
    <small>{path}</small>
    {expanded ? <div className="conflict-pair-texts">{[pair.left, pair.right].map((side, index) => {
      const change = texts?.[index]?.changes.find((change) => change.actor.memberId === side.actor.memberId);
      return <div key={`${side.actor.memberId}-${side.symbol}`}>
        <strong>{memberName(side.actor.memberId)} · {symbolName(side.symbol)}</strong>
        <h4>修改前</h4><pre>{change?.before ?? "正在读取"}</pre>
        <h4>修改后</h4><pre>{change?.after ?? "正在读取"}</pre>
      </div>;
    })}</div> : null}
  </article>;
}

function symbolName(key: string) { return key.slice(key.indexOf("#") + 1); }
function elapsed(at: number) { const seconds = Math.max(0, Math.floor((Date.now() - at) / 1_000)); return seconds < 60 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分钟前`; }
