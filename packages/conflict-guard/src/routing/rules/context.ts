import type * as ts from "typescript";
import type { ZoneInput, ZoneVerdict, FourStateResult } from "../classifier.js";
import type { SymbolChange } from "../../semantic/changes.js";
import { parseChangeSource, contractFingerprint } from "../contracts.js";
import { equivalentFingerprint, isObservabilityOnly, syntaxFingerprint } from "../fingerprints.js";

export interface SideAnalysis {
  before?: ts.SourceFile;
  after?: ts.SourceFile;
  parseError: boolean;
  commentFormatOnly: boolean;
  observabilityOnly: boolean;
  equivalentRefactor: boolean;
  contractChanged: boolean;
  detail: string;
}

export interface RuleContext {
  input: ZoneInput;
  left: SideAnalysis;
  right: SideAnalysis;
  evidence: ZoneVerdict["evidence"];
  contractChanged: ZoneVerdict["contractChanged"];
  incompatibilities: Array<ZoneVerdict | undefined>;
  typecheck?: FourStateResult;
}

export type ZoneRule = (context: RuleContext) => ZoneVerdict | undefined;

export function verdict(context: RuleContext, zone: ZoneVerdict["zone"], decision: ZoneVerdict["decision"], ruleId: string, summary: string, evidence: ZoneVerdict["evidence"] = []): ZoneVerdict {
  return { zone, decision, ruleId, summary, evidence: [...context.evidence, ...evidence], contractChanged: context.contractChanged, ...(context.typecheck ? { typecheck: context.typecheck } : {}) };
}

export function analyze(change: SymbolChange): SideAnalysis {
  const before = change.before.length > 0 ? parseChangeSource(change, change.before) : undefined;
  const after = change.after.length > 0 ? parseChangeSource(change, change.after) : undefined;
  if ((change.before.length > 0 && !before) || (change.after.length > 0 && !after)) return { before, after, parseError: true, commentFormatOnly: false, observabilityOnly: false, equivalentRefactor: false, contractChanged: true, detail: "修改文本无法解析" };
  if (!before || !after) {
    const contractChanged = change.status === "added" || change.status === "deleted" || change.before !== change.after;
    return { before, after, parseError: false, commentFormatOnly: false, observabilityOnly: false, equivalentRefactor: false, contractChanged, detail: contractChanged ? "符号新增或删除，外部接口发生变化" : "外部接口未发生变化" };
  }
  const changed = change.before !== change.after;
  const commentFormatOnly = changed && syntaxFingerprint(before) === syntaxFingerprint(after);
  const observabilityOnly = isObservabilityOnly(before, after);
  const equivalentRefactor = !commentFormatOnly && !observabilityOnly && changed && equivalentFingerprint(before) === equivalentFingerprint(after);
  const contractChanged = contractFingerprint(before) !== contractFingerprint(after) || change.status === "deleted" || (change.status === "added" && change.exported === true);
  return { before, after, parseError: false, commentFormatOnly, observabilityOnly, equivalentRefactor, contractChanged, detail: contractChanged ? "对外接口发生变化" : "对外接口未发生变化" };
}
