import type {
  AgentFileChange,
  AgentPromptContext,
  AgentRun
} from "@simplercp/shared";
import { readWorkspaceFile } from "../workspace.js";

export async function buildRuntimePrompt(
  workspacePath: string,
  prompt: string,
  contexts: AgentPromptContext[] | undefined
) {
  if (!contexts || contexts.length === 0) return prompt;
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
  return `Relevant project files:\n${sections.join("\n")}\n\nUser request:\n${prompt}`;
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

export async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  cancel: () => Promise<void>
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancellation: Promise<void> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancellation = cancel();
      reject(new Error(`Agent run exceeded ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (cancellation) await cancellation;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
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
