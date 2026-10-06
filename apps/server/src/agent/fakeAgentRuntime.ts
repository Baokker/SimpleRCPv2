import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRuntime } from "./agentRuntime.js";

export function createTestAgentRuntime(real: AgentRuntime, fake: AgentRuntime, realKeyConfigured: boolean): AgentRuntime {
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
      return real.prepareWorkspace?.(workspacePath) ?? false;
    },
    async prepareRun(input) {
      modes.set(input.sessionId, /fake-(?:delay|write|reply|edit|tool)=/.test(input.runPrompt) ? "fake" : "real");
    },
    async createSession(input) {
      const mode = /fake-(?:delay|write|reply|edit|tool)=/.test(input.title) ? "fake" : "real";
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
    subscribe(input, listener) {
      return runtimeFor(input.sessionId).subscribe(input, listener);
    },
    async dispose() {
      await Promise.all([real.dispose(), fake.dispose()]);
    }
  };
}

export function createFakeAgentRuntime(): AgentRuntime {
  const abortControllers = new Map<string, AbortController>();
  const listeners = new Map<string, Set<(event: { type: string; data: Record<string, unknown> }) => void | Promise<void>>>();
  let nextSessionId = 0;

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
    async run(input) {
      const controller = new AbortController();
      abortControllers.set(input.sessionId, controller);
      const emit = async (type: string, data: Record<string, unknown>) => {
        for (const listener of listeners.get(input.sessionId) ?? []) {
          await listener({ type, data });
        }
      };
      await emit("fake.started", { prompt: input.prompt });
      const writePath = [...input.prompt.matchAll(/fake-write=([^\s]+)/g)].at(-1)?.[1];
      if (writePath) {
        const absolutePath = path.resolve(input.workspacePath, writePath);
        if (!absolutePath.startsWith(`${path.resolve(input.workspacePath)}${path.sep}`)) {
          throw new Error("Fake Agent write path must stay inside the project workspace");
        }
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, `Written by fake Agent for ${input.sessionId}\n`);
      }
      for (const match of input.prompt.matchAll(/fake-edit=([^\s:]+):(\d+):([\s\S]*?)(?=\s+fake-(?:write|edit|tool|delay|reply)=|$)/g)) {
        const editPath = path.resolve(input.workspacePath, match[1]!);
        if (!editPath.startsWith(`${path.resolve(input.workspacePath)}${path.sep}`)) throw new Error("Fake Agent edit path must stay inside the project workspace");
        const line = Number(match[2]);
        if (!Number.isInteger(line) || line < 1) throw new Error("Fake Agent edit line is invalid");
        const content = await fs.readFile(editPath, "utf8");
        const lines = content.split("\n");
        lines.splice(Math.min(line - 1, lines.length), 0, match[3]!);
        await fs.writeFile(editPath, lines.join("\n"));
      }
      for (const match of input.prompt.matchAll(/fake-tool=(ok|fail):([\s\S]*?)(?=\s+fake-(?:write|edit|tool|delay|reply)=|$)/g)) {
        const success = match[1] === "ok";
        await emit("message.part.updated", {
          part: {
            type: "tool",
            tool: "bash",
            state: success
              ? { status: "completed", input: { command: match[2] }, output: "", metadata: { exitCode: 0 } }
              : { status: "error", input: { command: match[2] }, error: "command failed", metadata: { exitCode: 1 } }
          }
        });
      }
      const delayMs = Number([...input.prompt.matchAll(/fake-delay=(\d+)/g)].at(-1)?.[1] ?? 0);
      try {
        await wait(delayMs, controller.signal);
      } finally {
        if (abortControllers.get(input.sessionId) === controller) {
          abortControllers.delete(input.sessionId);
        }
      }
      const text = [...input.prompt.matchAll(/fake-reply=([^\n]+)/g)].at(-1)?.[1]?.trim()
        ?? `Fake Agent completed: ${input.prompt}`;
      await emit("fake.completed", { text });
      return { text, messageId: `fake-message-${input.sessionId}`, usage: { inputTokens: 120, outputTokens: 48, reasoningTokens: 12, cacheReadTokens: 8, cacheWriteTokens: 0, totalTokens: 180, cost: 0.0018 } };
    },
    async getDiff() {
      return [];
    },
    async cancel(input) {
      abortControllers.get(input.sessionId)?.abort();
    },
    async subscribe(input, listener) {
      const sessionListeners = listeners.get(input.sessionId) ?? new Set();
      sessionListeners.add(listener);
      listeners.set(input.sessionId, sessionListeners);
      return async () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) listeners.delete(input.sessionId);
      };
    },
    async dispose() {
      for (const controller of abortControllers.values()) controller.abort();
      abortControllers.clear();
      listeners.clear();
    }
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
