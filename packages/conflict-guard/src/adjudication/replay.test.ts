import { expect, it } from "vitest";
import { replayTrace } from "../replay/engine.js";
import { createReplayModelPolicy } from "../replay/policies.js";
import { defaultAdjudicationConfig } from "./config.js";
import { inputHash } from "./prompts.js";
import { calibrateThreshold } from "./calibrate.js";
import type { ZoneVerdict } from "../routing/classifier.js";
import type { TraceEvent } from "../trace/trace.js";

it("model replay reproduces recorded latency, analysis gate and byte-identical results", () => {
  const a = "export function price(){return 10;}"; const b = 'import {price} from "./a.ts"; export function buy(){return price()+1;}';
  const trace: TraceEvent[] = [{ schema: 3, seq: 1, at: 0, type: "session_start" }, { schema: 3, seq: 2, at: 0, type: "doc_open", file: "a.ts", text: a }, { schema: 3, seq: 3, at: 0, type: "doc_open", file: "b.ts", text: b }, { schema: 3, seq: 4, at: 0, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "a" }, ops: [{ from: a.indexOf("10"), deleted: "10", inserted: "20" }] }, { schema: 3, seq: 5, at: 10, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "b" }, ops: [{ from: b.indexOf("+1"), deleted: "+1", inserted: "+2" }] }];
  const responses = new Map<string, ZoneVerdict>(); const config = { ...defaultAdjudicationConfig, strategy: "G2" as const };
  replayTrace(trace, { policy: createReplayModelPolicy(config, new Map(), (input, local) => responses.set(inputHash(input), { ...local, decision: "lock", ruleId: "model-fast", adjudication: { strategy: "G2", source: "fast", confidence: 0.9, latencyMs: 2000, status: "success", escalated: false, userExplanation: "共同计算方式发生冲突。", suggestedAction: "请双方统一计算单位。", inputHash: inputHash(input), promptVersion: "pair-v1" } })) });
  const policy = createReplayModelPolicy(config, responses);
  const first = replayTrace(trace, { policy }); const second = replayTrace(trace, { policy });
  expect(first.finalDecision).toBe("lock");
  expect(first.gateIntervals.some((interval) => interval.reason === "analyzing" && interval.end! - interval.start === 2000)).toBe(true);
  expect(first.judgements[0]!.at - first.judgements[0]!.triggerAt).toBe(2015);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

it("calibration uses forced lock escalation and minimizes missed blocking before coverage", () => {
  const result = calibrateThreshold([{ truth: "allow", fast: { decision: "allow", confidence: 0.9 }, deep: { decision: "allow" } }, { truth: "lock", fast: { decision: "allow", confidence: 0.4 }, deep: { decision: "lock" } }, { truth: "lock", fast: { decision: "lock", confidence: 1 }, deep: { decision: "lock" } }]);
  expect(result.recommended).toBe(0.45);
  expect(result.curves[0]?.escalationRatio).toBeCloseTo(1 / 3);
  expect(result.curves.find((row) => row.threshold === 0.45)?.missBlockRatio).toBe(0);
});
