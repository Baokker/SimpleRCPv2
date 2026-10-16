import { expect, it } from "vitest";
import { selectDevelopmentCandidate, type DevelopmentCandidate } from "./selection.js";

const candidate = (id: string, changes: Partial<DevelopmentCandidate> = {}): DevelopmentCandidate => ({ id, validResponseRatio: 1, falseBlockRatio: 0, missed: 0, agreement: 0.8, p50Ms: 1000, escalationRatio: 0.5, ...changes });

it("按已登记的有效率、误拦率、漏阻断和一致率顺序选择", () => {
  expect(selectDevelopmentCandidate([candidate("invalid", { validResponseRatio: 0.94, agreement: 1 }), candidate("excessive", { falseBlockRatio: 0.16, agreement: 1 }), candidate("selected"), candidate("missed", { missed: 2, agreement: 1 })], "prompt").id).toBe("selected");
  expect(selectDevelopmentCandidate([candidate("first", { missed: 0, agreement: 0.8 }), candidate("second", { missed: 1, agreement: 0.9 })], "strategy").id).toBe("second");
});

it("全部误拦超过门槛时选最低者，阈值同分时选升级率较低者", () => {
  expect(selectDevelopmentCandidate([candidate("first", { falseBlockRatio: 0.3 }), candidate("second", { falseBlockRatio: 0.2, missed: 10 })], "prompt").id).toBe("second");
  expect(selectDevelopmentCandidate([candidate("first", { p50Ms: 100, escalationRatio: 0.8 }), candidate("second", { p50Ms: 1000, escalationRatio: 0.2 })], "threshold").id).toBe("second");
  expect(selectDevelopmentCandidate([candidate("first", { p50Ms: 100 }), candidate("second", { p50Ms: 1000 })], "strategy").id).toBe("first");
  expect(() => selectDevelopmentCandidate([], "prompt")).toThrow();
});
