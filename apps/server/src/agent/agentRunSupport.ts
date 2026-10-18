import type {
  AgentFileChange,
  AgentPromptContext,
  AgentRun
} from "@simplercp/shared";
import { readWorkspaceFile } from "../workspace.js";

export async function buildRuntimePrompt(
  workspacePath: string,
  prompt: string,
  contexts: AgentPromptContext[] | undefined,
  projectName: string,
  supplementaryContext?: string
) {
  const scope = [
    `You are working only on the project "${projectName}".`,
    `The project workspace is ${workspacePath}.`,
    "Use only files inside this workspace as project context.",
    "Do not inspect, describe, or use any parent directory or parent repository."
  ].join("\n");
  const background = supplementaryContext ? `\n\nCollaboration background:\n${supplementaryContext}\nEnd of collaboration background.` : "";
  if (!contexts || contexts.length === 0) return `${scope}${background}\n\nUser request:\n${prompt}`;
  const sections: string[] = [];
  for (const context of contexts) {
    const result = await readWorkspaceFile(workspacePath, context.path);
    if (result.status !== "text") {
      throw new Error(
        `Agent context must be a text file smaller than 1 MB: ${context.path}`
      );
    }
    sections.push(
      `--- ${context.path} ---\n${result.content}\n--- end ${context.path} ---`
    );
  }
  return `${scope}${background}\n\nRelevant project files:\n${sections.join("\n")}\n\nUser request:\n${prompt}`;
}

export function previewPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

export function normalizeAgentContexts(
  contexts: AgentPromptContext[] | undefined
) {
  if (!contexts) return undefined;
  if (!Array.isArray(contexts)) {
    throw new Error("Agent contexts must be an array");
  }
  const normalized = contexts.map((context) => {
    if (
      context?.type !== "file" ||
      typeof context.path !== "string" ||
      !context.path.trim()
    ) {
      throw new Error("Invalid Agent file context");
    }
    return { type: "file" as const, path: context.path.trim() };
  });
  return normalized.length ? normalized : undefined;
}

export function createApprovalBudget() {
  let pending = 0;
  let started = 0;
  let waited = 0;
  const listeners = new Set<(paused: boolean) => void>();
  return {
    paused: () => pending > 0,
    pause() {
      if (pending++ === 0) { started = performance.now(); for (const listener of listeners) listener(true); }
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        if (--pending === 0) { waited += performance.now() - started; for (const listener of listeners) listener(false); }
      };
    },
    waitMs: () => waited + (pending > 0 ? performance.now() - started : 0),
    subscribe(listener: (paused: boolean) => void) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

export async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  cancel: () => Promise<void>,
  approval?: ReturnType<typeof createApprovalBudget>
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancellation: Promise<void> | undefined;
  let remaining = timeoutMs;
  let started = performance.now();
  let resumeTimer: (() => void) | undefined;
  const unsubscribe = approval?.subscribe((paused) => {
    if (paused) { if (timer) { clearTimeout(timer); timer = undefined; remaining -= performance.now() - started; } }
    else resumeTimer?.();
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    resumeTimer = () => {
      started = performance.now();
      timer = setTimeout(() => {
        cancellation = cancel();
        reject(new Error(`Agent run exceeded ${timeoutMs} ms`));
      }, Math.max(0, remaining));
    };
    if (!approval?.paused()) resumeTimer();
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (cancellation) await cancellation;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe?.();
  }
}

export function mergeFileChanges(
  workspaceChanges: AgentRun["fileChanges"] = [],
  runtimeChanges: AgentRun["fileChanges"] = []
) {
  const runtimeByFile = new Map(
    runtimeChanges.map((change) => [change.file, change])
  );
  const merged: AgentFileChange[] = workspaceChanges.map((change) => ({
    ...change,
    patch: runtimeByFile.get(change.file)?.patch
  }));
  const workspacePaths = new Set(workspaceChanges.map((change) => change.file));
  merged.push(
    ...runtimeChanges.filter((change) => !workspacePaths.has(change.file))
  );
  return merged;
}
