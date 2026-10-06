import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { repositoryRoot } from "./model-runtime.ts";

const reportDirectory = path.join(repositoryRoot, "docs/conflict-guard/evidence/stage-5-dev-report");
const report = JSON.parse(gunzipSync(await fs.readFile(path.join(reportDirectory, "results.json.gz"))).toString());
const lines = ["# 按算子族与 T03 门槛评价", "", "| 策略 | 算子族 | 样本 | 一致率 | 漏阻断率 | 误阻断率 |", "|---|---|---:|---:|---:|---:|"];
const percentage = (number: number, denominator?: number) => denominator === 0 ? "N/A" : `${(number * 100).toFixed(1)}%`;
for (const [policy, row] of Object.entries(report.policies) as Array<[string, any]>) {
  for (const [family, metrics] of Object.entries(row.metrics.byOperatorFamily) as Array<[string, any]>) lines.push(`| ${policy} | ${family} | ${metrics.groups} | ${percentage(metrics.agreement.value, metrics.denominators.agreement)} | ${percentage(metrics.missBlockRatio.value, metrics.denominators.missBlockRatio)} | ${percentage(metrics.falseBlockRatio.value, metrics.denominators.falseBlockRatio)} |`);
}
lines.push("", "| 策略 | 完成率 ≥95% | 漏阻断 ≤10% | 误阻断 ≤15% | 一致率 ≥80% | p50 ≤3000 ms | p95 ≤8000 ms |", "|---|---|---|---|---|---|---|");
for (const [policy, row] of Object.entries(report.policies) as Array<[string, any]>) if (row.t03) lines.push(`| ${policy} | ${[row.t03.completion, row.t03.missed, row.t03.falseBlocking, row.t03.agreement, row.t03.median, row.t03.p95].map((passed) => passed ? "通过" : "未达到").join(" | ")} |`);
await fs.writeFile(path.join(reportDirectory, "families-and-t03.md"), lines.join("\n") + "\n");

const dataset = path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/stage5-dev-smoke");
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8"));
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8"));
const excluded = JSON.parse(await fs.readFile(path.join(dataset, "excluded.json"), "utf8"));
const traces: Record<string, string> = {};
for (const name of (await fs.readdir(path.join(dataset, "traces"))).sort()) traces[name] = await fs.readFile(path.join(dataset, "traces", name), "utf8");
const archive = gzipSync(JSON.stringify({ manifest, labels, excluded, traces }) + "\n", { mtime: 0 });
await fs.writeFile(path.join(dataset, "dataset.json.gz"), archive);

const models = new Set<string>(); let deepResponses = 0; let reasoningResponses = 0;
async function inspectCache(directory: string) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspectCache(file);
    else if (entry.name.endsWith(".json")) {
      const cached = JSON.parse(await fs.readFile(file, "utf8"));
      if (cached.call?.model) models.add(cached.call.model);
      if (cached.call?.adapter === "deepseek" && cached.result) {
        deepResponses += 1;
        if (cached.result.raw?.choices?.some((choice: any) => Boolean(choice.message?.reasoning_content))) reasoningResponses += 1;
      }
    }
  }
}
await inspectCache(path.join(repositoryRoot, "packages/conflict-guard/bench/model-cache"));
const budget = JSON.parse(await fs.readFile(path.join(repositoryRoot, ".test-workspaces/stage5-call-budget.json"), "utf8"));
const metadata = { dataset: { version: manifest.version, groups: manifest.groups.length, labelledVariants: labels.filter((label: any) => label.label !== "exclude" && !label.aliasOf).length, excluded: excluded.length, projects: manifest.developmentOrigin.projects, holdoutProjectsUsed: 0, heldoutOperatorFamiliesUsed: 0, archiveSha256: createHash("sha256").update(archive).digest("hex") }, cliCalls: budget, limits: { fast: 2000, deep: 800 }, models: [...models].sort(), thinkingDisabledCheck: { deepResponses, nonemptyReasoningResponses: reasoningResponses }, split: "dev" };
await fs.writeFile(path.join(reportDirectory, "provenance.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify(metadata));
