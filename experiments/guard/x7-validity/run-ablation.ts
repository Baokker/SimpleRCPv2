// X7a: recompute X1 with intent-only denominators and ablate the three risk
// dimensions. Uses the frozen v2 datasets D1-D4 and the F condition of X1.
import fs from "node:fs/promises";
import path from "node:path";
import { decide } from "../../../apps/server/src/guard/decide.js";
import type { Action } from "../../../apps/server/src/guard/types.js";
import { context, ensureRuntimeDirectory, loadDataset, makeRunId, projectRoot, toRequest, type DatasetRecord } from "../lib/common.js";
import { decideVariant, VARIANTS } from "./decideVariant.js";

const intercepted = (action: Action) => action === "ask" || action === "deny";
const pct = (n: number, d: number) => d === 0 ? "n/a" : `${n}/${d} (${(100 * n / d).toFixed(1)}%)`;

interface Row { id: string; variant: string; dataset: string; malicious: boolean; expected: DatasetRecord["expected"]; actual: Action; source: string; level: string; notes?: string }

async function main() {
  await ensureRuntimeDirectory();
  const datasets = await Promise.all(["D1", "D2", "D3", "D4"].map(async (name) => [name, await loadDataset(name)] as const));
  const all = datasets.flatMap(([name, items]) => items.map((item) => ({ name, item })));

  // Sanity: the unablated copy must reproduce the product decision on every record of D1-D6.
  const sanity = [...all.map(({ item }) => item), ...await loadDataset("D5"), ...await loadDataset("D6")];
  const mismatches = sanity.filter((item) => {
    const source = item.actor.viaAgent ? "agent" : "terminal";
    const request = toRequest(item, source), ctx = context(item.actor.level);
    return decide(request, ctx).action !== decideVariant(request, ctx, {}).action;
  }).map((item) => item.id);
  if (mismatches.length > 0) throw new Error(`decideVariant diverges from decide on ${mismatches.length} records: ${mismatches.slice(0, 5).join(", ")}`);

  const rows: Row[] = [];
  for (const [variant, options] of Object.entries(VARIANTS)) {
    if (variant === "F+P") continue; // needs session history, evaluated in run-script-family.ts
    for (const { name, item } of all) {
      const source = item.actor.viaAgent ? "agent" : "terminal";
      const decision = decideVariant(toRequest(item, source), context(item.actor.level), options);
      rows.push({ id: item.id, variant, dataset: name, malicious: item.malicious, expected: item.expected, actual: decision.action, source, level: item.actor.level, notes: item.notes });
    }
  }

  const summary = Object.keys(VARIANTS).filter((variant) => variant !== "F+P").map((variant) => {
    const group = rows.filter((row) => row.variant === variant);
    const malicious = group.filter((row) => row.malicious);
    const ruleEligible = malicious.filter((row) => row.expected === "ask" || row.expected === "deny" || typeof row.expected === "object");
    const benignAuto = group.filter((row) => !row.malicious && (row.expected === "allow" || row.expected === "allow_snapshot"));
    const benign = group.filter((row) => !row.malicious);
    return {
      variant,
      // Paper metric: denominator filtered by the rule-derived expected action.
      ruleEligibleIntercepted: ruleEligible.filter((row) => intercepted(row.actual)).length,
      ruleEligible: ruleEligible.length,
      // Intent-only metric: every malicious record counts, whatever the rules expect.
      malicious: malicious.length,
      maliciousIntercepted: malicious.filter((row) => intercepted(row.actual)).length,
      maliciousSnapshot: malicious.filter((row) => row.actual === "allow_snapshot").length,
      maliciousAllowed: malicious.filter((row) => row.actual === "allow").length,
      maliciousAllowedIds: malicious.filter((row) => row.actual === "allow").map((row) => row.id),
      benignAutoFalseIntercepted: benignAuto.filter((row) => intercepted(row.actual)).length,
      benignAuto: benignAuto.length,
      benign: benign.length,
      benignIntercepted: benign.filter((row) => intercepted(row.actual)).length
    };
  });

  const runDirectory = path.join(projectRoot, "experiments/guard/results/X7", makeRunId("x7a"));
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "raw.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await fs.writeFile(path.join(runDirectory, "summary.json"), JSON.stringify({ sanityRecords: sanity.length, sanityMismatches: 0, summary }, null, 2));
  const lines = [
    "# X7a 意图口径重算与三维消融", "",
    `判定副本与产品 decide() 在 D1-D6 的 ${sanity.length} 条记录上逐条一致。`, "",
    "| 条件 | 规则口径拦截 | 全部恶意请求：拦截 | 快照放行 | 直接放行 | 规则口径误拦 | 全部非恶意请求被要求审批或拒绝 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...summary.map((s) => `| ${s.variant} | ${pct(s.ruleEligibleIntercepted, s.ruleEligible)} | ${pct(s.maliciousIntercepted, s.malicious)} | ${s.maliciousSnapshot} | ${s.maliciousAllowed} | ${pct(s.benignAutoFalseIntercepted, s.benignAuto)} | ${pct(s.benignIntercepted, s.benign)} |`),
    "", "F 条件直接放行的恶意记录：" + (summary.find((s) => s.variant === "F")?.maliciousAllowedIds.join("、") ?? "")
  ];
  await fs.writeFile(path.join(runDirectory, "summary.md"), lines.join("\n") + "\n");
  process.stdout.write(lines.join("\n") + `\n\n${runDirectory}\n`);
}

await main();
