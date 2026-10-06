import fs from "node:fs/promises";
import { applyPatch, parsePatch } from "diff";
import { resolveWorkspacePath } from "../workspace.js";
import { canonicalWorkspacePath } from "../workspacePath.js";
import { AGENT_EDIT_PERMISSIONS, PermissionEditRejected, type PermissionHandler } from "./permissionDispatcher.js";

export interface AgentEditProposal { file: string; before: string; after: string; deleted?: boolean; existedBefore?: boolean }

export interface AgentToolInput { tool: string; input: Record<string, unknown> }
interface AgentEditBaseline { before: string; existedBefore: boolean }

function editFiles(workspace: string, metadata: Record<string, unknown>) {
  const entries = Array.isArray(metadata.files) ? metadata.files : [metadata];
  if (entries.length === 0) throw new Error("修改元数据没有提供文件，请停止重复提交同一修改并向用户报告");
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("修改文件的元数据格式无效");
    const data = entry as Record<string, unknown>;
    const filepath = data.filepath ?? data.filePath;
    if (typeof filepath !== "string") throw new Error("修改元数据缺少文件路径");
    const file = canonicalWorkspacePath(workspace, filepath).relative;
    const absolute = resolveWorkspacePath(workspace, file);
    return { data, file, absolute };
  });
}

async function readBaseline(absolute: string): Promise<AgentEditBaseline> {
  try { return { before: await fs.readFile(absolute, "utf8"), existedBefore: true }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { before: "", existedBefore: false }; }
}

export async function reconstructAgentEdit(workspace: string, metadata: Record<string, unknown>, toolInput?: AgentToolInput, baselines?: ReadonlyMap<string, AgentEditBaseline>): Promise<AgentEditProposal[]> {
  const proposals: AgentEditProposal[] = [];
  for (const { data, file, absolute } of editFiles(workspace, metadata)) {
    const diff = data.patch ?? data.diff;
    const { before, existedBefore } = baselines?.get(file) ?? await readBaseline(absolute);
    const exactInput = toolInput?.tool === "edit" && typeof toolInput.input.oldString === "string" && typeof toolInput.input.newString === "string" || toolInput?.tool === "write" && typeof toolInput.input.content === "string";
    const patches = !exactInput && typeof diff === "string" ? parsePatch(diff) : [];
    let after: string | false;
    if (toolInput?.tool === "write" && typeof toolInput.input.content === "string") after = toolInput.input.content;
    else if (toolInput?.tool === "edit" && typeof toolInput.input.oldString === "string" && typeof toolInput.input.newString === "string") {
      const { oldString, newString } = toolInput.input as { oldString: string; newString: string };
      if (!oldString || !before.includes(oldString)) throw new PermissionEditRejected(`${file} 的原文已经变化，请重新读取后再修改`);
      if (!toolInput.input.replaceAll && before.indexOf(oldString) !== before.lastIndexOf(oldString)) throw new PermissionEditRejected(`${file} 中存在多处相同原文，请提供唯一的修改范围`);
      after = toolInput.input.replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, () => newString);
    } else {
      if (patches.length !== 1) throw new Error("每份修改文件需要提供一份完整的 unified diff");
      after = applyPatch(before, patches[0]!, { fuzzFactor: 0 });
      if (after === false) {
        const sourceLines = before.split("\n");
        const shifted = { ...patches[0]!, hunks: patches[0]!.hunks.map((hunk) => {
          let position = hunk.oldStart - 1;
          const offsets: number[] = [];
          for (const line of hunk.lines) {
            if (line[0] === " " || line[0] === "-") {
              const source = sourceLines[position++] ?? "";
              const content = line.slice(1);
              if (content.trim()) {
                if (source.trimStart() !== content.trimStart()) return hunk;
                offsets.push(source.length - source.trimStart().length - (content.length - content.trimStart().length));
              }
            }
          }
          const offset = offsets[0] ?? 0;
          if (offset <= 0 || offsets.some((value) => value !== offset)) return hunk;
          return { ...hunk, lines: hunk.lines.map((line) => [" ", "+", "-"].includes(line[0]!) && line.slice(1).trim() ? `${line[0]}${" ".repeat(offset)}${line.slice(1)}` : line) };
        }) };
        after = applyPatch(before, shifted, { fuzzFactor: 0 });
      }
    }
    if (after === false) throw new PermissionEditRejected(`${file} 的原文与修改提案不匹配，请重新读取后再修改`);
    if (proposals.some((proposal) => proposal.file === file)) throw new Error(`修改提案重复包含文件：${file}`);
    proposals.push({ file, before, after, existedBefore, ...(patches[0]?.newFileName === "/dev/null" || data.type === "delete" ? { deleted: true } : {}) });
    if (typeof data.movePath === "string") {
      const moveFile = canonicalWorkspacePath(workspace, data.movePath).relative;
      const movePath = resolveWorkspacePath(workspace, moveFile);
      try { await fs.stat(movePath); throw new PermissionEditRejected(`移动文件的目标已经存在：${moveFile}，请重新读取目标并调整修改`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      proposals[proposals.length - 1] = { file, before, after: "", deleted: true };
      proposals.push({ file: moveFile, before: "", after, existedBefore: false });
    }
  }
  return proposals;
}

export function conflictGuardEditHandler(options: {
  workspace: string;
  judge(proposals: AgentEditProposal[], signal: AbortSignal, request: import("./permissionDispatcher.js").AgentPermissionRequest): Promise<{ decision: "allow" | "warn" | "lock"; defer?: boolean; message?: string; onApproved?: () => void; onRejected?: () => void }>;
  approved(proposals: AgentEditProposal[]): void;
  rejectionContext?(): string;
  toolInput?(request: import("./permissionDispatcher.js").AgentPermissionRequest): AgentToolInput | undefined | Promise<AgentToolInput | undefined>;
}): PermissionHandler {
  return async (request, signal) => {
    if (!AGENT_EDIT_PERMISSIONS.has(request.permission)) return { reply: "once" };
    const baselines = new Map(await Promise.all(editFiles(options.workspace, request.metadata).map(async ({ file, absolute }) => [file, await readBaseline(absolute)] as const)));
    const proposals = await reconstructAgentEdit(options.workspace, request.metadata, await options.toolInput?.(request), baselines);
    const result = await options.judge(proposals, signal, request);
    if (signal.aborted) { result.onRejected?.(); return { reply: "reject", message: "冲突分析超过时间预算或已取消，本次修改未获批准。" }; }
    if (result.defer) return { reply: "defer", message: result.message, onRejected: result.onRejected };
    async function verifyBaseline() {
      for (const proposal of proposals) {
        const current = await readBaseline(resolveWorkspacePath(options.workspace, proposal.file));
        if (current.before !== proposal.before || current.existedBefore !== proposal.existedBefore) throw new PermissionEditRejected(["文件在你修改期间已被他人更新，请重新读取后再修改", options.rejectionContext?.()].filter(Boolean).join("\n\n"));
      }
    }
    try { await verifyBaseline(); }
    catch (error) { result.onRejected?.(); throw error; }
    return result.decision === "lock" ? { reply: "reject", message: result.message ?? "本次修改与其他参与者冲突，请重新读取关联符号并使用兼容实现。" } : { reply: "once", onApproved: async () => {
      await verifyBaseline();
      if (signal.aborted) throw new PermissionEditRejected("审批分析已取消，本次修改未获批准。");
      result.onApproved?.();
      options.approved(proposals);
    }, onRejected: result.onRejected };
  };
}
