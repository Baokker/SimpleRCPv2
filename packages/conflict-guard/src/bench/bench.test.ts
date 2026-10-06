import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateManifest } from "./generator.js";
import { labelManifest, labelVariant } from "./labeler.js";
import { executeProbe } from "./executor.js";
import { operatorTemplate } from "./templates.js";
import { validateTrace } from "../trace/trace.js";
import { replayTrace } from "../replay/engine.js";
import { VirtualClock } from "../replay/clock.js";
import { ConflictGuardTracker } from "../tracking/tracker.js";
import type { ActorRef, TextEditOp } from "../model/types.js";
import type { TraceEvent } from "../trace/trace.js";
import { OPERATOR_SPECS } from "./operators.js";
import type { BenchLabel, ProbeRun, SeedProject } from "./types.js";

const seedRoot = fileURLToPath(new URL("../../bench/seeds/", import.meta.url));
const projects: SeedProject[] = fs.readdirSync(seedRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, files: collectFiles(path.join(seedRoot, entry.name)) }));

describe("阶段 4 基准生成", () => {
  it("固定种子使用原始业务源码，保留两个完整算子族与独立项目", () => {
    const manifest = generateManifest({ projects, groups: 140, seed: 19 });
    expect(JSON.stringify(manifest)).toBe(JSON.stringify(generateManifest({ projects, groups: 140, seed: 19 })));
    expect(manifest.programStats).toMatchObject({ seedPrograms: 7, developmentHoldoutOverlap: 0, heldoutFamilies: ["SS", "EB"] });
    expect(manifest.programStats!.uniquePrograms).toBeGreaterThan(60);
    expect(manifest.programStats!.uniqueVariantPrograms).toBeGreaterThan(60);
    const heldoutProjects = new Set(manifest.groups.filter((group) => group.split === "holdout").map((group) => group.project));
    expect(heldoutProjects.size / projects.length).toBeGreaterThanOrEqual(0.3);
    expect(manifest.groups.filter((group) => group.split === "dev").some((group) => ["SS", "EB"].includes(group.operator.family))).toBe(false);
    for (const group of manifest.groups) {
      const original = projects.find((project) => project.name === group.project)!;
      expect(group.variants.conflict.baseline).toEqual(original.files);
      expect(Object.keys(group.variants.conflict.baseline)).not.toContain("src/producer.ts");
      expect(Object.keys(group.variants.conflict.baseline).filter((file) => file.startsWith("src/")).length).toBeGreaterThanOrEqual(5);
      expect(group.variants.conflict.site?.producerKey).toContain(group.variants.conflict.entryPoints!.producer);
      expect(new Set(manifest.groups.filter((item) => item.project === original.name).map((item) => item.split)).size).toBe(1);
    }
  });

  it("每次探针启动真实子进程，四种状态保留三次结果与种子共享测试", async () => {
    const manifest = generateManifest({ projects: [projects.find((project) => project.name === "commerce")!], groups: 1, seed: 2 });
    const result = await labelManifest(manifest, executeProbe, 2);
    expect(result.excluded).toEqual([]);
    expect(result.labels.map((label) => label.label)).toEqual(["lock", "allow"]);
    expect(result.labels.every((label) => Object.values(label.states).every((runs) => runs.length === 3 && runs.every((run) => run.stdout && run.probes && run.regression?.tests === 2)))).toBe(true);
  }, 90_000);

  it("全部算子以最小编辑复原业务源码，包含三种时序、分布采样与批次关闭", () => {
    const manifest = generateManifest({ projects, groups: 140, seed: 7 });
    expect(new Set(manifest.groups.map((group) => group.operator.id))).toEqual(new Set(OPERATOR_SPECS.map((operator) => operator.id)));
    expect(new Set(manifest.groups.map((group) => group.variants.conflict.schedule))).toEqual(new Set(["simultaneous", "sequential", "alternating"]));
    const intervals = new Set<number>();
    for (const group of manifest.groups) {
      const { conflict, safe } = group.variants;
      expect(conflict.baseline).toEqual(safe.baseline);
      expect(conflict.leftOnly).toEqual(safe.leftOnly);
      if (group.operator.family === "SF") expect(conflict.aliasOf).toBe(safe.id);
      for (const variant of [conflict, safe]) {
        expect(validateTrace(variant.trace)).toBe(true);
        const texts = Object.fromEntries(Object.entries(variant.baseline).filter(([file]) => !file.startsWith("test/")));
        const actorTimes = new Map<string, number>();
        for (const event of variant.trace) if (event.type === "edit") {
          const actor = (event.origin as { memberId: string }).memberId;
          if (actorTimes.has(actor)) intervals.add(event.at - actorTimes.get(actor)!);
          actorTimes.set(actor, event.at);
          const file = String(event.file);
          for (const operation of event.ops as Array<{ from: number; inserted: string; deleted: string }>) {
            expect(operation.inserted.length).toBeLessThanOrEqual(1);
            expect(operation.deleted.length).toBeLessThanOrEqual(1);
            expect(texts[file]!.slice(operation.from, operation.from + operation.deleted.length)).toBe(operation.deleted);
            texts[file] = texts[file]!.slice(0, operation.from) + operation.inserted + texts[file]!.slice(operation.from + operation.deleted.length);
          }
        }
        expect(texts).toEqual(Object.fromEntries(Object.entries(variant.merged).filter(([file]) => !file.startsWith("test/"))));
        expect(variant.trace.some((event) => event.type === "cursor")).toBe(true);
      }
    }
    expect(intervals.size).toBeGreaterThan(20);
    expect([...intervals].some((interval) => interval > 1500)).toBe(true);
    expect(manifest.dependencyMix!.oldBehavior).toBe(manifest.dependencyMix!.newBehavior);
    expect(manifest.dependencyMix!.unrelated).toBeGreaterThan(0);
  }, 60_000);

  it("SF-5 是实际返回单位变化与调用方配套修改", async () => {
    const project = projects.find((item) => item.name === "commerce")!;
    const template = operatorTemplate("SF-5", true, 1, project);
    const manifest = generateManifest({ projects: [project], groups: 1, seed: 1 });
    const variant = manifest.groups[0]!.variants.safe;
    Object.assign(variant, { baseline: template.baseline, baselineReference: template.baseline, leftOnly: { ...template.baseline, ...template.left }, rightOnly: { ...template.baseline, ...template.right }, merged: template.merged, probes: template.probes, entryPoints: template.entryPoints });
    expect(template.left["src/delivery.ts"]).toContain("distanceUnit = 1000");
    expect(template.right["src/fulfillment.ts"]).toContain("value / delivery.distanceUnit");
    for (const state of ["baseline", "leftOnly", "rightOnly", "merged"] as const) expect(await executeProbe(variant, state)).toMatchObject({ passed: true, typeError: false });
  }, 60_000);

  it("真实种子轨迹在 P0 与 P3 下逐字节确定，并触发持续输入和光标关闭", () => {
    const project = projects.find((item) => item.name === "commerce")!;
    const manifest = generateManifest({ projects: [project], groups: 14, seed: 20261006 });
    const variant = manifest.groups.find((group) => group.operator.id === "CP-5")!.variants.conflict;
    for (const policy of ["P0", "P3"] as const) expect(JSON.stringify(replayTrace(variant.trace, { policy, seed: 19 }))).toBe(JSON.stringify(replayTrace(variant.trace, { policy, seed: 19 })));
    const reasons = new Set(manifest.groups.flatMap((group) => generatedBatchReasons(group.variants.conflict.trace)));
    expect(reasons.has("max-duration")).toBe(true);
    expect(reasons.has("cursor-left")).toBe(true);
  }, 60_000);

  it("真实单方类型错误被剔除，种子测试失败会使共享回归失败", async () => {
    const project = projects.find((item) => item.name === "commerce")!;
    const manifest = generateManifest({ projects: [project], groups: 1, seed: 1 });
    const variant = manifest.groups[0]!.variants.safe;
    variant.leftOnly[variant.entryPoints!.producer] += '\nconst invalidValue: number = "invalid";\n';
    const side = await executeProbe(variant, "leftOnly");
    expect(side).toMatchObject({ passed: true, typeError: true });
    const baseline = await executeProbe(variant, "baseline");
    const states = Object.fromEntries(["baseline", "leftOnly", "rightOnly", "merged"].map((name) => [name, Array.from({ length: 3 }, () => structuredClone(name === "leftOnly" ? side : baseline))])) as BenchLabel["states"];
    expect(labelVariant(manifest.groups[0]!, variant, states).reason).toBe("invalid-side");
    variant.baseline["test/regression.test.mjs"] = 'import test from "node:test"; import assert from "node:assert/strict"; test("共享回归", () => assert.equal(1, 2));';
    expect(await executeProbe(variant, "baseline")).toMatchObject({ passed: false, regression: { passed: false, tests: 3 } });
  }, 60_000);

  it("标签剔除单方类型错误，观测值只按声明的合并期望计算", () => {
    const run: ProbeRun = { passed: true, observations: { value: 1 } };
    const states = (): BenchLabel["states"] => Object.fromEntries(["baseline", "leftOnly", "rightOnly", "merged"].map((name) => [name, Array.from({ length: 3 }, () => structuredClone(run))])) as BenchLabel["states"];
    const group = { id: "group" }; const variant = { id: "variant", kind: "conflict" as const };
    expect(labelVariant(group, variant, states()).label).toBe("allow");
    const flaky = states(); flaky.merged[1]!.observations.value = 2;
    expect(labelVariant(group, variant, flaky).reason).toBe("flaky");
    const baseline = states(); baseline.baseline.forEach((item) => item.passed = false);
    expect(labelVariant(group, variant, baseline).reason).toBe("invalid-baseline");
    const side = states(); side.leftOnly.forEach((item) => item.typeError = true);
    expect(labelVariant(group, variant, side).reason).toBe("invalid-side");
    expect(labelVariant(group, variant, states(), true).reason).toBe("text-conflict");
    const merged = states(); merged.merged.forEach((item) => { item.passed = false; item.typeError = true; });
    expect(labelVariant(group, variant, merged)).toMatchObject({ label: "lock", detectability: "typecheck" });
    const combined = states(); combined.merged.forEach((item) => item.observations.value = 2);
    expect(labelVariant(group, variant, combined).label).toBe("allow");
    expect(labelVariant(group, { ...variant, expectedMergedObservations: { value: 2 } }, combined).label).toBe("allow");
    expect(labelVariant(group, { ...variant, expectedMergedObservations: { value: 1 } }, combined).label).toBe("warn");
  });
});

