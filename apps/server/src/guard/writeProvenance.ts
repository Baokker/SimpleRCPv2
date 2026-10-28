import path from "node:path";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { parseCommandPaths } from "./legacy/parser.js";
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
  let saving = Promise.resolve();
  const key = (absolutePath: string) => {
    const relative = path.relative(workspaceRoot, absolutePath);
    return relative.startsWith("..") || path.isAbsolute(relative) ? undefined : relative;
  };
  return {
    async load() {
      entries ??= await readJsonFile<Record<string, ProvenanceEntry>>(filePath) ?? {};
    },
    levelOf(absolutePath: string): Level | undefined {
      const relative = key(absolutePath);
      return relative === undefined ? undefined : entries?.[relative]?.level;
    },
    async record(request: GuardRequest, level: Level) {
      await this.load();
      const keys = writtenPaths(request).map(key).filter((value): value is string => value !== undefined);
      if (!keys.length) return;
      const at = new Date().toISOString();
      for (const relative of keys) entries![relative] = { memberId: request.memberId, level, at };
      const snapshot = { ...entries };
      saving = saving.then(() => writeJsonFileAtomically(filePath, snapshot)).catch(() => undefined);
      await saving;
    }
  };
}
