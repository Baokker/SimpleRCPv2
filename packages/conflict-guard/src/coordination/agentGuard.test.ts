import { expect, it } from "vitest";
import { agentInputRevision, evaluateAgentChanges, selectAgentReverts, mergeAgentProposal, proposalFileChange, proposalSymbolKeys, symbolSignature } from "./agentGuard.js";
import { VirtualClock } from "../replay/clock.js";
import { MemoryFileProvider } from "../replay/files.js";
import { replayLibraries } from "../../scripts/replay-libs.ts";
import { ConflictGuardTracker } from "../tracking/tracker.js";

it("includes multiline parameters in function and method signatures", () => {
  expect(symbolSignature("export function price(\n value: number,\n currency: string\n): number { return value; }")).toBe("export function price( value: number, currency: string ): number");
  expect(symbolSignature("total(\n currency: string\n): number { return 1; }")).toContain("currency: string");
});

it("uses the product signature rule and state machine for an Agent proposal against a human", async () => {
  const baseline = "export function price(value: number) { return value; }\n";
  const current = baseline.replace("value: number", "value: number, currency: string");
  const consumer = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const files = new Map([["pricing.ts", current], ["cart.ts", consumer]]);
  const clock = new VirtualClock();
  const result = await evaluateAgentChanges({ actor: { kind: "agent", runId: "run-b", ownerId: "bob" }, proposals: [{ file: "cart.ts", before: consumer, after: consumer.replace("price(10)", "price(20)") }], active: [{ actor: { kind: "human", memberId: "alice" }, status: "settled", files: new Map([["pricing.ts", { file: "pricing.ts", baseText: baseline, ranges: [{ start: 0, end: current.length }], firstTouchedAt: 0, lastTouchedAt: 1 }]]) }], files: { listFiles: () => [...files.keys()], readFile: (file) => files.get(file)!, version: () => 1 }, now: () => clock.now(), signal: new AbortController().signal });
  expect(result.decision).toBe("lock");
  expect(result.records).toMatchObject([{ status: "judged", verdict: { ruleId: "call-signature-incompatible", decision: "lock" } }]);
});

it("reverts unchanged Agent blocks while preserving other participants' changes", () => {
  const result = selectAgentReverts("alpha = 1;\nbeta = 2;\n", "alpha = 10;\nbeta = 20;\n", "// Bob\nalpha = 10;\nbeta = 25;\n");
  expect(result.text).toBe("// Bob\nalpha = 1;\nbeta = 25;\n");
  expect(result.reverted).toHaveLength(1);
  expect(result.skipped).toHaveLength(1);
});

it("keeps a changed numeric expression as a complete line during selective revert", () => {
  const result = selectAgentReverts("amount = 0;\nrate = 0.1;\n", "amount = 10;\nrate = 0.2;\n", "amount = 10;\nrate = 0.25;\n");
  expect(result.text).toBe("amount = 0;\nrate = 0.25;\n");
  expect(result.skipped).toHaveLength(1);
});

it("merges a proposal with unsaved changes outside its region and rejects overlapping shared edits", () => {
  const proposal = { file: "a.ts", before: "first = 1;\nsecond = 2;\n", after: "first = 1;\nsecond = 3;\n" };
  expect(mergeAgentProposal(proposal, "first = 10;\nsecond = 2;\n").after).toBe("first = 10;\nsecond = 3;\n");
  expect(() => mergeAgentProposal(proposal, "first = 1;\nsecond = 4;\n")).toThrow("修改范围内已有其他参与者的编辑");
});

