import fs from "node:fs/promises";
import { expect, it } from "vitest";
import { splitShellCommands, stripHereDocument } from "../guard/characterize.js";
import { decide } from "../guard/decide.js";
import { LEVELS } from "../guard/roles.js";
import { stricter } from "../guard/rules.js";
import type { GuardContext, GuardDecision, GuardRequest } from "../guard/types.js";

const fixtureRoot = new URL("./fixtures/guard/", import.meta.url);
const reportPath = new URL("../../../../docs/guard/compact/path-consistency.json", import.meta.url);
const seed = 0x434f4d50;
const generatedCount = 10_000;
const workspaceRoot = "/workspace/project";

async function readLines<RecordType>(name: string): Promise<RecordType[]> {
  return (await fs.readFile(new URL(name, fixtureRoot), "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as RecordType);
}

function generateCommands() {
  let state = seed;
  function choose<Value>(values: readonly Value[]): Value {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return values[Math.floor(state / 2 ** 32 * values.length)]!;
  }
  const commands = ["pwd", "ls -la", "cat input.txt", "touch draft.txt", "rm result.txt", "git status", "git commit -m note", "git rebase main", "npm install", "curl https://example.test/", "./check.sh", "sudo ls", "cd examples", "head README.md", "echo 'a;b'"];
  const operators = [" && ", " || ", "; ", " | ", "\n"];
  return Array.from({ length: generatedCount }, () => {
    const count = choose([2, 3, 4, 5]);
    let command = choose(commands);
    for (let index = 1; index < count; index++) command += choose(operators) + choose(commands);
    return command;
  });
}

function features(decision: GuardDecision) {
  return JSON.stringify(decision.segments.map(({ capabilities, zone, reversibility }) => [capabilities, zone, reversibility]));
}

function counts() {
  return { total: 0, compared: 0, violations: 0, differentFeatures: 0, differentFeatureLooserDecisions: 0 };
}

const isCd = (command: string) => /^cd(?:\s|$)/i.test(command.trim());

function featureDifferenceReason(command: string) {
  if (command.includes("\n")) return "newline";
  if ((splitShellCommands(command).some(isCd) || isCd(command))) return "cd";
  return "other";
}

function compareTerminalLines(request: GuardRequest, context: GuardContext, agent: GuardDecision) {
  const command = request.command!;
  if (stripHereDocument(command) !== command) return { excluded: "heredoc" as const };
  const lines = command.split(/\r?\n/).filter((line) => line.trim());
  const terminalLines = lines.map((line) => decide({ ...request, command: line }, context));
  const strictest = (decisions: GuardDecision[]) => decisions.reduce<GuardDecision["action"]>((action, decision) => stricter(action, decision.action), "allow");
  const terminal = strictest(terminalLines);
  const looser = stricter(agent.action, terminal) !== agent.action;
  const lastLine = lines.at(-1);
  if (looser && lastLine && isCd(lastLine) && splitShellCommands(lastLine).length === 0 &&
    terminalLines.at(-1)?.matchedRules.includes("hard.cwd") &&
    stricter(agent.action, strictest(terminalLines.slice(0, -1))) === agent.action) {
    return { excluded: "trailingCdOnly" as const };
  }
  return { terminal, looser };
}

it("enforces ComPACT Property 1 across fixture and generated command pairs", async () => {
  const commandRows = await readLines<{ commands: { text: string }[] }>("commands.v2.provisional.jsonl");
  const pathRows = await readLines<{ command: string }>("adversarial-cases.provisional.jsonl");
  const archived = (await Promise.all(["original", "v2"].flatMap((version) =>
    [1, 2, 3, 4, 5, 6].map((dataset) => readLines<{ input?: { command?: string } }>(`compact/${version}/D${dataset}.jsonl`))
  ))).flat().flatMap(({ input }) => typeof input?.command === "string" ? [input.command] : []);
  const existing = [...commandRows.flatMap(({ commands }) => commands.map(({ text }) => text)), ...pathRows.map(({ command }) => command)];
  const generated = generateCommands();
  const commands = [...existing, ...archived, ...generated];
  const violations: { level: string; online: boolean; command: string; terminal: string; agent: string }[] = [];
  const summary = {
    seed,
    inputs: { existing: existing.length, archived: archived.length, generated: generated.length },
    ...counts(),
    differentFeatureReasons: { newline: 0, cd: 0, other: 0 },
    differentFeatureOtherExamples: [] as string[],
    differentFeatureLooserTerminalRules: { controlCharacter: 0, cwd: 0, both: 0, neither: 0 },
    differentFeatureLooserOtherExamples: [] as typeof violations,
    multiline: {
      total: 0,
      compared: 0,
      looser: 0,
      excluded: { heredoc: 0, trailingCdOnly: 0 },
      looserExamples: [] as typeof violations
    },
    byLevel: Object.fromEntries(LEVELS.map((level) => [level, { online: counts(), offline: counts() }])),
  };
  const otherCommands = new Set<string>();
  for (const memberLevel of LEVELS) {
    for (const initiatorOnline of [true, false]) {
      const group = summary.byLevel[memberLevel]![initiatorOnline ? "online" : "offline"];
      const context = { memberLevel, initiatorOnline, workspaceRoot, platformDataRoot: "/platform/data" };
      for (const command of commands) {
        const request: GuardRequest = { projectId: "compact", cwd: workspaceRoot, memberId: "member", kind: "command", source: "terminal", command };
        const terminal = decide(request, context);
        const agent = decide({ ...request, source: "agent", agentRunId: "property-1" }, context);
        const sameFeatures = features(agent) === features(terminal);
        const looser = stricter(agent.action, terminal.action) !== agent.action;
        group.total++;
        if (sameFeatures) {
          group.compared++;
          if (looser) {
            group.violations++;
            violations.push({ level: memberLevel, online: initiatorOnline, command, terminal: terminal.action, agent: agent.action });
          }
        } else {
          group.differentFeatures++;
          const reason = featureDifferenceReason(command);
          summary.differentFeatureReasons[reason]++;
          if (reason === "other" && otherCommands.size < 8) otherCommands.add(command);
          if (looser) {
            group.differentFeatureLooserDecisions++;
            const controls = terminal.matchedRules.includes("hard.control-character");
            const cwd = terminal.matchedRules.includes("hard.cwd");
            const rule = controls ? cwd ? "both" : "controlCharacter" : cwd ? "cwd" : "neither";
            summary.differentFeatureLooserTerminalRules[rule]++;
            if (rule === "neither" && summary.differentFeatureLooserOtherExamples.length < 8) {
              summary.differentFeatureLooserOtherExamples.push({ level: memberLevel, online: initiatorOnline, command, terminal: terminal.action, agent: agent.action });
            }
          }
        }
        if (command.includes("\n")) {
          summary.multiline.total++;
          const lineComparison = compareTerminalLines(request, context, agent);
          if (lineComparison.excluded) {
            summary.multiline.excluded[lineComparison.excluded]++;
          } else {
            summary.multiline.compared++;
            if (lineComparison.looser) {
              summary.multiline.looser++;
              if (summary.multiline.looserExamples.length < 8) {
                summary.multiline.looserExamples.push({ level: memberLevel, online: initiatorOnline, command, terminal: lineComparison.terminal, agent: agent.action });
              }
            }
          }
        }
      }
      summary.total += group.total;
      summary.compared += group.compared;
      summary.violations += group.violations;
      summary.differentFeatures += group.differentFeatures;
      summary.differentFeatureLooserDecisions += group.differentFeatureLooserDecisions;
      expect(group.compared).toBeGreaterThan(0);
    }
  }
  summary.differentFeatureOtherExamples = [...otherCommands];
  expect(Object.values(summary.differentFeatureReasons).reduce((total, count) => total + count, 0)).toBe(summary.differentFeatures);
  expect(Object.values(summary.differentFeatureLooserTerminalRules).reduce((total, count) => total + count, 0)).toBe(summary.differentFeatureLooserDecisions);
  expect(summary.multiline.total).toBe(summary.multiline.compared + summary.multiline.excluded.heredoc + summary.multiline.excluded.trailingCdOnly);
  expect(summary.multiline.compared).toBeGreaterThan(0);
  if (process.env.SIMPLERCP_EXPORT_COMPACT_PROPERTY1 === "1") {
    await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  expect(violations.slice(0, 8), `${summary.violations} path-consistency violations`).toEqual([]);
}, 120_000);
