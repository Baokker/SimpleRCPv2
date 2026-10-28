import fs from "node:fs/promises";
import path from "node:path";
import { context, ensureRuntimeDirectory, loadDataset, makeRunId, projectRoot, toRequest, writeRun, type DatasetRecord, type RawRow } from "../lib/common.js";
import { characterize } from "../../../apps/server/src/guard/characterize.js";
import type { Action } from "../../../apps/server/src/guard/types.js";

// External baseline for X1: a static Agent-tool permission config (Claude Code style).
// W1 applies the config to Agent requests only, as an Agent tool would; W2 also applies it
// to human terminal commands as an upper bound. Neither can see which member triggered a request.

type Condition = "W1" | "W2";
interface Config { defaultMode: "ask"; deny: string[]; ask: string[]; allow: string[] }
interface Rules { bash: string[]; pipe: Array<[string, string]>; path: boolean }

const configPath = path.join(projectRoot, "experiments/guard/x1-static/whitelist.json");

function parseRules(entries: string[]): Rules {
  const rules: Rules = { bash: [], pipe: [], path: false };
  for (const entry of entries) {
    const match = entry.match(/^(\w+)\((.*)\)$/);
    if (!match) throw new Error(`Bad rule: ${entry}`);
    const [, tool, body] = match;
    if (tool === "Bash") rules.bash.push(body!);
    else if (tool === "Pipe") rules.pipe.push(body!.split("|") as [string, string]);
    else if (tool === "Path") rules.path = true;
  }
  return rules;
}

// Claude Code semantics: "x:*" matches x followed by end or a space; otherwise exact match.
// A prefix ending in punctuation (e.g. "curl http://") matches as a plain string prefix.
function matchesBash(segment: string, pattern: string): boolean {
  if (!pattern.endsWith(":*")) return segment === pattern;
  const prefix = pattern.slice(0, -2);
  if (/[^\w\s]$/.test(prefix)) return segment.startsWith(prefix);
  return segment === prefix.trimEnd() || segment.startsWith(prefix.endsWith(" ") ? prefix : `${prefix} `);
}

// Favour the baseline: "/usr/bin/GIT status" is matched as "git status".
function normalizeSegment(segment: string): string {
  const [head = "", ...rest] = segment.split(/\s+/);
  return [path.basename(head).toLowerCase(), ...rest].join(" ");
}

// Split on unquoted && || ; | and newlines; strip subshell parentheses and redirections.
function splitCommand(command: string): { segments: string[]; pipes: Array<[string, string]> } {
  const parts: Array<{ text: string; op: string }> = [];
  let current = "", quote: string | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!, next = command[index + 1];
    if (quote) { if (char === quote) quote = null; current += char; continue; }
    if (char === "'" || char === "\"") { quote = char; current += char; continue; }
    const op = (char === "&" && next === "&") || (char === "|" && next === "|") ? char + next : char === ";" || char === "\n" || char === "|" ? char : null;
    if (op) { parts.push({ text: current, op }); current = ""; index += op.length - 1; continue; }
    current += char;
  }
  parts.push({ text: current, op: "" });
  const clean = (text: string) => text.replace(/^[\s(]+|[\s)]+$/g, "").replace(/\s*\d?>>?\s*(&\d|\S+)/g, "").replace(/\s*<\s*\S+/g, "").trim();
  const segments = parts.map((part) => normalizeSegment(clean(part.text))).filter(Boolean);
  const pipes: Array<[string, string]> = [];
  parts.forEach((part, index) => {
    if (part.op === "|" && parts[index + 1]) pipes.push([normalizeSegment(clean(part.text)).split(/\s+/)[0]!, normalizeSegment(clean(parts[index + 1]!.text)).split(/\s+/)[0]!]);
  });
  return { segments, pipes };
}

