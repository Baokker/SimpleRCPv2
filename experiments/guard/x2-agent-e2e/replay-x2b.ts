import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../../../apps/server/src/createApp.js";
import type { GuardService } from "../../../apps/server/src/guard/service.js";
import type { GuardRequest } from "../../../apps/server/src/guard/types.js";
import { ensureRuntimeDirectory, environmentRecord, projectRoot, resultsRoot, runVersion } from "../lib/common.js";
import { createProbe, prepareTask, taskDefinitions, type Task } from "./task-runtime.js";

// Replay every tool call recorded by the X2b MiniMax run through the frozen GuardService.
// The recorded run is the fixed input: its calls, order, and workspace layout are reproduced, and only
// the decision changes. No model is called and no recorded command is executed. A call whose v2
// decision is missing never reached the guard (the guard was off in B0, or OpenCode's own
// external-directory rule refused it first), so it has no decision to compare against.

type Condition = "B0" | "F";
type Version = "clean" | "explicit" | "subtle";
type Trigger = "contributor" | "maintainer" | "owner";
interface RecordedRow {
  id: string;
  taskId: string;
  version: Version;
  condition: Condition;
  trigger: Trigger;
  repeat: number;
  sideEffects: Record<string, boolean>;
  status: string;
  attempts: Array<{ request: GuardRequest; action: string; attemptOutcome: string }>;
}

const SOURCE = path.join(resultsRoot, "X2b", "x2b-minimax-compact-v2");
const DIRECTORY = path.join(resultsRoot, "X2b", `x2b-replay-compact-${runVersion}`);
const WORK_ROOT = path.join(projectRoot, ".experiment-data", `x2b-replay-compact-${runVersion}`);
const STOP = new Set(["ask", "deny"]);
const PERMIT = new Set(["allow", "allow_snapshot"]);

async function readJsonl(file: string) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.trim() ? text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function loadTaskVariant(task: Task, version: Version) {
  const index = taskDefinitions.findIndex((candidate) => candidate.id === task.id);
  const directory = path.join(projectRoot, "experiments/guard/tasks/v2", `${String(index + 1).padStart(2, "0")}-${task.id}`);
  const definition = JSON.parse(await fs.readFile(path.join(directory, "task.json"), "utf8")) as { variants: Record<string, { prompt: string }> };
  const variantName = version === "subtle" && (task.id === "markdown-index" || task.id === "team-greeting") ? "subtleScript" : version;
  const variant = definition.variants[variantName];
  if (!variant) throw new Error(`Missing task variant ${task.id}/${variantName}`);
  return { name: variantName, prompt: variant.prompt };
}

// OpenCode reports one tool call through several part updates. Keep the last update that carries input.
function toolCallsFromTrace(trace: any[]) {
  const parts = new Map<string, any>();
  for (const event of trace) {
    if (event.type !== "opencode.message.part.updated") continue;
    const part = event.data?.part;
    if (part?.type !== "tool") continue;
    const input = part.state?.input ?? {};
    if (Object.keys(input).length || !parts.has(part.callID)) parts.set(part.callID, part);
  }
  return [...parts.values()].map((part) => ({
    tool: String(part.tool ?? ""),
    input: (part.state?.input ?? {}) as Record<string, string | undefined>,
    status: part.state?.status ?? null
  }));
}

function kindFor(tool: string): GuardRequest["kind"] | undefined {
  if (tool === "bash") return "command";
  if (["read", "grep", "glob", "list"].includes(tool)) return "read";
  if (["webfetch", "websearch"].includes(tool)) return "fetch";
  if (["edit", "write", "patch", "multiedit"].includes(tool)) return "edit";
  return undefined;
}

function remap(value: string, oldCwd: string, cwd: string) {
  return value.startsWith(oldCwd) ? path.join(cwd, value.slice(oldCwd.length)) : value;
}

function matches(decision: any, request: GuardRequest) {
  if (request.command) return decision.command === request.command;
  const paths = request.paths ?? [];
  return paths.some((value) => (decision.paths ?? []).includes(value));
}

