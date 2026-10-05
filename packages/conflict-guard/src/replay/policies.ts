import type { ActiveChangeSet, ActorRef } from "../model/types.js";
import type { CandidatePair } from "../routing/candidates.js";
import { classify, type SemanticIndexReadonly, type ZoneVerdict } from "../routing/classifier.js";
import type { SymbolChange } from "../semantic/changes.js";

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
}

export interface ZoningPolicy {
  id: "P0" | "P1" | "P2" | "P3";
  decide(input: PolicyInput): ZoneVerdict;
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
      if (!input.pair) return verdict("allow", "p1-file-lock", "没有同文件并发修改。 ");
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
        project: input.project
      });
    }
  };
}

export function policyFor(id: ZoningPolicy["id"]): ZoningPolicy {
  if (id === "P0") return createP0Policy();
  if (id === "P1") return createP1Policy();
  if (id === "P2") return createP2Policy();
  return createP3Policy();
}

function actorKey(actor: ActorRef) {
  if (actor.kind === "human") return `human:${actor.memberId}`;
  if (actor.kind === "agent") return `agent:${actor.runId}`;
  if (actor.kind === "guard-revert") return `guard-revert:${actor.memberId}`;
  return actor.kind;
}
