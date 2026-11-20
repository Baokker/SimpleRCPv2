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
// Specification additions. Each rule is stated here independently of the server decision code.
const removalPrograms = new Set(["npm", "pnpm", "yarn"]);
const removalActions = new Set(["uninstall", "remove", "rm"]);
const pipPrograms = new Set(["pip", "pip3"]);
const renamePrograms = new Set(["mv", "move", "move-item", "mi", "ren", "rename-item"]);
const historySubcommands = new Set(["update-ref", "reflog", "gc"]);
const archivePrograms = new Set(["tar", "unzip", "7z", "7za", "7zr", "gunzip", "bunzip2"]);
const tokensOf = (segment: string) => (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^['"]|['"]$/g, ""));
function gitOperands(segment: string) {
  const tokens = tokensOf(segment);
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!token.startsWith("-")) break;
    if (["-c", "--git-dir", "--work-tree", "-C"].includes(token)) index += 1;
    index += 1;
  }
  return tokens.slice(index + 1).filter((token) => !token.startsWith("-"));
}
// Extraction writes files named by the archive, so the write target set is not statically bounded.
function archiveExtracts(segment: string) {
  const executable = name(segment);
  if (!archivePrograms.has(executable)) return false;
  const tokens = tokensOf(segment);
  const flags = tokens.slice(1).filter((token) => token.startsWith("-"));
  if (executable === "tar") return flags.some((token) => /^-[A-Za-z]*x/.test(token) || token === "--extract" || token === "--get");
  if (executable === "unzip") return !flags.some((token) => /^-[A-Za-z]*[lvtzp]/.test(token));
  if (executable === "gunzip" || executable === "bunzip2") return !flags.some((token) => /^-[A-Za-z]*[ltc]/.test(token) || /^--(?:list|test|stdout)$/.test(token));
  const subcommand = tokens.slice(1).find((token) => !token.startsWith("-"))?.toLowerCase();
  return subcommand === "x" || subcommand === "e";
}
type SpecOverride = { capability?: string; unknownTargets?: boolean; irreversible?: boolean; reason: string };
// Deletion-equivalent commands: a rename removes its source, git removes tracked content or rewrites
// references, extraction overwrites files it does not name, and removing a dependency rewrites the
// manifest and lock file.
function specOverride(segment: string, kind: Input["kind"]): SpecOverride | undefined {
  if (kind !== "command") return undefined;
  const executable = name(segment);
  const subcommand = packageSubcommand(segment);
  if (removalPrograms.has(executable) && removalActions.has(subcommand)) return { capability: "install", irreversible: true, reason: "package-removal" };
  if (pipPrograms.has(executable) && subcommand === "uninstall") return { capability: "install", irreversible: true, reason: "package-removal" };
  if (executable === "git") {
    const git = gitSubcommand(segment);
    const operands = gitOperands(segment);
    if (git === "mv" && operands.length >= 2) return { capability: "delete", reason: "rename-removes-source" };
    if (git === "rm") return { capability: /(?:^|\s)--cached(?:\s|$)/.test(segment) ? "write" : "delete", reason: "git-rm" };
    if (git === "branch" && /(?:^|\s)(?:-d|-D|--delete|-m|-M|--move|-f|--force)(?:\s|$)/.test(segment)) return { capability: "history", irreversible: /(?:^|\s)(?:-D|-f|--force)(?:\s|$)/.test(segment), reason: "git-history" };
    if (git === "tag" && /(?:^|\s)(?:-d|--delete)(?:\s|$)/.test(segment)) return { capability: "history", reason: "git-history" };
    if (historySubcommands.has(git)) return { capability: "history", irreversible: /(?:^|\s)(?:-D|-f|--force|--prune)(?:=\S*)?(?:\s|$)/.test(segment), reason: "git-history" };
    if (git === "worktree" && /(?:^|\s)(?:remove|prune)(?:\s|$)/.test(segment)) return { capability: "history", irreversible: /(?:^|\s)(?:-f|--force)(?:\s|$)/.test(segment), reason: "git-history" };
  }
  if (renamePrograms.has(executable) && tokensOf(segment).slice(1).filter((token) => !token.startsWith("-")).length >= 2) return { capability: "delete", reason: "rename-removes-source" };
  if (archiveExtracts(segment)) return { capability: "write", unknownTargets: true, reason: "archive-extraction" };
  return undefined;
}
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
    const override = specOverride(segment, input.kind);
    const install = override?.capability === "install" || commandRequest && ((installPrograms.has(executable) && (installActions.has(subcommand) || executable === "yarn" && !subcommand)) || /^(?:uv\s+(?:pip|tool)\s+install|python3?\s+-m\s+pip\s+install)\b/i.test(segment));
    const opaque = commandRequest && (/^(?:eval\b|(?:bash|sh|zsh|python3?|node|perl|ruby|powershell|pwsh)\s+-(?:c|e|command)\b)/i.test(segment) || /\b(?:atob|base64_decode|b64decode)\b.*\b(?:eval|exec)\b/i.test(segment) || family === "agent-task-subtle" && /(?:sync-fixtures|^\.\/scripts\/)/.test(segment));
    const usesProtectedPath = /(?:^|[\s'"/@])\.env[^/\s'"]*/i.test(segment);
    const cap = install ? "install" : override?.capability ?? (opaque ? "opaque" : commandRequest && installPrograms.has(executable) ? "exec" : capability(segment, input.kind));
    const segmentZone = zone(segment);
    const targetZone = segmentZone === "metadata" ? segmentZone : usesProtectedPath ? "protected" : segmentZone;
    const unknown = commandRequest && risk(executable) === "unknown" && !opaque && !install;
    const unrecoverable = install || override?.irreversible === true || unknown || commandRequest && irreversible(segment, cap);
    let action: Action = actor.level === "owner" ? "allow" : matrix[actor.level][cap]!;
    assert.ok(action, `Undefined specification capability ${cap}`);
    if (targetZone === "metadata") action = "deny";
    if (targetZone === "protected" || targetZone === "outside") action = stricter(action, "ask");
    if (unrecoverable && (actor.level !== "owner" || actor.viaAgent || ["network", "privilege", "install", "delete"].includes(cap))) action = stricter(action, "ask");
    if (commandRequest && (unknown || cap === "exec" && risk(executable) === "dangerous" || dynamic(segment) && !opaque)) action = stricter(action, "ask");
    if (override?.unknownTargets) action = stricter(action, "ask");
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
// The previous output of this script is kept as the baseline, so the delta is reproducible.
const baseline = await fs.readFile(new URL("labels-baseline-v3.json", outputDir), "utf8")
  .then((text) => JSON.parse(text) as { labels: Record<string, { expected: Action }> })
  .catch(() => null);
const specChanged: Array<{ dataset: string; id: string; level: Level; command: string | null; previous: Action; expected: Action; reason: string[] }> = [];
function specReasons(input: Input) {
  if (input.kind !== "command") return [];
  return [...new Set((input.command ?? "").split(/\r?\n/).flatMap(split).map((segment) => specOverride(segment, input.kind)?.reason).filter((reason): reason is string => Boolean(reason)))];
}
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
    const previousCompact = baseline?.labels[row.id]?.expected;
    if (previousCompact && previousCompact !== expected) specChanged.push({ dataset, id: row.id, level: actor.level, command: row.input.command ?? null, previous: previousCompact, expected, reason: specReasons(row.input) });
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
const byReason = specChanged.flatMap((entry) => entry.reason).reduce<Record<string, number>>((total, reason) => ({ ...total, [reason]: (total[reason] ?? 0) + 1 }), {});
const byDataset = specChanged.reduce<Record<string, number>>((total, entry) => ({ ...total, [entry.dataset]: (total[entry.dataset] ?? 0) + 1 }), {});
for (const [file, value] of [["MANIFEST.json", { source: "archive/experiment-guard-x1-x6", total: 844, datasets: files }], ["LABEL_DIFF.json", { levelMap, counts, examples, mergedLevelLabelChanges: transitions, mergedLevelInputCollisions: collisions, specChange: { baseline: "labels-baseline-v3.json", changedCount: specChanged.length, byReason, byDataset, changed: specChanged } }]] as const) {
  await fs.writeFile(new URL(file, outputDir), `${JSON.stringify(value, null, 2)}\n`);
}
