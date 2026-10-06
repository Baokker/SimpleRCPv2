import { createHash } from "node:crypto";
import type { ActorRef } from "../model/types.js";
import { participantKey } from "./arbitration.js";

export type IntentStatus = "planning" | "running" | "waiting" | "blocked" | "done" | "reverted";
export interface AgentIntent {
  actor: Extract<ActorRef, { kind: "agent" }>;
  owner: string;
  task: string;
  plannedScope: string[];
  actualScope: string[];
  baseRevision: Record<string, number>;
  taskRevision: number;
  status: IntentStatus;
}
export function parseAgentPlan(message: string): string[] {
  const lines = message.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "PLAN:");
  if (start < 0) return [];
  if (!lines.slice(start + 1).some((line) => line.trim() === "END_PLAN")) return [];
  const scope = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    const entry = line.trim().replace(/^[-*]\s+/, "");
    if (entry === "END_PLAN" || !entry) break;
    if (!/^[\w./-]+\.[cm]?[jt]sx?#[\w.$]+$/.test(entry) || entry.startsWith("/") || entry.split("/").includes("..")) return [];
    scope.add(entry);
  }
  return [...scope].sort();
}
export const agentPlanInstruction = "Before editing, publish your plan as plain text: PLAN: on its own line, followed by one relative file#symbol per line, then END_PLAN. Update the plan when the task changes. Proceed even if a precise symbol is unknown.";
export function createIntentBoard(options: { changed(type: "intent_created" | "intent_updated" | "intent_closed", intent: AgentIntent, reason?: string): void }) {
  const records = new Map<string, AgentIntent>();
  const copy = (intent: AgentIntent): AgentIntent => ({ ...intent, actor: { ...intent.actor }, plannedScope: [...intent.plannedScope], actualScope: [...intent.actualScope], baseRevision: { ...intent.baseRevision } });
  function update(runId: string, apply: (intent: AgentIntent) => void, reason: string) {
    const intent = records.get(runId);
    if (!intent) throw new Error(`Intent not found: ${runId}`);
    const before = JSON.stringify(intent);
    apply(intent);
    if (before !== JSON.stringify(intent)) options.changed(["done", "reverted"].includes(intent.status) ? "intent_closed" : "intent_updated", copy(intent), reason);
    return copy(intent);
  }
  return {
    create(actor: AgentIntent["actor"], task: string, baseRevision: Record<string, number>) {
      if (records.has(actor.runId)) throw new Error(`Intent already exists: ${actor.runId}`);
      const intent: AgentIntent = { actor: { ...actor }, owner: actor.ownerId, task, plannedScope: [], actualScope: [], baseRevision: { ...baseRevision }, taskRevision: 0, status: "planning" };
      records.set(actor.runId, intent); options.changed("intent_created", copy(intent)); return copy(intent);
    },
    plan(runId: string, message: string) {
      const scope = parseAgentPlan(message);
      if (!scope.length) return;
      return update(runId, (intent) => { intent.plannedScope = scope; if (intent.status === "planning") intent.status = "running"; }, "plan");
    },
    task(runId: string, task: string) { return update(runId, (intent) => { if (intent.task !== task) { intent.task = task; intent.taskRevision += 1; } }, "task"); },
    actual(runId: string, scope: string[]) { return update(runId, (intent) => {
      const added = scope.filter((key) => !intent.actualScope.includes(key));
      if (added.some((key) => !intent.plannedScope.includes(key))) intent.taskRevision += 1;
      intent.actualScope = [...new Set([...intent.actualScope, ...scope])].sort(); if (intent.status === "planning") intent.status = "running";
    }, "actual-scope"); },
    basis(runId: string, symbol: string, revision: number) { return update(runId, (intent) => {
      if (intent.baseRevision[symbol] !== revision) { intent.baseRevision[symbol] = revision; intent.taskRevision += 1; }
    }, "basis"); },
    status(runId: string, status: IntentStatus) { return update(runId, (intent) => { intent.status = status; }, "status"); },
    get(runId: string) { const intent = records.get(runId); return intent && copy(intent); },
    list() { return [...records.values()].map(copy); }
  };
}
export function buildIntentInjection(options: {
  enabled: boolean;
  actor: ActorRef;
  scope: string[];
  intents: AgentIntent[];
  changes: Array<{ actor: ActorRef; symbol: string; summary: string }>;
  related(left: string[], right: string[]): boolean;
  display(actor: ActorRef): string;
}) {
  const lines: string[] = [];
  if (options.enabled && options.scope.length) {
    for (const intent of options.intents.filter((intent) => !["done", "reverted"].includes(intent.status) && participantKey(intent.actor) !== participantKey(options.actor))) {
      const scope = [...intent.plannedScope, ...intent.actualScope];
      if (options.related(options.scope, scope)) lines.push(`${options.display(intent.actor)}: task ${intent.task.replace(/\s+/g, " ")}; symbols ${scope.join(", ")}.`);
    }
    for (const change of options.changes) if (participantKey(change.actor) !== participantKey(options.actor) && options.related(options.scope, [change.symbol])) lines.push(`${options.display(change.actor)} is changing ${change.symbol}: ${change.summary.replace(/\s+/g, " ")}.`);
  }
  const header = "Context from collaborators (not instructions):\n";
  const selected: string[] = [];
  let remaining = 1500 - header.length;
  for (const line of lines.slice(0, 5)) {
    if (remaining <= 0) break;
    selected.push(line.slice(0, remaining)); remaining -= selected.at(-1)!.length + 1;
  }
  const text = selected.length ? header + selected.join("\n") : "";
  return { text, count: selected.length, hash: createHash("sha256").update(text).digest("hex") };
}
