import path from "node:path";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { parseCommandPaths } from "./legacy/parser.js";
import { roleLevel } from "./roles.js";
import { simpleCommands } from "./scriptInspection.js";
import type { GuardRequest, Level } from "./types.js";

// Who last wrote each workspace file through a guarded terminal command or Agent tool call.
// A script is judged at the lower of its executor's level and its last writer's level.

interface ProvenanceEntry { memberId: string; level: Level; at: string }

export function writtenPaths(request: GuardRequest): string[] {
  if (request.kind === "edit") return (request.paths ?? []).map((target) => path.resolve(request.cwd, target));
  if (request.kind !== "command" || !request.command) return [];
  const written: string[] = [];
  for (const simple of simpleCommands(request.command)) {
    const parsed = parseCommandPaths(simple, request.cwd);
    if (!parsed || !["write", "move"].includes(parsed.action)) continue;
    for (const target of parsed.targets) {
      if (target.role === "destination" || parsed.action === "write" && target.role === "target") written.push(target.resolvedPath);
    }
  }
  return written;
}

export function createWriteProvenance(filePath: string, workspaceRoot: string) {
  let entries: Record<string, ProvenanceEntry> | undefined;
  let loading: Promise<void> | undefined;
  let saving = Promise.resolve();
  const key = (absolutePath: string) => {
    const relative = path.relative(workspaceRoot, absolutePath);
    return !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? undefined : relative;
  };
  async function recordKeys(keys: string[], memberId: string, level: Level) {
    await load();
    if (!keys.length) return;
    const at = new Date().toISOString();
    for (const relative of keys) entries![relative] = { memberId, level, at };
    const snapshot = { ...entries };
    saving = saving.then(() => writeJsonFileAtomically(filePath, snapshot));
    await saving;
  }
  function load() {
    return loading ??= readJsonFile<Record<string, ProvenanceEntry>>(filePath).then((stored) => {
      entries = Object.assign(Object.create(null), stored);
    });
  }
  return {
    load,
    levelOf(absolutePath: string): Level | undefined {
      const relative = key(absolutePath);
      const entry = relative === undefined ? undefined : entries?.[relative];
      return entry ? roleLevel(entry.level) : undefined;
    },
    writerOf(absolutePath: string) {
      const relative = key(absolutePath);
      return relative === undefined ? undefined : entries?.[relative]?.memberId;
    },
    async record(request: GuardRequest, level: Level) {
      const keys = writtenPaths(request).map(key).filter((value): value is string => value !== undefined);
      await recordKeys(keys, request.memberId, level);
    },
    async recordObserved(absolutePath: string, memberId: string, level: Level) {
      const relative = key(absolutePath);
      if (relative === undefined) return;
      await recordKeys([relative], memberId, level);
    }
  };
}
