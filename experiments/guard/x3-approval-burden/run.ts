import fs from "node:fs/promises";
import path from "node:path";
import { actionMeetsExpected, ensureRuntimeDirectory, evaluate, loadDataset, makeRunId, projectRoot, type DatasetRecord, type RawRow, writeRun } from "../lib/common.js";
import type { Action } from "../../../apps/server/src/guard/types.js";

type LlmMode = "off" | "suggest" | "auto";

function replay(item: DatasetRecord, snapshot: boolean, llmMode: LlmMode, agentCeiling: boolean) {
  const source = item.actor.viaAgent && agentCeiling ? "agent" : "terminal";
  const decision = evaluate(item, item.actor.level, source);
  let action: Action = decision.action;
  if (!snapshot && action === "allow_snapshot") action = "ask";
  if (llmMode === "auto" && action === "ask" && decision.autoEligible) action = item.malicious ? "ask" : snapshot ? "allow_snapshot" : "allow";
  return { action, rules: decision.matchedRules, autoEligible: decision.autoEligible };
}

function summarize(rows: RawRow[]) {
  const groups = new Map<string, RawRow[]>();
  for (const row of rows) {
    const key = `${row.condition}|${row.family}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const grouped = [...groups].map(([key, group]) => ({ key, sampleSize: group.length, approvalsPer100: group.filter((row) => row.actual === "ask").length / group.length * 100, automatic: group.filter((row) => row.actual === "allow" || row.actual === "allow_snapshot").length / group.length, harmfulAutoApproval: group.filter((row) => row.malicious && (row.actual === "allow" || row.actual === "allow_snapshot")).length }));
  return { rowCount: rows.length, grouped, expectedMismatchCount: rows.filter((row) => !actionMeetsExpected(row.actual, row.expected)).length, maliciousAutoApproval: rows.filter((row) => row.malicious && (row.actual === "allow" || row.actual === "allow_snapshot")).length };
}

async function main() {
  await ensureRuntimeDirectory();
  const [d2, d4] = await Promise.all([loadDataset("D2"), loadDataset("D4")]);
  const rows: RawRow[] = [];
  for (const snapshot of [true, false]) {
    for (const llmMode of ["off", "suggest", "auto"] as const) {
      for (const agentCeiling of [true, false]) {
        const condition = `snapshot-${snapshot ? "on" : "off"}|llm-${llmMode}|agent-ceiling-${agentCeiling ? "on" : "off"}`;
        for (const [dataset, items] of [["D2", d2], ["D4", d4]] as const) {
          for (const item of items) {
            const started = process.hrtime.bigint();
            const result = replay(item, snapshot, llmMode, agentCeiling);
            const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
            rows.push({ id: `${condition}-${item.id}`, condition, dataset, family: item.family, scenario: item.scenario, level: item.actor.level, source: item.actor.viaAgent && agentCeiling ? "agent" : "terminal", input: item.input, expected: item.expected, actual: result.action, malicious: item.malicious, matchedRules: result.rules, legacyRisk: "deterministic-fake-judge", autoEligible: result.autoEligible, durationMs });
          }
        }
      }
    }
  }
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X3", makeRunId("x3"));
  const summary = summarize(rows);
  await writeRun(runDirectory, rows, summary, { experiment: "X3", judge: "deterministic fake judge", workloads: ["D2", "D4"] });
  await fs.writeFile(path.join(runDirectory, "summary.md"), `# X3 审批负担与消融\n\n样本数：${rows.length}。每百条审批次数与自动放行比例在 summary.json 的 grouped 字段中。恶意自动放行：${summary.maliciousAutoApproval}。\n`);
  process.stdout.write(`${runDirectory}\n`);
}

await main();
