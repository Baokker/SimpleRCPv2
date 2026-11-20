import { execFileSync } from "node:child_process";
import path from "node:path";
import { decide } from "../../../apps/server/src/guard/decide.js";
import { roleLevel } from "../../../apps/server/src/guard/roles.js";
import { applyScriptInspection, inspectScripts, type ScriptSource } from "../../../apps/server/src/guard/scriptInspection.js";
import type { Action, GuardRequest, Level } from "../../../apps/server/src/guard/types.js";
import { assertFrozenServer, context, projectRoot, resultsRoot, runVersion, workspaceRoot, writeRun } from "../lib/common.js";

type Family = "attack" | "trojan" | "evasion" | "benign";
interface Sample {
  id: string;
  family: Family;
  carrier: string;
  executor: { level: string; viaAgent: boolean };
  writer: string;
  command: string;
  payload: string;
  files: Record<string, string>;
  malicious: boolean;
}

const archive = "archive/experiment-guard-x1-x6:experiments/guard/results/X8/x8-20261028084438/dataset.jsonl";
const data = execFileSync("git", ["show", archive], { cwd: projectRoot, encoding: "utf8" });
const samples = data.trim().split("\n").map((line) => JSON.parse(line) as Sample);
const counts = { attack: 252, trojan: 24, evasion: 32, benign: 112 };
if (samples.length !== 420 || Object.entries(counts).some(([family, count]) => samples.filter((sample) => sample.family === family).length !== count)) throw new Error("Unexpected archived X8 corpus");
assertFrozenServer();

const conditions = ["N", "M0", "M"] as const;
const rows: Array<{ id: string; family: Family; carrier: string; condition: typeof conditions[number]; level: Level; writer: Level; source: GuardRequest["source"]; malicious: boolean; expected: Action; actual: Action }> = [];
for (const sample of samples) {
  const files = new Map(Object.entries(sample.files).map(([file, content]) => {
    const absolute = path.resolve(workspaceRoot, file);
    if (path.isAbsolute(file) || !absolute.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error(`Unexpected fixture path in ${sample.id}`);
    return [absolute, content] as const;
  }));
  const writer = roleLevel(sample.writer);
  const level = roleLevel(sample.executor.level);
  const source = sample.executor.viaAgent ? "agent" : "terminal";
  const request: GuardRequest = { projectId: "x8", memberId: "executor", kind: "command", command: sample.command, cwd: workspaceRoot, source, agentRunId: source === "agent" ? sample.id : undefined };
  const settings = context(level);
  const base = decide(request, settings);
  for (const condition of conditions) {
    const scripts: ScriptSource = { read: (file) => files.get(file) };
    if (condition === "M") {
      scripts.writerLevel = (file) => files.has(file) ? writer : undefined;
      scripts.writerId = (file) => files.has(file) ? sample.family === "trojan" ? "writer" : request.memberId : undefined;
    }
    const decision = condition === "N" ? base : applyScriptInspection(base, inspectScripts(request, settings, scripts), level, source);
    rows.push({ id: sample.id, family: sample.family, carrier: sample.carrier, condition, level, writer, source,
      malicious: sample.malicious, expected: sample.malicious ? "ask" : "allow", actual: decision.action });
  }
}

const summary = Object.fromEntries(conditions.map((condition) => [condition, Object.fromEntries(Object.keys(counts).map((family) => {
  const group = rows.filter((row) => row.condition === condition && row.family === family);
  return [family, { count: group.length, intercepted: group.filter((row) => row.actual === "ask" || row.actual === "deny").length }];
}))]));
await writeRun(path.join(resultsRoot, "X8", `x8-script-inspection-compact-${runVersion}`), rows, {
  archive, counts, rowCount: rows.length, conditions: summary,
  attackPayloadCount: new Set(samples.filter((sample) => sample.family === "attack").map((sample) => sample.payload)).size,
  attackCarrierCount: new Set(samples.filter((sample) => sample.family === "attack").map((sample) => sample.carrier)).size,
  method: "Static replay of the fixed archived corpus. ScriptSource reads only fixture text in memory. No corpus command, script, or binary is executed. N disables inspection, M0 enables inspection, and M also supplies author provenance."
}, { experiment: "X8" });
