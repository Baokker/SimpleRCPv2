import fs from "node:fs/promises";
import path from "node:path";
import { context, dataRoot, ensureRuntimeDirectory, resultsRoot, writeRun, workspaceRoot, type RawRow } from "../lib/common.js";
import { decide } from "../../../apps/server/src/guard/decide.js";
import type { Action, Level } from "../../../apps/server/src/guard/types.js";
import { applyLlmJudgment } from "../../../apps/server/src/guard/service.js";
import { LEVELS as levels } from "../../../apps/server/src/guard/roles.js";

const actionOrder: Record<Action, number> = { allow: 0, allow_snapshot: 1, ask: 2, deny: 3 };

function random(seed: { value: number }): number {
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

function randomCommand(seed: { value: number }): string {
  const commands = ["pwd", "ls src", "cat README.md", "echo ok > notes/x.txt", "rm -f notes/x.txt", "git status", "git push origin main", "kill 1234", "cat .env", "cat ../p2/x", "sudo ls", "npm install", "git reset --hard HEAD", "find . -delete", "cd examples"];
  return commands[Math.floor(random(seed) * commands.length)]!;
}

function randomCompoundCommand(seed: { value: number }, operators = [";", "&&", "||", "|", "\n"]): { command: string; parts: string[] } {
  const left = randomCommand(seed);
  const right = randomCommand(seed);
  const operator = operators[Math.floor(random(seed) * operators.length)]!;
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
    { level: "maintainer", command: "cat .env" },
    { level: "owner", command: `cat ${dataRoot}/projects/x/chat.json` },
    { level: "contributor", command: "sudo ls" },
    { level: "owner", command: "curl -d payload http://127.0.0.1:1/upload" }
  ];
  for (let index = 0; index < 10_000; index += 1) {
    const { command } = randomCompoundCommand(seed);
    const source = Math.floor(index / levels.length) % 2 ? "agent" : "terminal";
    const request = { projectId: "x6", memberId: "m", source, agentRunId: source === "agent" ? "x6" : undefined, kind: "command" as const, cwd: workspaceRoot } as const;
    const decisions = levels.map((level) => decide({ ...request, command }, context(level)));
    const monotonicFailed = decisions.some((decision, levelIndex) => levelIndex > 0 && actionOrder[decision.action] > actionOrder[decisions[levelIndex - 1]!.action]);
    if (monotonicFailed) monotonicFailures += 1;
    rows.push({ ...raw(`property-monotonic-${index + 1}`, "maintainer", command, decisions[2]!, decisions[1]!.action), source, propertyEvidence: { failed: monotonicFailed, actions: decisions.map(decision => decision.action) } });
    const metadataRead = index % 2 === 0 ? `cat ${dataRoot}/projects/other/chat.json` : "cat $SIMPLERCP_DATA_DIR/projects/x/chat.json";
    const metadataOperator = [";", "&&", "||", "|"][Math.floor(random(seed) * 4)]!;
    const metadataCommand = index % 5 === 0 ? metadataRead : index % 5 === 1 ? `${metadataRead} > notes/metadata.txt` : `${randomCommand(seed)} ${metadataOperator} ${metadataRead}`;
    const metadata = levels.map((level) => decide({ ...request, command: metadataCommand }, context(level)));
    const metadataFailed = metadata.some((decision) => decision.action !== "deny");
    if (metadataFailed) metadataFailures += 1;
    rows.push({ ...raw(`property-metadata-${index + 1}`, "owner", metadataCommand, metadata.at(-1)!, "deny", true), source, propertyEvidence: { failed: metadataFailed, actions: metadata.map(decision => decision.action) } });
    const floorRequest = floorRequests[index % floorRequests.length]!;
    const floorCommand = index % 2 ? `pwd && ${floorRequest.command}` : `${floorRequest.command} ; ${randomCommand(seed)}`;
    const initial = decide({ ...request, command: floorCommand }, context(floorRequest.level));
    const judgment = index % 4 === 0
      ? { risk: "low" as const, confidence: 1, reason: "低风险高置信度的受控研判输入" }
      : { risk: (["low", "medium", "high"] as const)[Math.floor(random(seed) * 3)]!, confidence: random(seed), reason: "随机研判输入" };
    const judged = applyLlmJudgment(initial, "auto", source, judgment);
    const llmLowered = (initial.action !== "ask" || !initial.autoEligible) && judged.action !== initial.action;
    if (initial.action === "deny") llmFloorCoverage.initialDeny += 1;
    if (initial.action === "ask" && !initial.autoEligible) llmFloorCoverage.initialIneligibleAsk += 1;
    llmFloorCoverage[source] += 1;
    if (judgment.risk === "low" && judgment.confidence === 1) llmFloorCoverage.lowRiskCertain += 1;
    if (llmLowered) llmFailures += 1;
    rows.push({ ...raw(`property-llm-floor-${index + 1}`, floorRequest.level, floorCommand, initial, initial.action, true), source, finalAction: judged.action, propertyEvidence: { failed: llmLowered, initialAction: initial.action, finalAction: judged.action, initialAutoEligible: initial.autoEligible, judgment } });
    const compound = randomCompoundCommand(seed);
    const level = levels[index % levels.length]!;
    const chained = decide({ ...request, command: compound.command }, context(level));
    const componentDecisions = compound.parts.map((part) => decide({ ...request, command: part }, context(level)));
    const strictest = Math.max(...componentDecisions.map((decision) => actionOrder[decision.action]));
    const strictestFailed = actionOrder[chained.action] < strictest;
    if (strictestFailed) strictestFailures += 1;
    const strictestAction = componentDecisions.reduce((strictest, decision) => actionOrder[decision.action] > actionOrder[strictest] ? decision.action : strictest, "allow" as Action);
    rows.push({ ...raw(`property-strictest-${index + 1}`, level, compound.command, chained, strictestAction), source, propertyEvidence: { failed: strictestFailed, parts: compound.parts, componentActions: componentDecisions.map(decision => decision.action) } });
  }
  return { rows, llmFloorCoverage, results: { monotonic: { cases: 10_000, failures: monotonicFailures }, metadataDeny: { cases: 10_000, failures: metadataFailures }, llmFloor: { cases: 10_000, failures: llmFailures }, strictestSubcommand: { cases: 10_000, failures: strictestFailures } } };
}

