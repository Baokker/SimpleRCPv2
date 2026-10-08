import type { ActorRef } from "../model/types.js";
import type { CandidatePair } from "../routing/candidates.js";
import { classify, type SemanticIndexReadonly, type ZoneVerdict } from "../routing/classifier.js";
import type { SymbolChange } from "../semantic/changes.js";
import type { PairAdjudicator } from "../coordination/pairState.js";
import type { ConflictGuardClock } from "../tracking/tracker.js";
import type { AdjudicationConfig, AdjudicationInput, GreyStrategy } from "../adjudication/types.js";
import { buildAdjudicationInput } from "../adjudication/invariants.js";
import { inputHash } from "../adjudication/prompts.js";

export interface ActiveFileChange {
  actor: ActorRef;
  file: string;
  symbols: SymbolChange[];
}

export interface PolicyInput {
  pair?: CandidatePair;
  activeFiles: ActiveFileChange[];
  project: SemanticIndexReadonly;
  symbols: (side: { actor: ActorRef; symbol: string }) => SymbolChange | undefined;
  bodyUnrelatedMaxAdjacentLines?: number;
}

export interface ZoningPolicy {
  id: "P0" | "P1" | "P2" | "P3" | "P*" | GreyStrategy;
  decide(input: PolicyInput): ZoneVerdict;
  beginReplay?(): void;
  adjudicate?(input: PolicyInput, local: ZoneVerdict, clock: ConflictGuardClock, signal: AbortSignal, complete: Parameters<PairAdjudicator>[3]): void;
  maxLatencyMs?: number;
}

const verdict = (decision: ZoneVerdict["decision"], ruleId: string, summary: string): ZoneVerdict => ({
  zone: decision === "allow" ? "white" : decision === "lock" ? "black" : "grey",
  decision,
  ruleId,
  summary,
  evidence: [],
  contractChanged: { left: false, right: false }
});

export function createP0Policy(): ZoningPolicy {
  return { id: "P0", decide: () => verdict("allow", "p0-no-coordination", "无协调策略放行修改。") };
}

export function createP1Policy(): ZoningPolicy {
  return {
    id: "P1",
    decide(input) {
      if (!input.pair) return input.activeFiles.some((left, index) => input.activeFiles.slice(index + 1).some((right) => actorKey(left.actor) !== actorKey(right.actor) && left.file === right.file)) ? verdict("lock", "p1-same-file", "双方正在修改同一个文件。") : verdict("allow", "p1-file-lock", "没有同文件并发修改。");
      const left = input.activeFiles.find((file) => actorKey(file.actor) === actorKey(input.pair!.left.actor) && file.file === input.pair!.left.symbol.slice(0, input.pair!.left.symbol.indexOf("#")));
      const right = input.activeFiles.find((file) => actorKey(file.actor) === actorKey(input.pair!.right.actor) && file.file === input.pair!.right.symbol.slice(0, input.pair!.right.symbol.indexOf("#")));
      return left && right && left.file === right.file ? verdict("lock", "p1-same-file", "双方正在修改同一个文件。") : verdict("allow", "p1-file-lock", "双方修改位于不同文件。 ");
    }
  };
}

export function createP2Policy(): ZoningPolicy {
  return { id: "P2", decide: (input) => input.pair ? verdict("lock", "p2-static-dal", "依赖关系位于两跳范围内。") : verdict("allow", "p2-static-dal", "没有候选关系。") };
}

export function createP3Policy(): ZoningPolicy {
  return {
    id: "P3",
    decide(input) {
      if (!input.pair) return verdict("allow", "no-relation", "没有候选关系。 ");
      const left = input.symbols(input.pair.left);
      const right = input.symbols(input.pair.right);
      if (!left || !right) return verdict("warn", "semantic-interaction-uncertain", "修改内容暂时无法解析。 ");
      return classify({
        left: { actor: input.pair.left.actor, symbol: left },
        right: { actor: input.pair.right.actor, symbol: right },
        path: input.pair.path,
        nested: input.pair.distance === 0 && input.pair.left.symbol !== input.pair.right.symbol,
        typeOnly: Boolean(input.pair.path?.typeOnly),
        project: input.project,
        bodyUnrelatedMaxAdjacentLines: input.bodyUnrelatedMaxAdjacentLines
      });
    }
  };
}