function decideWhitelist(item: DatasetRecord, config: { deny: Rules; ask: Rules; allow: Rules }): { action: Action; rules: string[] } {
  const source = item.actor.viaAgent ? "agent" : "terminal";
  const ctx = context(item.actor.level);
  const zones = characterize(toRequest(item, source), ctx.platformDataRoot, undefined, ctx.otherWorkspaceRoots).segments.map((segment) => segment.zone);
  if (zones.some((zone) => zone === "outside" || zone === "metadata")) return { action: "deny", rules: ["whitelist.deny.path-outside-project"] };
  if (zones.includes("protected")) return { action: "deny", rules: ["whitelist.deny.protected-path"] };
  if (item.input.kind === "read" || item.input.kind === "edit") return { action: "allow", rules: [`whitelist.allow.${item.input.kind}`] };
  if (item.input.kind !== "command") return { action: "ask", rules: ["whitelist.default-ask"] };
  const { segments, pipes } = splitCommand(item.input.command ?? "");
  if (pipes.some(([left, right]) => config.deny.pipe.some(([a, b]) => left === a && right === b))) return { action: "deny", rules: ["whitelist.deny.pipe"] };
  const verdicts = segments.map((segment) => {
    const hit = (rules: Rules) => rules.bash.find((pattern) => matchesBash(segment, pattern));
    const deny = hit(config.deny), ask = hit(config.ask), allow = hit(config.allow);
    if (deny) return { action: "deny" as const, rule: `whitelist.deny.${deny}` };
    if (ask) return { action: "ask" as const, rule: `whitelist.ask.${ask}` };
    if (allow) return { action: "allow" as const, rule: `whitelist.allow.${allow}` };
    return { action: "ask" as const, rule: "whitelist.default-ask" };
  });
  const action: Action = verdicts.some((v) => v.action === "deny") ? "deny" : verdicts.some((v) => v.action === "ask") ? "ask" : "allow";
  return { action, rules: verdicts.map((v) => v.rule) };
}

function summarize(rows: RawRow[]) {
  const intercepted = (row: RawRow) => row.actual === "ask" || row.actual === "deny";
  const attack = (row: RawRow) => row.malicious && (row.expected === "ask" || row.expected === "deny" || typeof row.expected === "object");
  const benign = (row: RawRow) => !row.malicious && (row.expected === "allow" || row.expected === "allow_snapshot");
  const count = (selected: RawRow[]) => ({ total: selected.length, intercepted: selected.filter(intercepted).length });
  const by = (selected: RawRow[], key: (row: RawRow) => string) => {
    const groups: Record<string, { total: number; intercepted: number }> = {};
    for (const row of selected) { const group = groups[key(row)] ??= { total: 0, intercepted: 0 }; group.total += 1; if (intercepted(row)) group.intercepted += 1; }
    return groups;
  };
  return Object.fromEntries((["W1", "W2"] as const).map((condition) => {
    const rows_ = rows.filter((row) => row.condition === condition);
    const attacks = rows_.filter(attack), benigns = rows_.filter(benign), malicious = rows_.filter((row) => row.malicious);
    return [condition, {
      attack: count(attacks), benign: count(benigns), maliciousAll: count(malicious),
      attackBySourceLevel: by(attacks, (row) => `${row.source}/${row.level}`),
      benignBySourceLevel: by(benigns, (row) => `${row.source}/${row.level}`),
      actions: by(rows_, (row) => row.actual)
    }];
  }));
}

async function main() {
  const startedAt = new Date().toISOString();
  await ensureRuntimeDirectory();
  const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as Config;
  const config = { deny: parseRules(raw.deny), ask: parseRules(raw.ask), allow: parseRules(raw.allow) };
  const datasets: Array<[string, DatasetRecord[]]> = [];
  for (const name of ["D1", "D2", "D3", "D4"]) datasets.push([name, await loadDataset(name)]);
  const rows: RawRow[] = [];
  for (const condition of ["W1", "W2"] as const) {
    for (const [dataset, items] of datasets) {
      for (const item of items) {
        const source = item.actor.viaAgent ? "agent" : "terminal";
        const started = process.hrtime.bigint();
        const result = condition === "W1" && source === "terminal" ? { action: "allow" as Action, rules: ["whitelist.terminal-ungoverned"] } : decideWhitelist(item, config);
        const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        rows.push({ id: `${condition}-${item.id}`, condition, dataset, family: item.family, scenario: item.scenario, level: item.actor.level, source, input: item.input, expected: item.expected, actual: result.action, malicious: item.malicious, matchedRules: result.rules, legacyRisk: "unknown", autoEligible: false, durationMs, notes: item.notes });
      }
    }
  }
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X1W", makeRunId("x1w"));
  const summary = summarize(rows);
  await writeRun(runDirectory, rows, summary, { experiment: "X1W", conditions: ["W1", "W2"], config: path.relative(projectRoot, configPath), startedAt, endedAt: new Date().toISOString() });
  process.stdout.write(`${runDirectory}\n${JSON.stringify(summary, null, 2)}\n`);
}

await main();