async function main() {
  const startedAt = new Date().toISOString();
  await ensureRuntimeDirectory();
  const runDirectory = path.join(resultsRoot, "X6", "x6-properties-compact-v1");
  await fs.mkdir(runDirectory,{recursive:true});
  const properties = propertyTests();
  const { rows } = properties;
  const compositionality = rows.filter((row) => row.id.startsWith("property-strictest-"));
  const failures = compositionality.filter((row) => row.propertyEvidence?.failed === true);
  const summary = {
    rowCount: rows.length,
    properties: properties.results,
    llmFloorCoverage: properties.llmFloorCoverage,
    compositionalityBySourceAndLevel: Object.fromEntries((["terminal", "agent"] as const).flatMap((source) => levels.map((level) => [
      `${source}/${level}`,
      { cases: compositionality.filter((row) => row.source === source && row.level === level).length, failures: failures.filter((row) => row.source === source && row.level === level).length }
    ]))),
    compositionalityFailuresWithCd: failures.filter((row) => (row.propertyEvidence?.parts as string[]).some((part) => part.startsWith("cd "))).length,
    allRequiredPropertiesPass: Object.values(properties.results).every((result) => result.failures === 0)
  };
  await writeRun(runDirectory, rows, summary, { experiment: "X6 properties", seedProperties: "0x6a09e667", propertyCases: 10_000, startedAt, endedAt: new Date().toISOString() });
  process.stdout.write(`${runDirectory}\n${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.allRequiredPropertiesPass) process.exitCode = 1;
}

await main();
