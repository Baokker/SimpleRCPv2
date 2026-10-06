import { expect, it } from "vitest";
import { createPairCoordinator } from "../coordination/pairState.js";
import type { CandidatePair } from "../routing/candidates.js";
import type { ZoneVerdict } from "../routing/classifier.js";
import { conflictWarning } from "../../../../apps/client/src/conflictGuardPresentation.js";

it("participants receive the model warning after a lock is automatically cleared", () => {
  const pair: CandidatePair = { id: "pair", left: { actor: { kind: "human", memberId: "alice" }, symbol: "pricing.ts#price", status: "modified" }, right: { actor: { kind: "human", memberId: "bob" }, symbol: "checkout.ts#checkout", status: "modified" }, path: { from: "checkout.ts#checkout", to: "pricing.ts#price", hops: [{ from: "checkout.ts#checkout", to: "pricing.ts#price", kind: "call", direction: "forward" }], typeOnly: false }, distance: 1, firstSeenAt: 0, updatedAt: 0, revisionKey: "first" };
  const local: ZoneVerdict = { zone: "black", decision: "lock", ruleId: "call-signature-incompatible", summary: "调用签名不兼容。", evidence: [], contractChanged: { left: true, right: false } };
  let revised = false;
  const coordinator = createPairCoordinator({ now: () => 0, classify: () => revised ? { ...local, zone: "grey", decision: "warn" } : local, adjudicate(_pair, verdict, _signal, complete) { complete({ ...verdict, ruleId: "model-deep", summary: "双方需要检查计算方式。", adjudication: { strategy: "G3", source: "deep", confidence: 0.9, latencyMs: 1200, status: "success", escalated: true, userExplanation: "双方需要检查计算方式。", suggestedAction: "请 Alice 检查 price 的计算单位。", inputHash: "input", promptVersion: "pair-v1" } }); } });
  coordinator.update([pair]);
  revised = true;
  coordinator.update([{ ...pair, revisionKey: "second" }]);
  const record = coordinator.get(pair.id)!;
  expect(record).toMatchObject({ status: "resolved", resolution: "auto-cleared", revision: 1, verdict: { decision: "warn" } });
  for (const memberId of ["alice", "bob"]) expect(conflictWarning(record, memberId)).toMatchObject({ id: "pair:1", summary: "双方需要检查计算方式。 建议：请 Alice 检查 price 的计算单位。 · 由深判模型判定 · 1200 ms" });
  expect(conflictWarning(record, "charlie")).toBeUndefined();
});
