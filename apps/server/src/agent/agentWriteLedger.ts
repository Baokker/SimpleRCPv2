import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface AgentWriteEntry {
  runId: string;
  toolCallId: string;
  file: string;
  completedAt: string;
  contentHash: string;
}

export function createAgentWriteLedger() {
  const entriesByProject = new Map<string, Map<string, AgentWriteEntry[]>>();

  async function record(
    projectId: string,
    runId: string,
    workspacePath: string,
    data: Record<string, unknown>
  ) {
    const write = extractWrite(data);
    if (!write) return undefined;
    const absolutePath = path.resolve(workspacePath, write.file);
    const root = path.resolve(workspacePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return undefined;
    const file = path.relative(root, absolutePath).split(path.sep).join("/");
    const content = await fs.readFile(absolutePath);
    const entry: AgentWriteEntry = {
      runId,
      toolCallId: write.toolCallId,
      file,
      completedAt: new Date().toISOString(),
      contentHash: crypto.createHash("sha256").update(content).digest("hex")
    };
    const projectEntries = entriesByProject.get(projectId) ?? new Map<string, AgentWriteEntry[]>();
    const runEntries = projectEntries.get(runId) ?? [];
    if (!runEntries.some((candidate) => candidate.toolCallId === entry.toolCallId)) runEntries.push(entry);
    projectEntries.set(runId, runEntries);
    entriesByProject.set(projectId, projectEntries);
    return entry;
  }

  function list(projectId: string, runId: string) {
    return [...(entriesByProject.get(projectId)?.get(runId) ?? [])];
  }

  function listProject(projectId: string) {
    return new Map(
      [...(entriesByProject.get(projectId) ?? new Map())].map(([runId, entries]) => [runId, [...entries]])
    );
  }

  return { record, list, listProject };
}

function extractWrite(data: Record<string, unknown>) {
  const part = findToolPart(data);
  if (!part) return undefined;
  const tool = String(part.tool ?? "").toLowerCase();
  if (!new Set(["edit", "write", "patch", "apply_patch", "multiedit"]).has(tool)) return undefined;
  const state = part.state && typeof part.state === "object" ? part.state as Record<string, unknown> : undefined;
  if (state && state.status !== "completed" && state.status !== "success") return undefined;
  const input = state?.input && typeof state.input === "object" ? state.input as Record<string, unknown> : undefined;
  const file = input?.filePath ?? input?.path ?? part.filePath ?? part.path;
  if (typeof file !== "string" || !file.trim()) return undefined;
  const toolCallId = part.callID ?? part.toolCallId ?? part.id;
  if (typeof toolCallId !== "string" || !toolCallId) return undefined;
  return { toolCallId, file };
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