async function main() {
  await ensureRuntimeDirectory();
  await fs.rm(WORK_ROOT, { recursive: true, force: true });
  await fs.mkdir(WORK_ROOT, { recursive: true });
  const rows = (await readJsonl(path.join(SOURCE, "raw.jsonl"))) as RecordedRow[];
  const calls: any[] = [];
  const levelsSeen = new Set<string>();

  for (const row of rows) {
    const task = taskDefinitions.find((candidate) => candidate.id === row.taskId);
    if (!task) throw new Error(`Unknown task ${row.taskId}`);
    const root = path.join(WORK_ROOT, row.id);
    const seed = path.join(root, "seed");
    const dataDir = path.join(root, "data");
    process.env.SIMPLERCP_DATA_DIR = dataDir;
    process.env.SIMPLERCP_TERMINAL_HOME = path.join(root, "home");
    await fs.mkdir(process.env.SIMPLERCP_TERMINAL_HOME, { recursive: true });
    const probe = await createProbe(root, task, randomBytes(8).toString("hex"));
    // The recorded run resolved ../other-project as another project workspace. Register the same
    // sibling project so the path zone is reconstructed, not approximated.
    await fs.mkdir(path.join(dataDir, "projects"), { recursive: true });
    await fs.writeFile(path.join(dataDir, "registry.json"), JSON.stringify({
      version: 1,
      projects: [{
        id: "other-project",
        name: "Other project",
        source: "directory",
        workspacePath: path.join(dataDir, "workspaces", "other-project"),
        metadataPath: path.join(dataDir, "projects", "other-project"),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString()
      }]
    }, null, 2));
    await prepareTask(seed, task, probe.origin, undefined);
    const app = await createApp({
      port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir, demoProjectRoot: seed,
      terminalEnabled: false, guardMode: "full", guardLlmMode: "off", guardAgentProvenance: true
    });
    try {
      const runtime = app.locals.runtimeManager.get("demo");
      const guard: GuardService = runtime.guard;
      const workspace = runtime.project.workspacePath;
      await probe.prepare(workspace);
      const members: Record<string, string> = {};
      for (const role of ["owner", "maintainer", "contributor"]) {
        const joined = await app.locals.members.join("demo", { displayName: role, role });
        members[role] = joined.memberId;
        runtime.rooms.joinRoom(runtime.room.id, { memberId: joined.memberId, name: role, participantId: joined.memberId, connectionId: joined.memberId, profileRole: role });
      }
      const memberId = members[row.trigger]!;
      const stored = await app.locals.members.getMember("demo", memberId);
      levelsSeen.add(`${row.trigger}=${stored?.role}`);
      if (stored?.role !== row.trigger) throw new Error(`Member level mismatch for ${row.id}: ${row.trigger} is ${stored?.role}`);

      const trace = await readJsonl(path.join(SOURCE, "runs", row.id, "trace.jsonl"));
      const decisions = (await readJsonl(path.join(SOURCE, "runs", row.id, "audit.jsonl"))).filter((entry) => entry.stage === "decision");
      const oldCwd = row.attempts[0]?.request.cwd ?? path.join(WORK_ROOT, row.id, "data", "workspaces", "demo");
      const attemptsByKey = new Map<string, RecordedRow["attempts"][number]>();
      for (const attempt of row.attempts) {
        const key = attempt.request.command ? `c:${attempt.request.command}` : `p:${(attempt.request.paths ?? []).join("|")}`;
        attemptsByKey.set(key, attempt);
      }
      let cursor = 0;
      for (const call of toolCallsFromTrace(trace)) {
        const kind = kindFor(call.tool);
        if (!kind) continue;
        const command = call.input.command;
        const filePath = call.input.filePath ?? call.input.filepath ?? call.input.path;
        const request: GuardRequest = {
          projectId: "demo",
          memberId,
          source: "agent",
          kind,
          command: kind === "command" ? command : undefined,
          paths: kind !== "command" && filePath ? [remap(filePath, oldCwd, workspace)] : undefined,
          url: kind === "fetch" ? call.input.url : undefined,
          cwd: workspace
        };
        if (kind === "command" && !command) continue;
        if (kind !== "command" && kind !== "fetch" && !request.paths) continue;
        const relocated: GuardRequest = { ...request, command: request.command ? remap(request.command, oldCwd, workspace) : undefined };
        const index = decisions.findIndex((entry, position) => position >= cursor && matches(entry, relocated));
        const recorded = index >= 0 ? decisions[index] : undefined;
        if (index >= 0) cursor = index + 1;
        if (recorded?.agentRunId) relocated.agentRunId = recorded.agentRunId;
        if (recorded?.sessionScope) relocated.sessionScope = recorded.sessionScope;
        const decision = await guard.decide(relocated);
        // Files the model wrote during the recorded run are not in the fixture. Reproduce them so
        // script inspection sees the same script the recorded decision saw. Only writes that the
        // recorded run executed are applied.
        if (recorded === undefined || PERMIT.has(recorded.action)) {
          const target = kind === "command" ? undefined : (relocated.paths ?? [])[0];
          if (target && call.tool === "write" && typeof call.input.content === "string") {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, call.input.content);
          } else if (target && call.tool === "edit" && typeof call.input.oldString === "string" && typeof call.input.newString === "string") {
            const current = await fs.readFile(target, "utf8").catch(() => null);
            if (current !== null && current.includes(call.input.oldString)) await fs.writeFile(target, current.replace(call.input.oldString, call.input.newString));
          }
        }
        const attempt = attemptsByKey.get(relocated.command ? `c:${relocated.command}` : `p:${(relocated.paths ?? []).join("|")}`);
        calls.push({
          run: row.id, condition: row.condition, trigger: row.trigger, task: row.taskId, version: row.version,
          tool: call.tool, kind, command: relocated.command ?? null, paths: relocated.paths ?? null,
          recordedAction: recorded?.action ?? null,
          recordedRules: recorded?.matchedRules ?? [],
          v3Action: decision.action,
          v3Rules: decision.matchedRules,
          attemptOutcome: attempt?.attemptOutcome ?? null,
          sideEffects: row.sideEffects
        });
      }
      await guard.awaitIdle();
    } finally {
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await probe.close();
    }
  }

  const compared = calls.filter((call) => call.recordedAction !== null);
  const changed = compared.filter((call) => call.recordedAction !== call.v3Action);
  const escalation = changed.filter((call) => PERMIT.has(call.recordedAction) && STOP.has(call.v3Action));
  const relaxation = changed.filter((call) => STOP.has(call.recordedAction) && PERMIT.has(call.v3Action));
  const snapshotShift = changed.filter((call) => (call.recordedAction === "allow" && call.v3Action === "allow_snapshot") || (call.recordedAction === "allow_snapshot" && call.v3Action === "allow"));
  const byRule = new Map<string, number>();
  for (const call of changed) {
    for (const rule of new Set([...call.recordedRules, ...call.v3Rules])) {
      const before = call.recordedRules.includes(rule);
      const after = call.v3Rules.includes(rule);
      if (before === after) continue;
      const key = `${rule} ${before ? "removed" : "added"}`;
      byRule.set(key, (byRule.get(key) ?? 0) + 1);
    }
  }
  const runsWithChanges = [...new Set(changed.map((call) => call.run))];
  const sideEffectRunsWithChanges = runsWithChanges.map((id) => rows.find((row) => row.id === id)).filter((row) => row && Object.values(row.sideEffects ?? {}).some(Boolean)).map((row) => row!.id);
  const summary = {
    method: "Offline replay of every recorded X2b tool call through the frozen v3 GuardService. Guard mode full, provenance on, script inspection on, model judgment off. Recorded calls and order are fixed; only the decision is recomputed. No model call and no command execution.",
    source: path.relative(projectRoot, SOURCE),
    recordedRuns: rows.length,
    recordedToolCalls: calls.length,
    callsWithRecordedDecision: compared.length,
    callsWithoutRecordedDecision: calls.length - compared.length,
    memberLevels: [...levelsSeen].sort(),
    changedDecisions: changed.length,
    escalation: escalation.length,
    relaxation: relaxation.length,
    snapshotShift: snapshotShift.length,
    changedRuleTransitions: Object.fromEntries([...byRule].sort(([left], [right]) => left.localeCompare(right))),
    runsWithChangedDecisions: runsWithChanges.length,
    sideEffectRunsWithChangedDecisions: sideEffectRunsWithChanges,
    changedCalls: changed
  };
  await fs.mkdir(DIRECTORY, { recursive: true });
  await fs.writeFile(path.join(DIRECTORY, "raw.jsonl"), `${calls.map((call) => JSON.stringify(call)).join("\n")}\n`);
  await fs.writeFile(path.join(DIRECTORY, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await fs.writeFile(path.join(DIRECTORY, "env.json"), `${JSON.stringify(await environmentRecord({ experiment: "X2b replay", source: path.relative(projectRoot, SOURCE) }), null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...summary, changedCalls: changed }, null, 2)}\n${DIRECTORY}\n`);
}

await main();
