import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRuntime } from "./agentRuntime.js";
import { OpenCodeEmptyResponseError } from "./openCodeRuntime.js";

export function createTestAgentRuntime(real: AgentRuntime, fake: AgentRuntime, realKeyConfigured: boolean): AgentRuntime {
  const modes = new Map<string, "real" | "fake">();
  const permissionModes = new Map<string, AgentRuntime>();
  const runtimeFor = (sessionId: string) => modes.get(sessionId) === "fake" ? fake : real;
  const usesFake = (value: string) => /fake-(?:delay|write|reply|permission)=/.test(value);

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
      modes.set(input.sessionId, usesFake(input.runPrompt) ? "fake" : "real");
    },
    async createSession(input) {
      const mode = usesFake(input.title) ? "fake" : "real";
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
    replyPermission(input) {
      const runtime = permissionModes.get(input.requestId) ?? real;
      permissionModes.delete(input.requestId);
      return runtime.replyPermission(input);
    },
    cancel(input) {
      return runtimeFor(input.sessionId).cancel(input);
    },
    subscribe(input, listener) {
      const runtime = runtimeFor(input.sessionId);
      return runtime.subscribe(input, async (event) => {
        if (!eventBelongsToSession(event, input.sessionId)) return;
        if (event.type === "permission.asked" || event.type === "permission.v2.asked") {
          const envelope = event.data as { id?: unknown; data?: { id?: unknown } };
          const requestId = envelope.id ?? envelope.data?.id;
          if (typeof requestId === "string") permissionModes.set(requestId, runtime);
        }
        await listener(event);
      });
    },
    async dispose() {
      await Promise.all([real.dispose(), fake.dispose()]);
      permissionModes.clear();
    }
  };
}

function eventBelongsToSession(event: { data: unknown }, sessionId: string) {
  const properties = event.data as {
    sessionID?: unknown;
    info?: { sessionID?: unknown };
    part?: { sessionID?: unknown };
    data?: { sessionID?: unknown };
  };
  return (
    properties.sessionID === sessionId ||
    properties.info?.sessionID === sessionId ||
    properties.part?.sessionID === sessionId ||
    properties.data?.sessionID === sessionId
  );
}

export function createFakeAgentRuntime(): AgentRuntime {
  const abortControllers = new Map<string, AbortController>();
  const listeners = new Map<string, Set<(event: { type: string; data: Record<string, unknown> }) => void | Promise<void>>>();
  const permissionWaiters = new Map<string, { resolve: (reply: "once" | "reject") => void; reply404: boolean; sessionId: string; invalidatePeer?: string }>();
  const blockedSessions = new Set<string>();
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
      const permissionMarker = input.prompt.match(/fake-permission=(bash|edit|v2|sub-session|multi)/)?.[1];
      if (permissionMarker) {
        const requests = permissionMarker === "multi"
          ? [
              { id: `fake-permission-${input.sessionId}-first`, command: "rm first.txt" },
              { id: `fake-permission-${input.sessionId}-second`, command: "rm second.txt" }
            ]
          : [{ id: `fake-permission-${input.sessionId}`, command: permissionMarker === "edit" ? undefined : "rm fake-agent.txt" }];
        const replies = requests.map((request) => new Promise<"once" | "reject">((resolve) => {
          permissionWaiters.set(request.id, {
            resolve,
            reply404: input.prompt.includes("fake-reply-404"),
            sessionId: input.sessionId,
            invalidatePeer: permissionMarker === "multi" && request.id.endsWith("-first") ? requests[1]?.id : undefined
          });
        }));
        for (const [index, request] of requests.entries()) {
          const permission = permissionMarker === "edit" ? "edit" : "bash";
          const metadata = permissionMarker === "edit"
            ? { filepath: "src/fake-agent.ts", files: [{ movePath: ".env" }] }
            : { command: request.command };
          const eventType = permissionMarker === "v2" ? "permission.v2.asked" : "permission.asked";
          const sessionID = permissionMarker === "sub-session" ? "sub-session" : input.sessionId;
          await emit(eventType, { id: request.id, permission, sessionID, metadata });
          if (permissionMarker !== "multi" && sessionID === input.sessionId && await replies[index]! === "reject") {
            throw new Error("Fake Agent permission was rejected");
          }
        }
        if (permissionMarker === "multi") {
          const resolved = await Promise.all(replies);
          if (blockedSessions.has(input.sessionId)) throw new OpenCodeEmptyResponseError();
          if (resolved.some((reply) => reply === "reject")) throw new OpenCodeEmptyResponseError();
        }
      }
      const writePath = [...input.prompt.matchAll(/fake-write=([^\s]+)/g)].at(-1)?.[1];
      if (writePath) {
        const absolutePath = path.resolve(input.workspacePath, writePath);
        if (!absolutePath.startsWith(`${path.resolve(input.workspacePath)}${path.sep}`)) {
          throw new Error("Fake Agent write path must stay inside the project workspace");
        }
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, `Written by fake Agent for ${input.sessionId}\n`);
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
      return { text, messageId: `fake-message-${input.sessionId}` };
    },
    async getDiff() {
      return [];
    },
    async replyPermission(input) {
      const pending = permissionWaiters.get(input.requestId);
      if (!pending) throw new Error("Permission request not found");
      permissionWaiters.delete(input.requestId);
      pending.resolve(input.reply);
      if (input.reply === "reject" && pending.invalidatePeer) {
        const peer = permissionWaiters.get(pending.invalidatePeer);
        if (peer) {
          permissionWaiters.delete(pending.invalidatePeer);
          peer.resolve("reject");
          blockedSessions.add(pending.sessionId);
        }
      }
      if (pending.reply404) throw new Error("Permission endpoint returned 404");
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
      for (const pending of permissionWaiters.values()) pending.resolve("reject");
      permissionWaiters.clear();
      blockedSessions.clear();
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
