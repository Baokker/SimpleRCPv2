import { describe, expect, it } from "vitest";
import { generateManifest } from "./generator.js";
import { labelManifest, labelVariant } from "./labeler.js";
import { executeProbe } from "./executor.js";
import { replayTrace } from "../replay/engine.js";
import { OPERATOR_SPECS } from "./operators.js";
import type { BenchLabel, ProbeRun } from "./types.js";

describe("阶段 4 基准生成", () => {
  it("固定种子生成逐字节相同的关系组，项目只属于一个集合", () => {
    const projects = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name, files: {} }));
    const first = generateManifest({ projects, groups: 120, seed: 19 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(generateManifest({ projects, groups: 120, seed: 19 })));
    for (const project of projects) expect(new Set(first.groups.filter((group) => group.project === project.name).map((group) => group.split)).size).toBe(1);
    expect(first.groups.filter((group) => group.split === "dev").some((group) => ["EB-1", "SS-3"].includes(group.operator.id))).toBe(false);
  });

  it("每次探针都启动真实子进程并保留四种状态三次结果", async () => {
    const manifest = generateManifest({ projects: [{ name: "seed", files: {} }], groups: 1, seed: 2 });
    const result = await labelManifest(manifest, executeProbe, 2);
    expect(result.excluded).toEqual([]);
    expect(result.labels.map((label) => label.label)).toEqual(["lock", "allow"]);
    expect(result.labels.every((label) => Object.values(label.states).every((runs) => runs.length === 3 && runs.every((run) => run.stdout && run.probes)))).toBe(true);
  }, 60_000);

  it("全部算子的交错轨迹复原目标文本，孪生差异仅包含一个修改位置", () => {
    const projects = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name, files: {} }));
    const manifest = generateManifest({ projects, groups: 120, seed: 7 });
    expect(new Set(manifest.groups.map((group) => group.operator.id))).toEqual(new Set(OPERATOR_SPECS.map((operator) => operator.id)));
    for (const group of manifest.groups) {
      const { conflict, safe } = group.variants;
      expect(conflict.baseline).toEqual(safe.baseline);
      expect(conflict.leftOnly).toEqual(safe.leftOnly);
      expect(Object.keys(conflict.rightOnly).filter((file) => conflict.rightOnly[file] !== safe.rightOnly[file]).length).toBeLessThanOrEqual(1);
      for (const variant of [conflict, safe]) expect(replayTrace(variant.trace, { policy: "P0" }).finalTexts).toEqual(variant.merged);
    }
    expect(manifest.dependencyMix).toMatchObject({ oldBehavior: 108, newBehavior: 108, unrelated: 24 });
  }, 60_000);

  it("标签按不稳定、基线、单方、文本冲突、合并、观测规则求值", () => {
    const run: ProbeRun = { passed: true, observations: { value: 1 } };
    const states = (): BenchLabel["states"] => Object.fromEntries(["baseline", "leftOnly", "rightOnly", "merged"].map((name) => [name, Array.from({ length: 3 }, () => structuredClone(run))])) as BenchLabel["states"];
    const group = { id: "group" }; const variant = { id: "variant", kind: "conflict" as const };
    expect(labelVariant(group, variant, states()).label).toBe("allow");
    const flaky = states(); flaky.merged[1]!.observations.value = 2;
    expect(labelVariant(group, variant, flaky).reason).toBe("flaky");
    const baseline = states(); baseline.baseline.forEach((item) => item.passed = false);
    expect(labelVariant(group, variant, baseline).reason).toBe("invalid-baseline");
    const side = states(); side.leftOnly.forEach((item) => item.passed = false);
    expect(labelVariant(group, variant, side).reason).toBe("invalid-side");
    expect(labelVariant(group, variant, states(), true).reason).toBe("text-conflict");
    const merged = states(); merged.merged.forEach((item) => { item.passed = false; item.typeError = true; });
    expect(labelVariant(group, variant, merged)).toMatchObject({ label: "lock", detectability: "typecheck" });
    const warn = states(); warn.merged.forEach((item) => item.observations.value = 2);
    expect(labelVariant(group, variant, warn).label).toBe("warn");
  });
});
