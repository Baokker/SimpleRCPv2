import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFileChange } from "@simplercp/shared";
import type { AgentRuntime } from "./agentRuntime.js";
import { createPatch } from "diff";

export function createTestAgentRuntime(real: AgentRuntime, fake: AgentRuntime, realKeyConfigured: boolean, getConfiguredModel?: () => string): AgentRuntime {
  const modes = new Map<string, "real" | "fake">();
  const runtimeFor = (sessionId: string) => modes.get(sessionId) === "fake" ? fake : real;

  return {
    async status() {
      return {
        ...(await fake.status()),
        version: realKeyConfigured ? "test-runtime" : "fake"
      };
    },
    async prepareWorkspace(workspacePath) {
      return fake.prepareWorkspace?.(workspacePath) ?? false;
    },
    async prepareRun(input) {
      modes.set(input.sessionId, /fake-(?:delay|write|reply|edit|bash-edit|on-reject)=/.test(input.runPrompt) ? "fake" : "real");
    },
    async createSession(input) {
      const mode = /fake-(?:delay|write|reply|edit|bash-edit|on-reject)=/.test(input.title) ? "fake" : "real";
      const session = await (mode === "fake" ? fake : real).createSession(input);
      modes.set(session.id, mode);
      return session;
    },
    run(input) {
      return runtimeFor(input.sessionId).run(input);
    },
    getDiff(input) {
      return runtimeFor(input.sessionId).getDiff(input);
    },
    cancel(input) {
      return runtimeFor(input.sessionId).cancel(input);
    },
    async replyPermission(input) { await runtimeFor(input.sessionId).replyPermission?.(input); },
    subscribe(input, listener, onListenerError) {
      return runtimeFor(input.sessionId).subscribe(input, listener, onListenerError);
    },
    async dispose() {
      await Promise.all([real.dispose(), fake.dispose()]);
    },
    acquireRun() { return () => {}; },
    setActiveRunCount() {},
    getCurrentModel() {
      return getConfiguredModel?.() ?? real.getCurrentModel?.() ?? fake.getCurrentModel?.() ?? "fake-agent";
    }
  };
}

