import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { readTrace, wilson, latencySummary, mcnemar, holm, bootstrapGroups } from "../dist/index.js";

const { values } = parseArgs({ options: { input: { type: "string", multiple: true }, out: { type: "string" }, tasks: { type: "string" }, plan: { type: "boolean", default: false } } });
if (!values.input?.length || !values.out) throw new Error("指定 input 与 out");
if (values.plan) { console.log(JSON.stringify({ sources: values.input, tasks: values.tasks, executed: false, modelCalls: 0 })); process.exit(0); }
const taskIds = values.tasks?.split(",");
const conditions: Record<string, any[]> = {};
const seen = new Set<string>();
for (const directory of values.input.map((value) => path.resolve(value))) {
  for (const name of (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort()) {
    const file = path.join(directory, name);
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    if (!record.taskId || !Array.isArray(record.traces) || taskIds && !taskIds.includes(record.taskId)) continue;
    const condition = `${record.policy ?? "P5"}/${record.injection}/${record.arbitrationMode ?? "owner"}`;
    const identity = `${condition}/${record.taskId}/${record.round}`;
    if (seen.has(identity)) throw new Error(`重复任务记录 ${identity}`);
    seen.add(identity);
    const projectTrace = readTrace(await fs.readFile(file.replace(/\.json$/, ".jsonl"), "utf8"));
    const initial = record.traces.filter((item: any) => !record.initialRunIds || record.initialRunIds.includes(item.run.id));
    const rejected = initial.filter((item: any) => item.events.some((event: any) => event.type === "t2_judged" && event.data.decision === "lock"));
    const corrected = rejected.filter((item: any) => {
      const denial = item.events.findIndex((event: any) => event.type === "t2_judged" && event.data.decision === "lock");
      return record.acceptance.exitCode === 0 && item.run.status === "completed" && !item.events.some((event: any) => event.type === "arbitration_continuation") && !projectTrace.some((event) => event.type === "arbitration_continuation" && (event.actor as any)?.runId === item.run.id) && item.events.slice(denial + 1).some((event: any) => event.type === "t2_judged" && event.data.decision === "allow");
    });
    const waits = record.traces.flatMap((item: any) => item.events.filter((event: any) => event.type === "permission_reply" && Number.isFinite(event.data.approvalWaitMs)).map((event: any) => event.data.approvalWaitMs));
    const reverts = projectTrace.filter((event) => event.type === "edit" && (event.origin as any)?.kind === "guard-revert");
    const row = {
      id: `${record.taskId}/${record.round}`, relationGroupId: record.taskId, source: file,
      success: record.acceptance.exitCode === 0, runs: record.traces.length, rejectedRuns: rejected.length, correctedRuns: corrected.length,
      interruptions: (record.arbitration?.members ?? []).reduce((sum: number, member: any) => sum + member.interruptions, 0),
      light: (record.arbitration?.members ?? []).reduce((sum: number, member: any) => sum + member.light, 0),
      suspendedMs: record.arbitration?.suspendedMs ?? 0, waits,
      reverts: { blocks: reverts.reduce((sum, event) => sum + (event.ops as any[]).length, 0), characters: reverts.reduce((sum, event) => sum + (event.ops as any[]).reduce((count, op) => count + op.inserted.length + op.deleted.length, 0), 0), files: [...new Set(reverts.map((event) => String(event.file)))].sort() },
      costUsd: (record.agentCostUsd ?? 0) + (record.guardCostUsd ?? 0), unknownUsageRuns: record.unknownUsageRuns ?? [],
      escape: null, escapeReason: "D3 只有任务完成验收，尚无逐次持久写入的冲突真值探针，逃逸率为 N/A。"
    };
    (conditions[condition] ??= []).push(row);
  }
}
if (!seen.size) throw new Error("没有可统计的真实任务记录");
for (const rows of Object.values(conditions)) rows.sort((a, b) => a.id.localeCompare(b.id));
const observations = (rows: any[]) => rows.map((row) => ({ id: row.id, relationGroupId: row.relationGroupId, correct: row.success, value: Number(row.success) }));
const paired = (rows: any[]) => [...new Set(rows.map((row) => row.relationGroupId))].map((id) => ({ id, relationGroupId: id, correct: rows.filter((row) => row.relationGroupId === id).every((row) => row.success), value: 0 }));
const ids = Object.keys(conditions).sort();
const comparisons = ids.flatMap((left, index) => ids.slice(index + 1).map((right) => {
  if (JSON.stringify(conditions[left]!.map((row) => row.id)) !== JSON.stringify(conditions[right]!.map((row) => row.id))) throw new Error("条件之间的任务与重复次数不一致");
  return { id: `${left}:${right}`, left, right, ...mcnemar(paired(conditions[left]!), paired(conditions[right]!)) };
}));
const adjusted = new Map(holm(comparisons).map((row) => [row.id, row.adjustedP]));
const metrics = Object.fromEntries(Object.entries(conditions).map(([condition, rows]) => {
  const rejected = rows.reduce((sum, row) => sum + row.rejectedRuns, 0);
  return [condition, {
    taskPairs: rows.length, taskSuccess: wilson(rows.filter((row) => row.success).length, rows.length),
    taskSuccessBootstrap: bootstrapGroups(observations(rows), (values) => values.reduce((sum, value) => sum + value, 0) / values.length, 20261007),
    rejectedRuns: rejected, correctedRuns: rows.reduce((sum, row) => sum + row.correctedRuns, 0),
    selfCorrection: rejected ? wilson(rows.reduce((sum, row) => sum + row.correctedRuns, 0), rejected) : null,
    interruptions: rows.reduce((sum, row) => sum + row.interruptions, 0), light: rows.reduce((sum, row) => sum + row.light, 0),
    suspendedMs: rows.reduce((sum, row) => sum + row.suspendedMs, 0), approvalWaitMs: latencySummary(rows.flatMap((row) => row.waits)),
    revertedBlocks: rows.reduce((sum, row) => sum + row.reverts.blocks, 0), revertedCharacters: rows.reduce((sum, row) => sum + row.reverts.characters, 0),
    costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0), escape: null
  }];
}));
const statistics = { unit: "taskId", bootstrapRepetitions: 2000, bootstrapSeed: 20261007, mcnemar: "exact-two-sided", multiplicity: "Holm-all-condition-pairs-within-experiment", comparisons: comparisons.map((row) => ({ ...row, adjustedP: adjusted.get(row.id) })) };
const output = path.resolve(values.out);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ conditions, metrics, statistics, modelCalls: 0 }, null, 2) + "\n");
await fs.writeFile(path.join(output, "summary.md"), ["# Agent 真实任务统计", "", "任务对为统计单位，重复运行保留在对应任务对中。bootstrap 2000 次、种子 20261007；同一条件全部重复都通过时记为该任务成功，条件之间使用关系组 McNemar 与实验内 Holm。逃逸率为 N/A：D3 任务验收不提供中间写入冲突真值。", "", "| 条件 | 任务对 | 成功率 | 被拒 run | 自行修正 run | 打扰 | 轻提示 | 审批等待 p50/p95 ms | 撤回块数 |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|", ...Object.entries(metrics).map(([id, row]) => `| ${id} | ${row.taskPairs} | ${(100 * row.taskSuccess.value).toFixed(2)}% | ${row.rejectedRuns} | ${row.correctedRuns} | ${row.interruptions} | ${row.light} | ${row.approvalWaitMs.samples ? `${row.approvalWaitMs.p50}/${row.approvalWaitMs.p95}` : "N/A"} | ${row.revertedBlocks} |`), ""].join("\n"));
await fs.writeFile(path.join(output, "command.txt"), `pnpm --filter @simplercp/conflict-guard agents:summary ${process.argv.slice(2).join(" ")}\n`);
await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ sources: values.input, taskIds, statistics }, null, 2) + "\n");
console.log(JSON.stringify({ conditions: ids, taskRecords: seen.size, modelCalls: 0 }));