it("keeps dependency edges when the proposal deletes an exported file", async () => {
  const producer = "export function price(value: number) { return value; }\n";
  const before = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const current = before.replace("price(10)", "price(20)");
  const files = new Map([["pricing.ts", producer], ["cart.ts", current]]);
  const result = await evaluateAgentChanges({ actor: { kind: "agent", runId: "delete-run", ownerId: "bob" }, proposals: [{ file: "pricing.ts", before: producer, after: "", deleted: true }], active: [{ actor: { kind: "human", memberId: "alice" }, status: "settled", files: new Map([["cart.ts", { file: "cart.ts", baseText: before, ranges: [{ start: 0, end: current.length }], firstTouchedAt: 0, lastTouchedAt: 1 }]]) }], files: { listFiles: () => [...files.keys()], readFile: (file) => files.get(file)!, version: () => 1 }, now: () => 2, signal: new AbortController().signal });
  expect(result.decision).toBe("lock");
  expect(result.records).toHaveLength(1);
});

it("keeps container declarations in added and deleted Agent symbol sets", () => {
  const declaration = "export class Cart { total() { return 1; } }\n";
  const expected = new Set(["cart.ts#Cart", "cart.ts#Cart.total"]);
  expect(proposalSymbolKeys({ file: "cart.ts", before: declaration, after: "" })).toEqual(expected);
  expect(proposalSymbolKeys({ file: "cart.ts", before: "", after: declaration })).toEqual(expected);
});

it("rejects an Agent proposal when grey adjudication throws synchronously", async () => {
  const baseline = "export function price(value: number) { return value; }\n";
  const current = baseline.replace("return value", "return value * 2");
  const consumer = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const files = new Map([["pricing.ts", current], ["cart.ts", consumer]]);
  const result = await evaluateAgentChanges({ actor: { kind: "agent", runId: "error-run", ownerId: "bob" }, proposals: [{ file: "cart.ts", before: consumer, after: consumer.replace("price(10)", "price(20)") }], active: [{ actor: { kind: "human", memberId: "alice" }, status: "settled", files: new Map([["pricing.ts", { file: "pricing.ts", baseText: baseline, ranges: [{ start: 0, end: current.length }], firstTouchedAt: 0, lastTouchedAt: 1 }]]) }], files: { listFiles: () => [...files.keys()], readFile: (file) => files.get(file)!, version: () => 1 }, now: () => 2, signal: new AbortController().signal, adjudicate() { throw new Error("研判输入生成失败"); } });
  expect(result.decision).toBe("lock");
  expect(result.records[0]?.verdict?.ruleId).toBe("agent-analysis-unavailable");
});

it("preserves TypeScript libraries from an in-memory provider during Agent checks", async () => {
  const before = "export function price(value: number) { return value; }\n";
  const after = before.replace("return value", "return value * 2");
  const consumer = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const files = new MemoryFileProvider({ "pricing.ts": after, "cart.ts": consumer }, await replayLibraries());
  const result = await evaluateAgentChanges({ actor: { kind: "agent", runId: "consumer", ownerId: "bob" }, proposals: [{ file: "cart.ts", before: consumer, after: consumer.replace("price(10)", "Number(price(10).toFixed(2))") }], active: [{ actor: { kind: "human", memberId: "alice" }, status: "settled", files: new Map([["pricing.ts", proposalFileChange({ file: "pricing.ts", before, after }, 1)]]) }], files, now: () => 2, signal: new AbortController().signal });
  expect(result.records[0]?.verdict?.typecheck).toMatchObject({ ran: true, mergeOnlyDiagnostics: [] });
  expect(result.decision).toBe("warn");
});

it("changes the Agent input revision when an active participant finishes", () => {
  const actor = { kind: "agent" as const, runId: "producer", ownerId: "alice" };
  const proposal = { file: "pricing.ts", before: "export const price = 1;", after: "export const price = 2;" };
  const tracker = new ConflictGuardTracker({ clock: new VirtualClock(), createId: () => "revision-test" });
  tracker.startAgent(actor); tracker.attributeAgentChange(actor, proposalFileChange(proposal, 0));
  const before = agentInputRevision([proposal], tracker.getActiveChangeSets(), () => proposal.after);
  tracker.markDone(actor);
  expect(agentInputRevision([proposal], tracker.getActiveChangeSets(), () => proposal.after)).not.toBe(before);
});