export function createFakeAgentRuntime(options: { editPermission?: "allow" | "ask" } = {}): AgentRuntime {
  const abortControllers = new Map<string, AbortController>();
  const listeners = new Map<string, Set<(event: { type: string; data: Record<string, unknown> }) => void | Promise<void>>>();
  const writtenFiles = new Set<string>();
  let nextSessionId = 0;
  let nextRequestId = 0;
  const permissions = new Map<string, { sessionId: string; resolve: (value: { reply: "once" | "reject"; message?: string }) => void }>();

  return {
    async status() {
      return {
        runtime: "opencode",
        state: "ready",
        version: "fake",
        model: "fake-agent",
        apiKeyConfigured: true
      };
    },
    async createSession() {
      nextSessionId += 1;
      return { id: `fake-session-${nextSessionId}` };
    },
    async prepareWorkspace(workspacePath) {
      const gitPath = path.join(workspacePath, ".git");
      try {
        await fs.stat(gitPath);
        return false;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        await fs.mkdir(gitPath, { recursive: true });
        return true;
      }
    },
    async run(input) {
      const controller = new AbortController();
      abortControllers.set(input.sessionId, controller);
      const emit = async (type: string, data: Record<string, unknown>) => {
        for (const listener of listeners.get(input.sessionId) ?? []) {
          await listener({ type, data });
        }
      };
      await emit("fake.started", { prompt: input.prompt });
      const bashEdit = [...input.prompt.matchAll(/fake-bash-edit=([^\s]+)/g)].at(-1)?.[1];
      const edit = [...input.prompt.matchAll(/fake-edit=([^\s]+)/g)].at(-1)?.[1] ?? bashEdit;
      const retry = [...input.prompt.matchAll(/fake-on-reject=([^\s]+)/g)].at(-1)?.[1];
      if (edit) {
        await wait(Number([...input.prompt.matchAll(/fake-before-edit=(\d+)/g)].at(-1)?.[1] ?? 0), controller.signal);
        const apply = async (declaration: string, bypass = false) => {
          const separator = declaration.indexOf(":");
          const arrow = declaration.indexOf("=>", separator + 1);
          if (separator < 1 || arrow < 0) throw new Error("Invalid fake-edit declaration");
          const file = declaration.slice(0, separator);
          const from = decodeURIComponent(declaration.slice(separator + 1, arrow));
          const to = decodeURIComponent(declaration.slice(arrow + 2));
          const absolute = path.resolve(input.workspacePath, file);
          if (!absolute.startsWith(`${path.resolve(input.workspacePath)}${path.sep}`)) throw new Error("Fake Agent edit path must stay inside the project workspace");
          let before: string;
          try { before = await fs.readFile(absolute, "utf8"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; before = ""; }
          if (from && !before.includes(from)) throw new Error("Fake Agent edit target is absent");
          const after = from ? before.replace(from, to) : before + to;
          const deleting = /fake-delete=true/.test(input.prompt);
          const requestId = `fake-permission-${++nextRequestId}`;
          if (options.editPermission === "ask" && !bypass) {
            const response = new Promise<{ reply: "once" | "reject"; message?: string }>((resolve) => permissions.set(requestId, { sessionId: input.sessionId, resolve }));
            await emit("permission.asked", { id: requestId, sessionID: input.sessionId, permission: "edit", patterns: [file], metadata: { filepath: absolute, diff: createPatch(absolute, before, after), ...(deleting ? { type: "delete" } : {}) }, always: ["*"], tool: { messageID: `fake-message-${input.sessionId}`, callID: requestId } });
            const result = await response;
            permissions.delete(requestId);
            if (result.reply === "reject") { await emit("fake.permission_rejected", { requestId, message: result.message }); return false; }
          }
          if (controller.signal.aborted) return false;
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          if (deleting) await fs.unlink(absolute);
          else await fs.writeFile(absolute, after);
          writtenFiles.add(file);
          await emit("message.part.updated", { part: { sessionID: input.sessionId, callID: requestId, messageID: `fake-message-${input.sessionId}`, type: "tool", tool: bypass ? "bash" : "edit", state: { status: "completed", input: bypass ? { command: "write workspace text" } : { filePath: absolute }, metadata: bypass ? {} : { filepath: absolute, diff: createPatch(absolute, before, after) } } } });
          return true;
        };
        if (!await apply(edit, edit === bashEdit) && retry && !controller.signal.aborted) await apply(retry);
        if (bashEdit && edit !== bashEdit && !controller.signal.aborted) await apply(bashEdit, true);
      }
      const writePath = [...input.prompt.matchAll(/fake-write=([^\s]+)/g)].at(-1)?.[1];
      if (writePath) {
        const absolutePath = path.resolve(input.workspacePath, writePath);
        if (!absolutePath.startsWith(`${path.resolve(input.workspacePath)}${path.sep}`)) {
          throw new Error("Fake Agent write path must stay inside the project workspace");
        }
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, `Written by fake Agent for ${input.sessionId}\n`);
        writtenFiles.add(writePath.split(path.sep).join("/"));
        await emit("message.part.updated", {
          part: {
            sessionID: input.sessionId,
            messageID: `fake-message-${input.sessionId}`,
            id: `fake-write-${input.sessionId}`,
            type: "tool",
            tool: "write",
            state: {
              status: "completed",
              input: { filePath: absolutePath }
            }
          }
        });
      }
      const delayMs = Number([...input.prompt.matchAll(/fake-delay=(\d+)/g)].at(-1)?.[1] ?? 0);
      try {
        await wait(delayMs, controller.signal);
        if (/fake-fail(?:\s|$)/.test(input.prompt)) throw new Error("Fake Agent failure");
      } finally {
        if (abortControllers.get(input.sessionId) === controller) {
          abortControllers.delete(input.sessionId);
        }
      }
      const text = [...input.prompt.matchAll(/fake-reply=([^\n]+)/g)].at(-1)?.[1]?.trim()
        ?? `Fake Agent completed: ${input.prompt}`;
      await emit("fake.completed", { text });
      return { text, messageId: `fake-message-${input.sessionId}` };
    },
    async getDiff(): Promise<AgentFileChange[]> {
      return [...writtenFiles].map((file) => ({ file, additions: 0, deletions: 0, status: "modified" }));
    },
    async cancel(input) {
      abortControllers.get(input.sessionId)?.abort();
      for (const permission of permissions.values()) if (permission.sessionId === input.sessionId) permission.resolve({ reply: "reject", message: "Run cancelled" });
    },
    async replyPermission(input) {
      const request = permissions.get(input.requestId);
      if (!request || request.sessionId !== input.sessionId) throw new Error("Permission request not found");
      request.resolve({ reply: input.reply, message: input.message });
    },
    async subscribe(input, listener, onListenerError) {
      const sessionListeners = listeners.get(input.sessionId) ?? new Set();
      const safeListener = async (event: { type: string; data: Record<string, unknown> }) => {
        try {
          await listener(event);
        } catch (error) {
          try {
            await onListenerError?.(error);
          } catch (reportError) {
            console.error("Fake Agent listener error reporting failed", reportError);
          }
        }
      };
      sessionListeners.add(safeListener);
      listeners.set(input.sessionId, sessionListeners);
      return async () => {
        sessionListeners.delete(safeListener);
        if (sessionListeners.size === 0) listeners.delete(input.sessionId);
      };
    },
    async dispose() {
      for (const controller of abortControllers.values()) controller.abort();
      abortControllers.clear();
      listeners.clear();
      writtenFiles.clear();
      for (const permission of permissions.values()) permission.resolve({ reply: "reject", message: "Runtime disposed" });
      permissions.clear();
    },
    setActiveRunCount() {},
    getCurrentModel() { return "fake-agent"; }
  };
}

function wait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Fake Agent run cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Fake Agent run cancelled"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