export function createOraclePolicy(truth: "allow" | "warn" | "lock"): ZoningPolicy {
  if (!["allow", "warn", "lock"].includes(truth)) throw new Error("P* 必须提供可执行探针的真值");
  return {
    id: "P*",
    decide(input) {
      if (!input.pair) return verdict("allow", "oracle-no-relation", "没有候选关系。");
      return truth === "allow"
        ? verdict("allow", "oracle-compatible", "可执行探针确认修改兼容。")
        : verdict("lock", "oracle-conflict-upper-bound", "可执行探针确认冲突，预言机阻止修改。");
    }
  };
}

export function policyFor(id: ZoningPolicy["id"], options: { oracleTruth?: "allow" | "warn" | "lock" } = {}): ZoningPolicy {
  if (id.startsWith("G")) { if (id === "G0") return { ...createP3Policy(), id: "G0" }; throw new Error("模型策略需要录放配置"); }
  if (id === "P0") return createP0Policy();
  if (id === "P1") return createP1Policy();
  if (id === "P2") return createP2Policy();
  if (id === "P*") {
    if (!options.oracleTruth) throw new Error("P* 必须提供可执行探针的真值");
    return createOraclePolicy(options.oracleTruth);
  }
  return createP3Policy();
}

export function replayModelRequestKey(input: AdjudicationInput, occurrence: number): string {
  return `${inputHash(input)}:${occurrence}`;
}

export function createReplayModelPolicy(config: AdjudicationConfig, responses: Map<string, ZoneVerdict>, onInput?: (input: AdjudicationInput, local: ZoneVerdict, occurrence: number) => void, contextFiles: string[] = [], cancelledInputs: ReadonlySet<string> = new Set()): ZoningPolicy {
  const occurrences = new Map<string, number>();
  return { ...createP3Policy(), id: config.strategy, beginReplay: () => occurrences.clear(), maxLatencyMs: config.strategy === "G0" ? 0 : config.hardDeadlineMs,
    ...(config.strategy === "G0" ? {} : { adjudicate(input: PolicyInput, local: ZoneVerdict, clock: ConflictGuardClock, signal: AbortSignal, complete: Parameters<PairAdjudicator>[3]) {
      const left = input.pair && input.symbols(input.pair.left); const right = input.pair && input.symbols(input.pair.right);
      if (!input.pair || !left || !right) { complete({ ...local, decision: "warn", ruleId: "model-unavailable" }); return; }
      const request = buildAdjudicationInput({ left: { actor: input.pair.left.actor, symbol: left }, right: { actor: input.pair.right.actor, symbol: right }, path: input.pair.path, nested: false, typeOnly: Boolean(input.pair.path?.typeOnly), project: input.project }, local, config, contextFiles);
      const hash = inputHash(request);
      const occurrence = (occurrences.get(hash) ?? 0) + 1;
      occurrences.set(hash, occurrence);
      const requestKey = replayModelRequestKey(request, occurrence);
      onInput?.(request, local, occurrence);
      if (cancelledInputs.has(requestKey) || cancelledInputs.has(hash)) return;
      const response = responses.get(requestKey) ?? responses.get(hash);
      const verdict = response ?? { ...local, decision: "warn" as const, ruleId: "model-unavailable", summary: "研判录放缓存未命中，已降级为警告。" };
      const timer = clock.setTimeout(() => { signal.removeEventListener("abort", abort); if (!signal.aborted) complete(verdict); }, verdict.adjudication?.latencyMs ?? 0);
      const abort = () => clock.clearTimeout(timer);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    } })
  };
}

function actorKey(actor: ActorRef) {
  if (actor.kind === "human") return `human:${actor.memberId}`;
  if (actor.kind === "agent") return `agent:${actor.runId}`;
  if (actor.kind === "guard-revert") return `guard-revert:${actor.memberId}`;
  return actor.kind;
}