function generatedBatchReasons(events: TraceEvent[]): string[] {
  const clock = new VirtualClock();
  const tracker = new ConflictGuardTracker({ clock, idleMs: 1500, maxBatchDurationMs: 5000, activeIdleMs: 600000 });
  const texts = new Map<string, string>();
  const reasons: string[] = [];
  tracker.onEvent((event) => { if (event.type === "batch_closed") reasons.push(event.batch.closeReason); });
  for (const event of events) {
    clock.advanceTo(event.at);
    const file = String(event.file);
    if (event.type === "doc_open") { texts.set(file, String(event.text)); tracker.openDocument(file, String(event.text)); }
    if (event.type === "edit") {
      const before = texts.get(file)!;
      const ops = event.ops as TextEditOp[];
      let after = before;
      for (const operation of ops) after = after.slice(0, operation.from) + operation.inserted + after.slice(operation.from + operation.deleted.length);
      texts.set(file, after);
      tracker.edit({ file, origin: event.origin as ActorRef, ops, textBefore: before, textAfter: after, at: event.at, revisionAfter: Number(event.revisionAfter) });
    }
    if (event.type === "cursor") {
      const position = event.position as { lineNumber: number; column: number };
      tracker.cursorChanged({ actor: { kind: "human", memberId: String(event.memberId) }, file, ...position, at: event.at });
    }
  }
  return reasons;
}

function collectFiles(root: string, relative = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(files, collectFiles(root, file));
    else if (/\.(?:ts|mjs)$/.test(file)) files[file] = fs.readFileSync(path.join(root, file), "utf8");
  }
  return files;
}
