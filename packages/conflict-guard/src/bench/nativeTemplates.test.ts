import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readSeedProjects } from "../../scripts/seed-projects.ts";
import { generateManifest } from "./generator.js";
import { inspectSeedDiversity } from "./diversity.js";
import { nativeOperatorIds, nativeOperatorTemplate } from "./nativeTemplates.js";
import { OPERATOR_SPECS } from "./operators.js";
import { createSemanticIndex } from "../semantic/index.js";
import { executeProbe } from "./executor.js";
import type { BenchVariant } from "./types.js";

const projects = await readSeedProjects(fileURLToPath(new URL("../../bench/seeds/native/", import.meta.url)));

it("rejects a copied business file even when project and size requirements pass", () => {
  const cloned = projects.map((project) => ({ ...project, files: { ...project.files } }));
  const source = Object.entries(cloned[0]!.files).find(([file]) => file.endsWith(".ts"))!;
  cloned[1]!.files["src/copied.ts"] = source[1];
  const diversity = inspectSeedDiversity(cloned);
  expect(diversity.sizes.every((size) => size.files >= 5 && size.lines >= 300)).toBe(true);
  expect(diversity).toMatchObject({ valid: false, maximumObserved: 1 });
  expect(() => generateManifest({ projects: cloned, groups: 8, seed: 7 })).toThrow("结构独立性检查");
}, 60000);

it("requires eight independent projects and keeps development sites separate", () => {
  const diversity = inspectSeedDiversity(projects);
  expect(diversity).toMatchObject({ valid: true, projectCount: 8, violations: [] });
  const first = generateManifest({ projects, groups: 24, seed: 20261008 });
  const second = generateManifest({ projects, groups: 24, seed: 20261008 });
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first.siteStats!.overlap).toEqual([]);
  expect(new Set(first.groups.filter((group) => group.split === "dev").map((group) => group.project)).size).toBeGreaterThanOrEqual(3);
  expect(first.programStats!.developmentHoldoutOverlap).toBe(0);
  for (const group of first.groups) expect(group.variants.safe.baseline).toEqual(projects.find((project) => project.name === group.project)!.files);
}, 60000);

it("selects semantic sites and unrelated functions without changing cached selections", () => {
  for (const project of projects) {
    const supported = nativeOperatorIds(project, OPERATOR_SPECS.map((operator) => operator.id));
    expect(supported).toContain("SF-5");
    const before = nativeOperatorTemplate("IC-3", false, 5, project, false);
    const independent = nativeOperatorTemplate("IC-3", false, 5, project, true);
    const after = nativeOperatorTemplate("IC-3", false, 5, project, false);
    expect(after).toEqual(before);
    const index = createSemanticIndex({ files: { listFiles: () => Object.keys(project.files), readFile: (file) => project.files[file]!, version: () => 0 }, now: () => 0 });
    index.update();
    expect(index.findPaths([independent.site.producerKey], [independent.site.consumerKey], 2)).toEqual([]);
    expect(index.findPaths([before.site.producerKey], [before.site.consumerKey], 2).length).toBeGreaterThan(0);
  }
});

it("executes every native seed's baseline in a real probe subprocess", async () => {
  await Promise.all(projects.map(async (project) => {
    const template = nativeOperatorTemplate("SF-2", true, 3, project, false);
    const variant: BenchVariant = { id: `${project.name}-baseline`, kind: "safe", truth: "allow", detectability: "none", baseline: template.baseline, leftOnly: { ...template.baseline, ...template.left }, rightOnly: { ...template.baseline, ...template.right }, merged: template.merged, baselineReference: template.reference, probes: template.probes, entryPoints: template.entryPoints, trace: [] };
    expect(await executeProbe(variant, "baseline")).toMatchObject({ passed: true, typeError: false, regression: { passed: true, tests: 1 } });
  }));
}, 90000);
