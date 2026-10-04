import crypto from "node:crypto";
import fs from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import type { AgentFileChange } from "@simplercp/shared";

export interface AgentWriteEntry {
  runId: string;
  toolCallId: string;
  file: string;
  completedAt: string;
  contentHash: string | null;
  readError?: string;
}

export function createAgentWriteLedger() {
  const entriesByProject = new Map<string, Map<string, AgentWriteEntry[]>>();

  async function record(
    projectId: string,
    runId: string,
    workspacePath: string,
    data: Record<string, unknown>
  ) {
    const writes = extractWrites(data);
    if (writes.length === 0) return undefined;
    const root = path.resolve(workspacePath);
    const entries: AgentWriteEntry[] = [];
    for (const write of writes) {
      const absolutePath = path.resolve(workspacePath, write.file);
      if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) continue;
      const file = path.relative(root, absolutePath).split(path.sep).join("/");
      const fileState = statSync(absolutePath, { throwIfNoEntry: false });
      const content = fileState ? await fs.readFile(absolutePath) : undefined;
      const readError = content === undefined ? "Written file no longer exists" : undefined;
      entries.push({
        runId,
        toolCallId: `${write.toolCallId}:${file}`,
        file,
        completedAt: new Date().toISOString(),
        contentHash: content ? crypto.createHash("sha256").update(content).digest("hex") : null,
        ...(readError ? { readError } : {})
      });
    }
    if (entries.length === 0) return undefined;
    const projectEntries = entriesByProject.get(projectId) ?? new Map<string, AgentWriteEntry[]>();
    const runEntries = projectEntries.get(runId) ?? [];
    for (const entry of entries) if (!runEntries.some((candidate) => candidate.toolCallId === entry.toolCallId)) runEntries.push(entry);
    projectEntries.set(runId, runEntries);
    entriesByProject.set(projectId, projectEntries);
    return entries;
  }

  function list(projectId: string, runId: string) {
    return [...(entriesByProject.get(projectId)?.get(runId) ?? [])];
  }

  function listProject(projectId: string) {
    return new Map(
      [...(entriesByProject.get(projectId) ?? new Map())].map(([runId, entries]) => [runId, [...entries]])
    );
  }

  function clear(projectId: string, runId: string) {
    const projectEntries = entriesByProject.get(projectId);
    projectEntries?.delete(runId);
    if (projectEntries && projectEntries.size === 0) entriesByProject.delete(projectId);
  }

  function clearProject(projectId: string) { entriesByProject.delete(projectId); }

  function attribute(projectId: string, runId: string, changes: AgentFileChange[], overlappingRunIds: Set<string>, memberChangedFiles: Set<string>) {
    const entries = list(projectId, runId);
    const toolFiles = new Set(entries.map((entry) => entry.file));
    const overlapFiles = new Set([...overlappingRunIds].flatMap((id) => list(projectId, id).map((entry) => entry.file)));
    const result = changes.filter((change) => toolFiles.has(change.file) || !overlapFiles.has(change.file)).map((change) => ({
      ...change,
      attribution: toolFiles.has(change.file) ? "tool" as const : overlappingRunIds.size > 0 || memberChangedFiles.has(change.file) ? "ambiguous" as const : "exclusive" as const
    }));
    const knownFiles = new Set(result.map((change) => change.file));
    for (const entry of entries) if (!knownFiles.has(entry.file)) {
      result.push({ file: entry.file, additions: 0, deletions: 0, status: "modified", attribution: "tool" });
      knownFiles.add(entry.file);
    }
    return result;
  }

  return { record, list, listProject, clear, clearProject, attribute };
}

function extractWrites(data: Record<string, unknown>) {
  const part = findToolPart(data);
  if (!part) return [];
  const tool = String(part.tool ?? "").toLowerCase();
  if (!new Set(["edit", "write", "patch", "apply_patch", "multiedit"]).has(tool)) return [];
  const state = part.state && typeof part.state === "object" ? part.state as Record<string, unknown> : undefined;
  if (state && state.status !== "completed" && state.status !== "success") return [];
  const input = state?.input && typeof state.input === "object" ? state.input as Record<string, unknown> : undefined;
  const file = input?.filePath ?? input?.path ?? part.filePath ?? part.path;
  const toolCallId = part.callID ?? part.toolCallId ?? part.id;
  if (typeof toolCallId !== "string" || !toolCallId) return [];
  if (tool === "apply_patch") {
    const metadata = state?.metadata as { files?: Array<{ filePath: string; movePath?: string }> } | undefined;
    if (!Array.isArray(metadata?.files)) throw new Error("Completed apply_patch event has no file metadata");
    return [...new Set(metadata.files.flatMap((entry) => [entry.filePath, ...(entry.movePath ? [entry.movePath] : [])]))].map((file) => ({ toolCallId, file }));
  }
  if (typeof file !== "string" || !file.trim()) return [];
  return [{ toolCallId, file }];
}

function findToolPart(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.tool === "string" && (record.state || record.filePath || record.path)) return record;
  for (const child of Object.values(record)) {
    const found = findToolPart(child);
    if (found) return found;
  }
  return undefined;
}

export type AgentWriteLedger = ReturnType<typeof createAgentWriteLedger>;
