import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { capability, dynamic, gitSubcommand, irreversible, name, packageSubcommand, risk, split, stricter, zone } from "./verify-dataset-v2.js";
import type { Action, Input } from "./verify-dataset-v2.js";

const levelMap = { observer: "viewer", student: "contributor", collaborator: "maintainer", trusted: "maintainer", owner: "owner" } as const;
type LegacyLevel = keyof typeof levelMap;
type Level = (typeof levelMap)[LegacyLevel];
type Actor<LevelType> = { level: LevelType; viaAgent: boolean; agentKind: string | null };
type LegacyRecord = { id: string; family: string; input: Input; actor: Actor<LegacyLevel>; expected: Action; malicious: boolean };
const matrix: Record<Exclude<Level, "owner">, Record<string, Action>> = {
  viewer: { read: "allow", write: "deny", delete: "deny", exec: "deny", opaque: "deny", network: "deny", install: "deny", history: "deny", process: "deny", privilege: "deny" },
  contributor: { read: "allow", write: "allow_snapshot", delete: "ask", exec: "allow", opaque: "ask", network: "ask", install: "ask", history: "ask", process: "ask", privilege: "deny" },
  maintainer: { read: "allow", write: "allow_snapshot", delete: "allow_snapshot", exec: "allow", opaque: "ask", network: "allow", install: "ask", history: "ask", process: "ask", privilege: "ask" }
};
const installPrograms = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "cargo", "go", "apt", "apt-get", "brew"]);
const installActions = new Set(["install", "i", "add", "ci", "update", "upgrade", "sync"]);
const rawDir = new URL("../datasets/v2/", import.meta.url);
const outputDir = new URL("../datasets/compact/", import.meta.url);

function specAction(input: Input, actor: Actor<Level>, family: string): Action {
  const command = input.command ?? "";
  const commandRequest = input.kind === "command";
  if (commandRequest && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(command)) return "deny";
  if (commandRequest && !actor.viaAgent && (/[\t\r\n]/.test(command) || /^(?:cd|chdir|pushd|popd|set-location|sl)(?:\s|$)/i.test(command.trim()))) return "deny";
  const segments = commandRequest ? command.split(/\r?\n/).flatMap(split) : (input.paths?.length ? input.paths : [input.url ?? ""]);
  let result: Action = "allow";
  for (const segment of segments) {
    const executable = name(segment);
    const subcommand = packageSubcommand(segment);
    const install = commandRequest && ((installPrograms.has(executable) && (installActions.has(subcommand) || executable === "yarn" && !subcommand)) || /^(?:uv\s+(?:pip|tool)\s+install|python3?\s+-m\s+pip\s+install)\b/i.test(segment));
    const opaque = commandRequest && (/^(?:eval\b|(?:bash|sh|zsh|python3?|node|perl|ruby|powershell|pwsh)\s+-(?:c|e|command)\b)/i.test(segment) || /\b(?:atob|base64_decode|b64decode)\b.*\b(?:eval|exec)\b/i.test(segment) || family === "agent-task-subtle" && /(?:sync-fixtures|^\.\/scripts\/)/.test(segment));
    const usesProtectedPath = /(?:^|[\s'"/@])\.env[^/\s'"]*/i.test(segment);
    const cap = install ? "install" : opaque ? "opaque" : commandRequest && installPrograms.has(executable) ? "exec" : capability(segment, input.kind);
    const segmentZone = zone(segment);
    const targetZone = segmentZone === "metadata" ? segmentZone : usesProtectedPath ? "protected" : segmentZone;
    const unknown = commandRequest && risk(executable) === "unknown" && !opaque && !install;
    const unrecoverable = install || unknown || commandRequest && irreversible(segment, cap);
    let action: Action = actor.level === "owner" ? "allow" : matrix[actor.level][cap]!;
    assert.ok(action, `Undefined specification capability ${cap}`);
    if (targetZone === "metadata") action = "deny";
    if (targetZone === "protected" || targetZone === "outside") action = stricter(action, "ask");
    if (unrecoverable && (actor.level !== "owner" || actor.viaAgent || ["network", "privilege", "install", "delete"].includes(cap))) action = stricter(action, "ask");
    if (commandRequest && (unknown || cap === "exec" && risk(executable) === "dangerous" || dynamic(segment) && !opaque)) action = stricter(action, "ask");
    if (commandRequest && executable === "git" && (/^git\s+(?:-C|--git-dir|--work-tree|-c)\b/.test(segment) || actor.level === "owner" && gitSubcommand(segment) === "clean")) action = stricter(action, "ask");
    result = stricter(result, action);
  }
  if (commandRequest && /\b(?:curl|wget)\b[^;&|]*\|\s*(?:sh|bash|zsh)\b/i.test(command)) result = stricter(result, "ask");
  return result;
}

const sizes = { D1: 361, D2: 123, D3: 92, D4: 141, D5: 41, D6: 86 };
const counts: Record<string, Record<string, { total: number; changed: number }>> = {};
const examples: unknown[] = [];
const transitions: unknown[] = [];
const collisions: unknown[] = [];
const files = [];
await fs.mkdir(outputDir, { recursive: true });
for (const [dataset, count] of Object.entries(sizes)) {
  const file = `${dataset}.jsonl`;
  const text = await fs.readFile(new URL(file, rawDir), "utf8");
  const rows: LegacyRecord[] = text.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.length, count);
  assert.equal(new Set(rows.map((row) => row.id)).size, count);
  const byLevel = counts[dataset] = {};
  const inputs = new Map<string, LegacyRecord[]>();
  const migrated = rows.map((row) => {
    const actor = { ...row.actor, level: levelMap[row.actor.level] };
    assert.ok(actor.level, `Unknown level for ${row.id}`);
    const expected = specAction(row.input, actor, row.family);
    const group = byLevel[actor.level] ??= { total: 0, changed: 0 };
    group.total++;
    const difference = { dataset, id: row.id, archivedLevel: row.actor.level, level: actor.level, previous: row.expected, expected };
    if (expected !== row.expected) {
      group.changed++;
      if (examples.filter((example) => (example as typeof difference).dataset === dataset).length < 5) examples.push(difference);
      if (actor.level === "maintainer") transitions.push(difference);
    }
    const key = JSON.stringify([actor, row.input]);
    const duplicates = inputs.get(key) ?? [];
    duplicates.push(row);
    inputs.set(key, duplicates);
    return { ...row, actor, expected, label_source: "compact-policy-spec" };
  });
  for (const group of inputs.values()) {
    if (new Set(group.map((row) => row.actor.level)).size > 1) collisions.push({ dataset, rows: group.map(({ id, actor, expected }) => ({ id, archivedLevel: actor.level, archivedExpected: expected })) });
  }
  const content = `${migrated.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await fs.writeFile(new URL(file, outputDir), content);
  files.push({ dataset, file, count, sha256: createHash("sha256").update(content).digest("hex") });
}
for (const [file, value] of [["MANIFEST.json", { source: "archive/experiment-guard-x1-x6", total: 844, datasets: files }], ["LABEL_DIFF.json", { levelMap, counts, examples, mergedLevelLabelChanges: transitions, mergedLevelInputCollisions: collisions }]] as const) {
  await fs.writeFile(new URL(file, outputDir), `${JSON.stringify(value, null, 2)}\n`);
}
