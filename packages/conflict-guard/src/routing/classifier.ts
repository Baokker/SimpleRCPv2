import type { ActorRef } from "../model/types.js";
import type { RelationPath, SemanticIndex } from "../semantic/types.js";
import type { SymbolChange } from "../semantic/changes.js";
import { analyze, type RuleContext, type ZoneRule } from "./rules/context.js";
import { sameSymbolConcurrentWrite } from "./rules/same-symbol-concurrent-write.js";
import { typeOnlyUnchanged } from "./rules/type-only-unchanged.js";
import { commentFormatOnly } from "./rules/comment-format-only.js";
import { observabilityOnly } from "./rules/observability-only.js";
import { equivalentRefactor } from "./rules/equivalent-refactor.js";
import { referencedSymbolRemoved } from "./rules/referenced-symbol-removed.js";
import { runtimeExportRemoved } from "./rules/runtime-export-removed.js";
import { callSignatureIncompatible } from "./rules/call-signature-incompatible.js";
import { consumedReturnPropertyRemoved } from "./rules/consumed-return-property-removed.js";
import { interfaceRequiredMemberIncompatible } from "./rules/interface-required-member-incompatible.js";
import { mergeOnlyTypeError } from "./rules/merge-only-type-error.js";
import { unparsableSide } from "./rules/unparsable-side.js";
import { semanticInteractionUncertain } from "./rules/semantic-interaction-uncertain.js";
import { commentOnly } from "./rules/comment-only-edit.js";
import { declarationBodyUnrelated } from "./rules/declaration-body-unrelated.js";

export type Zone = "white" | "black" | "grey";
export type Decision = "allow" | "warn" | "lock";

export interface PairSide {
  actor: ActorRef;
  symbol: SymbolChange;
}

export interface SemanticIndexReadonly extends Pick<SemanticIndex, "symbolsInFile" | "outgoing" | "incoming"> {
  referenceTargets?(file: string, position: number): string[];
  readFile?(file: string): string;
  listFiles?(): string[];
  checkFourStates?(input: FourStateInput): FourStateResult;
}

export interface ZoneInput {
  left: PairSide;
  right: PairSide;
  path: RelationPath | null;
  nested: boolean;
  typeOnly: boolean;
  project: SemanticIndexReadonly;
  bodyUnrelatedMaxAdjacentLines?: number;
  cluster?: { left: SymbolChange[]; right: SymbolChange[]; paths: Array<RelationPath | null> };
}

export interface ZoneVerdict {
  zone: Zone;
  decision: Decision;
  ruleId: string;
  summary: string;
  evidence: Array<{ file: string; symbol?: string; detail: string }>;
  contractChanged: { left: boolean; right: boolean };
  localOnly?: boolean;
  typecheck?: { ran: boolean; skipped?: string; durationMs?: number; mergeOnlyDiagnostics?: string[] };
  adjudication?: import("../adjudication/types.js").ModelVerdictMetadata;
}

export interface FourStateInput {
  left: PairSide;
  right: PairSide;
  path: RelationPath | null;
}

export interface FourStateResult {
  ran: boolean;
  skipped?: string;
  durationMs?: number;
  mergeOnlyDiagnostics?: string[];
  inferredReturnTypeChanged?: { left: boolean; right: boolean };
}

export function classify(input: ZoneInput): ZoneVerdict {
  const left = analyze(input.left.symbol);
  const right = analyze(input.right.symbol);
  const context: RuleContext = {
    input, left, right,
    contractChanged: { left: left.contractChanged, right: right.contractChanged },
    evidence: [{ file: input.left.symbol.file, symbol: input.left.symbol.key, detail: left.detail }, { file: input.right.symbol.file, symbol: input.right.symbol.key, detail: right.detail }],
    incompatibilities: []
  };
  context.incompatibilities = [referencedSymbolRemoved, runtimeExportRemoved, callSignatureIncompatible, consumedReturnPropertyRemoved, interfaceRequiredMemberIncompatible].map((rule) => rule(context));
  for (const rule of [commentOnly, commentFormatOnly, observabilityOnly, declarationBodyUnrelated, sameSymbolConcurrentWrite, typeOnlyUnchanged, equivalentRefactor] satisfies ZoneRule[]) {
    const result = rule(context);
    if (result) return result;
  }
  for (const result of context.incompatibilities) if (result) return result;
  for (const rule of [mergeOnlyTypeError, unparsableSide, semanticInteractionUncertain] satisfies ZoneRule[]) {
    const result = rule(context);
    if (result) return result;
  }
  throw new Error("分区规则缺少默认结果");
}

export const classifyPairZone = classify;

export function symbolContractChanged(change: SymbolChange) {
  return analyze(change).contractChanged;
}
