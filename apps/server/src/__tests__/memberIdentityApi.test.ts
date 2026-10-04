import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRecord, ProjectParticipant } from "@simplercp/shared";
import WebSocket from "ws";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { joinMember, memberHeaders } from "./memberTestHelper.js";

let root: string;
let running: Awaited<ReturnType<typeof startServer>>;

beforeEach(async () => {
  root = await createTestWorkspace("member-api-");
  running = await startServer(root);
});

afterEach(async () => {
  await running.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("member identity API", () => {
  it("assigns UUIDs, resumes members and preserves or updates their role", async () => {
    const first = await joinMember(running.origin, "demo", { name: "Ada", role: "student" });
    expect(first.member.id).toMatch(/^[a-f0-9-]{36}$/);
    const resumed = await joinMember(running.origin, "demo", { name: "Ada Updated", memberId: first.member.id });
    expect(resumed.member.id).toBe(first.member.id);
    expect(resumed.member.profileRole).toBe("student");
    const updated = await joinMember(running.origin, "demo", { name: "Ada", memberId: first.member.id, role: "reviewer" });
    expect(updated.member).toMatchObject({ id: first.member.id, profileRole: "reviewer" });
    const empty = await joinMember(running.origin, "demo", { name: "Ada", memberId: first.member.id, role: "" });
    expect(empty.member.profileRole).toBeUndefined();
    const unknown = await joinMember(running.origin, "demo", { name: "Bob", memberId: "client-chosen-id" });
    expect(unknown.member.id).not.toBe("client-chosen-id");
    expect(unknown.member.id).not.toBe(first.member.id);
    const participants = await fetch(`${running.origin}/api/projects/demo/participants`).then((response) => response.json()) as { participants: ProjectParticipant[] };
    expect(participants.participants).toHaveLength(2);
    expect(participants.participants[0]).toMatchObject({ id: first.member.id, displayName: "Ada" });
    const file = JSON.parse(await fs.readFile(path.join(root, "data/projects/demo/members.json"), "utf8"));
    expect(file.members.map((member: { role: string }) => member.role)).toEqual(["", ""]);
  });

  it("rejects missing, unknown and foreign-project headers while loading files for members", async () => {
    const member = await joinMember(running.origin, "demo", { name: "Ada" });
    const created = await fetch(`${running.origin}/api/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Other" })
    }).then((response) => response.json()) as { project: { id: string } };
    for (const headers of [{}, memberHeaders("unknown"), member.headers]) {
      const response = await fetch(`${running.origin}/api/projects/${created.project.id}/workspace/directory`, { headers });
      expect(response.status).toBe(401);
    }
    const response = await member.request("/workspace/directory");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tree: [{ name: "README.md" }] });
  });

  it.each(["/ws?projectId=demo", "/yjs/demo/room%3AREADME.md", "/terminal?projectId=demo"])("rejects unknown member on %s", async (endpoint) => {
    const separator = endpoint.includes("?") ? "&" : "?";
    const socket = new WebSocket(`${running.origin.replace("http", "ws")}${endpoint}${separator}memberId=unknown`);
    await expect(new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    })).rejects.toThrow();
    socket.terminate();
  });

  it("uses connection identity for broadcasts and aggregates terminal input without content", async () => {
    const first = await joinMember(running.origin, "demo", { name: "Ada", connectionId: "ada-tab" });
    const second = await joinMember(running.origin, "demo", { name: "Bob", connectionId: "bob-tab" });
    const room = running.app.locals.runtimeManager.get("demo").room;
    const presence = new WebSocket(`${running.origin.replace("http", "ws")}/ws?projectId=demo&memberId=${first.member.id}`);
    const terminal = new WebSocket(`${running.origin.replace("http", "ws")}/terminal?projectId=demo&memberId=${first.member.id}`);
    try {
      await Promise.all([opened(presence), opened(terminal)]);
      const message = nextMessage(presence);
      presence.send(JSON.stringify({ type: "cursor_change", roomId: room.id, memberId: second.member.id, connectionId: "ada-tab", path: "README.md", position: { lineNumber: 1, column: 1 } }));
      expect(await message).toMatchObject({ type: "cursor_change", memberId: first.member.id });
      const inputEvents: Array<{ memberId: string; data: string }> = [];
      const remove = running.app.locals.runtimeManager.get("demo").terminal.onInput((memberId: string, data: string) => inputEvents.push({ memberId, data }));
      terminal.send(JSON.stringify({ type: "input", data: "printf 'member-terminal-ok\\n'\n", memberId: second.member.id }));
      terminal.send(JSON.stringify({ type: "input", data: "\n" }));
      await vi.waitFor(() => expect(inputEvents).toHaveLength(2));
      expect(inputEvents.every((event) => event.memberId === first.member.id)).toBe(true);
      await vi.waitFor(() => expect(running.app.locals.runtimeManager.get("demo").events.list().filter((event: { type: string }) => event.type === "terminal_input")).toHaveLength(1), { timeout: 3_000 });
      const { events } = await first.request("/events").then((response) => response.json()) as { events: EventRecord[] };
      expect(events.find((event: { type: string }) => event.type === "terminal_input")).toMatchObject({ memberId: first.member.id, payload: { name: "Ada", count: 2 } });
      expect(JSON.stringify(events)).not.toContain("member-terminal-ok");
      remove();
    } finally {
      presence.terminate();
      terminal.terminate();
    }
  });

  it("rejects interactive commands before they can occupy the shared terminal", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("interactive-command-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off", guardApprovalTimeoutMs: 100 });
    const student = await joinMember(running.origin, "demo", { name: "Student", role: "student" });
    const terminal = new WebSocket(`${running.origin.replace("http", "ws")}/terminal?projectId=demo&memberId=${student.member.id}`);
    try {
      await opened(terminal);
      terminal.send(JSON.stringify({ type: "command", text: "vim" }));
      await expect(nextMessageMatching(terminal, (message) => message.type === "guard_decision" && message.command === "vim")).resolves.toMatchObject({
        type: "guard_decision",
        action: "deny",
        outcome: "denied",
        reason: "Interactive control is required before starting vim",
        command: "vim"
      });
      expect(running.app.locals.runtimeManager.get("demo").terminal.isShellProcess(running.app.locals.runtimeManager.get("demo").terminal.foregroundProcess()!)).toBe(true);
    } finally {
      terminal.terminate();
    }
  });

  it("keeps ordinary commands available and lets controlled users reach normal review", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("interactive-command-control-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off", guardApprovalTimeoutMs: 1_000 });
    const student = await joinMember(running.origin, "demo", { name: "Student", role: "student" });
    const studentTerminal = new WebSocket(`${running.origin.replace("http", "ws")}/terminal?projectId=demo&memberId=${student.member.id}`);
    try {
      await opened(studentTerminal);
      await vi.waitFor(() => {
        const terminal = running.app.locals.runtimeManager.get("demo").terminal;
        const foreground = terminal.foregroundProcess();
        expect(foreground && terminal.isShellProcess(foreground)).toBe(true);
      }, { timeout: 2_000 });
      studentTerminal.send(JSON.stringify({ type: "command", text: "ls" }));
      await expect(nextMessageMatching(studentTerminal, (message) => message.type === "guard_decision" && message.command === "ls")).resolves.toMatchObject({ type: "guard_decision", action: "allow", outcome: "allowed", command: "ls" });
    } finally {
      studentTerminal.terminate();
    }

    const owner = await joinMember(running.origin, "demo", { name: "Teacher", role: "teacher" });
    await running.app.locals.runtimeManager.get("demo").guard.setControl(owner.member.id, owner.member.id);
    const ownerTerminal = new WebSocket(`${running.origin.replace("http", "ws")}/terminal?projectId=demo&memberId=${owner.member.id}`);
    try {
      await opened(ownerTerminal);
      ownerTerminal.send(JSON.stringify({ type: "command", text: "vim" }));
      await expect(nextMessageMatching(ownerTerminal, (message) => message.type === "guard_decision" && message.command === "vim")).resolves.toMatchObject({ type: "guard_decision", action: "allow", outcome: "allowed", command: "vim" });
    } finally {
      ownerTerminal.terminate();
    }
  });
});

function opened(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("error", reject);
  });
}

function nextMessageMatching(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(message)) {
        socket.off("message", onMessage);
        resolve(message);
      }
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

async function startServer(directory: string, options: { guardMode?: "full" | "human-only" | "off"; guardLlmMode?: "off" | "suggest" | "auto"; guardApprovalTimeoutMs?: number } = {}) {
  const source = path.join(directory, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "README.md"), "# Member test\n");
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(directory, "data"), demoProjectRoot: source, ...options });
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address missing");
  return {
    app, origin: `http://127.0.0.1:${address.port}`,
    async close() {
      realtime.dispose();
      for (const sockets of [realtime.presence, realtime.documents, realtime.terminal]) {
        for (const client of sockets.clients) client.terminate();
        sockets.close();
      }
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
