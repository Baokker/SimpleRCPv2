import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch, parsePatch } from "diff";
import { resolveWorkspacePath } from "../workspace.js";
import { AGENT_EDIT_PERMISSIONS, type PermissionHandler } from "./permissionDispatcher.js";

export interface AgentEditProposal { file: string; before: string; after: string; deleted?: boolean; existedBefore?: boolean }

export async function reconstructAgentEdit(workspace: string, metadata: Record<string, unknown>): Promise<AgentEditProposal[]> {
  const entries = Array.isArray(metadata.files) ? metadata.files : [metadata];
  if (entries.length === 0) throw new Error("Edit metadata does not identify any file.");
  const proposals: AgentEditProposal[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Edit file metadata is invalid.");
    const data = entry as Record<string, unknown>;
    const filepath = data.filepath ?? data.filePath;
    if (typeof filepath !== "string" || typeof data.diff !== "string") throw new Error("Edit metadata requires filepath and unified diff.");
    const file = path.relative(path.resolve(workspace), path.resolve(workspace, filepath)).split(path.sep).join("/");
    const absolute = resolveWorkspacePath(workspace, file);
    let before: string;
    let existedBefore = true;
    try { before = await fs.readFile(absolute, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; before = ""; existedBefore = false; }
    const patches = parsePatch(data.diff);
    if (patches.length !== 1) throw new Error("Each edit file requires exactly one unified diff.");
    const after = applyPatch(before, patches[0]!, { fuzzFactor: 0 });
    if (after === false) throw new Error(`Edit baseline has changed for ${file}; reread the file and retry.`);
    if (proposals.some((proposal) => proposal.file === file)) throw new Error(`Duplicate edit file: ${file}`);
    proposals.push({ file, before, after, existedBefore, ...(patches[0]!.newFileName === "/dev/null" || data.type === "delete" ? { deleted: true } : {}) });
    if (typeof data.movePath === "string") {
      const moveFile = path.relative(path.resolve(workspace), path.resolve(workspace, data.movePath)).split(path.sep).join("/");
      const movePath = resolveWorkspacePath(workspace, moveFile);
      try { await fs.stat(movePath); throw new Error(`Move destination already exists: ${moveFile}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      proposals[proposals.length - 1] = { file, before, after: "", deleted: true };
      proposals.push({ file: moveFile, before: "", after, existedBefore: false });
    }
  }
  return proposals;
}

export function conflictGuardEditHandler(options: {
  workspace: string;
  judge(proposals: AgentEditProposal[], signal: AbortSignal): Promise<{ decision: "allow" | "warn" | "lock"; message?: string; onRejected?: () => void }>;
  approved(proposals: AgentEditProposal[]): void;
}): PermissionHandler {
  return async (request, signal) => {
    if (!AGENT_EDIT_PERMISSIONS.has(request.permission)) return { reply: "once" };
    const proposals = await reconstructAgentEdit(options.workspace, request.metadata);
    const result = await options.judge(proposals, signal);
    if (signal.aborted) { result.onRejected?.(); return { reply: "reject", message: "Conflict analysis timed out or was cancelled; retry later." }; }
    return result.decision === "lock" ? { reply: "reject", message: result.message ?? "This edit conflicts with another participant. Reread the related symbols and retry with a compatible implementation." } : { reply: "once", onApproved: () => options.approved(proposals), onRejected: result.onRejected };
  };
}
