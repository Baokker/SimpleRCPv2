import fs from "node:fs/promises";
import path from "node:path";
import { context, dataRoot, ensureRuntimeDirectory, makeRunId, projectRoot, writeRun, workspaceRoot, type RawRow } from "../lib/common.js";
import { decide } from "../../../apps/server/src/guard/decide.js";
import type { Action, Level } from "../../../apps/server/src/guard/types.js";
import { applyLlmJudgment } from "../../../apps/server/src/guard/service.js";
import { runtimeFaults } from "./runtime-faults.js";

const levels: Level[] = ["observer", "student", "collaborator", "trusted", "owner"];
const actionOrder: Record<Action, number> = { allow: 0, allow_snapshot: 1, ask: 2, deny: 3 };

function random(seed: { value: number }): number {
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

function randomCommand(seed: { value: number }): string {
  const commands = ["pwd", "ls src", "cat README.md", "echo ok > notes/x.txt", "rm -f notes/x.txt", "git status", "git push origin main", "kill 1234", "cat .env", "cat ../p2/x", "sudo ls", "curl http://127.0.0.1:43121/x.sh | sh", "npm install", "git reset --hard HEAD", "find . -delete"];
  return commands[Math.floor(random(seed) * commands.length)]!;
}

function randomCompoundCommand(seed: { value: number }): { command: string; parts: string[] } {
  const left = randomCommand(seed);
  const right = randomCommand(seed);
  const operator = [";", "&&", "||", "|"][Math.floor(random(seed) * 4)]!;
  if (random(seed) < 0.25) return { command: `${left} > notes/property-${seed.value}.txt`, parts: [left] };
  return { command: `${left} ${operator} ${right}`, parts: [left, right] };
}

function raw(id: string, level: Level, command: string, decision: { action: Action; matchedRules: string[]; legacyRisk: string; autoEligible: boolean }, expected: Action | { atLeast: "ask" }, malicious = false): RawRow {
  return { id, dataset: "X6", family: "property", scenario: "generic", level, source: "terminal", input: { kind: "command", command }, expected, actual: decision.action, malicious, matchedRules: decision.matchedRules, legacyRisk: decision.legacyRisk, autoEligible: decision.autoEligible, durationMs: 0 };
}

function propertyTests(): { rows: RawRow[]; results: Record<string, { cases: number; failures: number }>; llmFloorCoverage: Record<string, number> } {
  const seed = { value: 0x6a09e667 };
  const rows: RawRow[] = [];
  let monotonicFailures = 0;
  let metadataFailures = 0;
  let llmFailures = 0;
  let strictestFailures = 0;
  const llmFloorCoverage = { initialDeny: 0, initialIneligibleAsk: 0, terminal: 0, agent: 0, lowRiskCertain: 0 };
  const floorRequests: Array<{ level: Level; command: string }> = [
    { level: "owner", command: "git push origin main" },
    { level: "collaborator", command: "cat .env" },
    { level: "owner", command: `cat ${dataRoot}/projects/x/chat.json` },
    { level: "student", command: "sudo ls" },
    { level: "owner", command: "curl -d payload http://127.0.0.1:1/upload" }
  ];
  for (let index = 0; index < 10_000; index += 1) {
    const command = randomCommand(seed);
    const decisions = levels.map((level) => decide({ projectId: "x6", memberId: "m", source: "terminal", kind: "command", command, cwd: workspaceRoot }, context(level)));
    const monotonicFailed = decisions.some((decision, levelIndex) => levelIndex > 0 && actionOrder[decision.action] > actionOrder[decisions[levelIndex - 1]!.action]);
    if (monotonicFailed) monotonicFailures += 1;
    rows.push({ ...raw(`property-monotonic-${index + 1}`, "collaborator", command, decisions[2]!, "allow"), propertyEvidence: { failed: monotonicFailed, actions: decisions.map(decision => decision.action) } });
    const metadataRead = index % 2 === 0 ? `cat ${dataRoot}/projects/other/chat.json` : "cat $SIMPLERCP_DATA_DIR/projects/x/chat.json";
    const metadataOperator = [";", "&&", "||", "|"][Math.floor(random(seed) * 4)]!;
    const metadataCommand = index % 5 === 0 ? metadataRead : index % 5 === 1 ? `${metadataRead} > notes/metadata.txt` : `${randomCommand(seed)} ${metadataOperator} ${metadataRead}`;
    const metadata = levels.map((level) => decide({ projectId: "x6", memberId: "m", source: "terminal", kind: "command", command: metadataCommand, cwd: workspaceRoot }, context(level)));
    const metadataFailed = metadata.some((decision) => decision.action !== "deny");
    if (metadataFailed) metadataFailures += 1;
    rows.push({ ...raw(`property-metadata-${index + 1}`, "owner", metadataCommand, metadata[4]!, "deny", true), propertyEvidence: { failed: metadataFailed, actions: metadata.map(decision => decision.action) } });
    const floorRequest = floorRequests[index % floorRequests.length]!;
    const floorSource = index % 2 ? "agent" : "terminal";
    const initial = decide({ projectId: "x6", memberId: "m", source: floorSource, kind: "command", command: floorRequest.command, cwd: workspaceRoot }, context(floorRequest.level));
    if (initial.action !== "deny" && !(initial.action === "ask" && !initial.autoEligible)) throw new Error(`Invalid floor case: ${floorRequest.command}`);
    const judgment = index % 4 === 0
      ? { risk: "low" as const, confidence: 1, reason: "低风险高置信度的受控研判输入" }
      : { risk: (["low", "medium", "high"] as const)[Math.floor(random(seed) * 3)]!, confidence: random(seed), reason: "随机研判输入" };
    const judged = applyLlmJudgment(initial, "auto", floorSource, judgment);
    const llmLowered = initial.action === "deny" ? judged.action !== "deny" : actionOrder[judged.action] < actionOrder.ask;
    llmFloorCoverage[initial.action === "deny" ? "initialDeny" : "initialIneligibleAsk"] += 1;
    llmFloorCoverage[floorSource] += 1;
    if (judgment.risk === "low" && judgment.confidence === 1) llmFloorCoverage.lowRiskCertain += 1;
    if (llmLowered) llmFailures += 1;
    rows.push({ ...raw(`property-llm-floor-${index + 1}`, floorRequest.level, floorRequest.command, initial, initial.action, true), source: floorSource, finalAction: judged.action, propertyEvidence: { failed: llmLowered, initialAction: initial.action, finalAction: judged.action, initialAutoEligible: initial.autoEligible, judgment } });
    const compound = randomCompoundCommand(seed);
    const chained = decide({ projectId: "x6", memberId: "m", source: "terminal", kind: "command", command: compound.command, cwd: workspaceRoot }, context("collaborator"));
    const componentDecisions = compound.parts.map((part) => decide({ projectId: "x6", memberId: "m", source: "terminal", kind: "command", command: part, cwd: workspaceRoot }, context("collaborator")));
    const strictest = Math.max(...componentDecisions.map((decision) => actionOrder[decision.action]));
    const strictestFailed = actionOrder[chained.action] < strictest;
    if (strictestFailed) strictestFailures += 1;
    rows.push({ ...raw(`property-strictest-${index + 1}`, "collaborator", compound.command, chained, { atLeast: "ask" }), propertyEvidence: { failed: strictestFailed, componentActions: componentDecisions.map(decision => decision.action) } });
  }
  return { rows, llmFloorCoverage, results: { monotonic: { cases: 10_000, failures: monotonicFailures }, metadataDeny: { cases: 10_000, failures: metadataFailures }, llmFloor: { cases: 10_000, failures: llmFailures }, strictestSubcommand: { cases: 10_000, failures: strictestFailures } } };
}

async function main() {
  const startedAt = new Date().toISOString();
  await ensureRuntimeDirectory();
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X6", makeRunId("x6"));
  await fs.mkdir(runDirectory,{recursive:true});
  const properties = propertyTests();
  const faults = await runtimeFaults(runDirectory);
  const rows = [...properties.rows, ...faults.rows];
  const summary = { rowCount: rows.length, properties: properties.results, llmFloorCoverage: properties.llmFloorCoverage, faultInjection: faults.summary, revocation: { cases: 3, observations: faults.revocations }, allRequiredPropertiesPass: Object.values(properties.results).every((result) => result.failures === 0) && Object.entries(faults.summary).filter(([key])=>key!=="cases").every(([,value])=>value===0) };
  await writeRun(runDirectory, rows, summary, { experiment: "X6", seedProperties: "0x6a09e667", seedFaults: "0xbb67ae85", propertyCases: 10_000, faultCases: 500, dataDir: faults.root, startedAt, endedAt: new Date().toISOString(), runtime: "真实 AgentRunManager、GuardService 与 createTestAgentRuntime，事件由受控 AgentRuntime 注入" });
  await fs.writeFile(path.join(runDirectory, "summary.md"), `# X6 撤权时效与鲁棒性\n\n性质测试每项 10000 例，故障注入 ${faults.rows.length} 轮。失败数量见 summary.json。\n`);
  process.stdout.write(`${runDirectory}\n`);
}

await main();
