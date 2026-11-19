import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRecord, ProjectParticipant } from "@simplercp/shared";
import WebSocket from "ws";
import { createApp } from "../createApp.js";
import { getProjectMetadataPath } from "../projects.js";
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

  it("expires a suggest-mode approval so the terminal can accept the next command", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("suggest-timeout-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "suggest", guardApprovalTimeoutMs: 80 });
    const student = await joinMember(running.origin, "demo", { name: "Student", role: "student" });
    const runtime = running.app.locals.runtimeManager.get("demo");
    const result = await runtime.guard.submit({
      projectId: "demo",
      memberId: student.member.id,
      source: "terminal",
      kind: "command",
      command: "rm a.txt",
      cwd: runtime.project.workspacePath
    });
    expect(result).toMatchObject({ approved: false, decision: { action: "ask", outcome: "timeout" } });
    expect(runtime.guard.pending()).toHaveLength(0);
    const nextResult = await runtime.guard.submit({
      projectId: "demo",
      memberId: student.member.id,
      source: "terminal",
      kind: "command",
      command: "ls",
      cwd: runtime.project.workspacePath
    });
    expect(nextResult).toMatchObject({ approved: true, decision: { action: "allow", outcome: "allowed" } });
  });

  it("judges a script by its content and by the level of its last writer", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("script-provenance-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off", guardApprovalTimeoutMs: 80 });
    const owner = await joinMember(running.origin, "demo", { name: "Owner", role: "owner" });
    const student = await joinMember(running.origin, "demo", { name: "Student", role: "student" });
    const runtime = running.app.locals.runtimeManager.get("demo");
    const request = (memberId: string, command: string) => ({ projectId: "demo", memberId, source: "terminal" as const, kind: "command" as const, command, cwd: runtime.project.workspacePath });
    const written = await runtime.guard.submit(request(student.member.id, "printf 'rm -rf src' > fix.sh"));
    expect(written).toMatchObject({ approved: true, decision: { action: "allow_snapshot" } });
    await fs.writeFile(path.join(runtime.project.workspacePath, "fix.sh"), "rm -rf src\n");
    const byOwner = await runtime.guard.submit(request(owner.member.id, "bash fix.sh"));
    expect(byOwner).toMatchObject({ approved: false, decision: { action: "ask", approvers: "owners", outcome: "timeout" } });
    expect(byOwner.decision.matchedRules).toEqual(expect.arrayContaining(["script.writer.contributor", "script.role.contributor.delete"]));
    await fs.writeFile(path.join(runtime.project.workspacePath, "own.sh"), "rm -rf src\n");
    expect(await runtime.guard.submit(request(owner.member.id, "bash own.sh"))).toMatchObject({ approved: true, decision: { action: "allow" } });
    expect(await runtime.guard.submit(request(owner.member.id, "touch .env"))).toMatchObject({ approved: true, decision: { action: "allow_snapshot", matchedRules: expect.arrayContaining(["owner.self-command"]) } });
    expect(await runtime.guard.submit({ ...request(owner.member.id, "touch .env"), source: "agent" })).toMatchObject({ approved: false });
    expect(await runtime.guard.submit(request(owner.member.id, "ls $SIMPLERCP_DATA_DIR"))).toMatchObject({ approved: false, decision: { action: "deny" } });
    await runtime.guard.awaitIdle();
    const auditPath = path.join(getProjectMetadataPath(runtime.project), "guard-audit.jsonl");
    expect(await fs.readFile(auditPath, "utf8")).toContain('"stage":"owner-self"');
  });

  it("routes pending approvals using current online membership and delegate levels", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("delegate-routing-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off", guardApprovalTimeoutMs: 2_000 });
    const owner = await joinMember(running.origin, "demo", { name: "Alice", role: "owner" });
    const requester = await joinMember(running.origin, "demo", { name: "Bob", role: "contributor" });
    const delegate = await joinMember(running.origin, "demo", { name: "Carol", role: "contributor", connectionId: "delegate-tab" });
    const memberStore = running.app.locals.members;
    const runtime = running.app.locals.runtimeManager.get("demo");
    const route = `/members/${delegate.member.id}/delegate-approver`;
    const designate = (actor: typeof owner, endpoint: string) => actor.request(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect((await designate(requester, route)).status).toBe(403);
    expect((await designate(owner, route)).status).toBe(200);
    expect((await designate(owner, `/members/${requester.member.id}/delegate-approver`)).status).toBe(200);
    expect((await requester.request(`/members/${delegate.member.id}`, { method: "DELETE" })).status).toBe(403);
    await memberStore.changeRole("demo", { actorId: owner.member.id, targetId: delegate.member.id, role: "maintainer" });
    const request = { projectId: "demo", memberId: requester.member.id, source: "terminal" as const, kind: "command" as const, command: "rm note.txt", cwd: runtime.project.workspacePath };
    const pending = runtime.guard.submit(request);
    await vi.waitFor(() => expect(runtime.guard.pending()).toHaveLength(1));
    const id = runtime.guard.pending()[0]!.id;
    expect((await runtime.guard.pendingFor(owner.member.id))[0]?.approverIds).toEqual([owner.member.id]);
    expect(await runtime.guard.pendingFor(delegate.member.id)).toEqual([]);
    expect(await runtime.guard.approve(id, delegate.member.id)).toBe(false);
    runtime.rooms.markOffline(runtime.room.id, owner.member.id);
    expect(await runtime.guard.approve(id, requester.member.id)).toBe(false);
    expect(await runtime.guard.approve(id, "team-agent")).toBe(false);
    expect((await runtime.guard.pendingFor(delegate.member.id))[0]?.approverIds).toEqual([delegate.member.id]);
    await memberStore.changeRole("demo", { actorId: owner.member.id, targetId: delegate.member.id, role: "contributor" });
    expect(await runtime.guard.approve(id, delegate.member.id)).toBe(false);
    expect(await runtime.guard.pendingFor(delegate.member.id)).toEqual([]);
    runtime.rooms.markConnectionOffline(runtime.room.id, "delegate-tab");
    await memberStore.changeRole("demo", { actorId: owner.member.id, targetId: delegate.member.id, role: "maintainer" });
    expect(await runtime.guard.approve(id, delegate.member.id)).toBe(false);
    runtime.rooms.markConnectionOnline(runtime.room.id, "delegate-tab");
    expect(await runtime.guard.approve(id, delegate.member.id)).toBe(true);
    expect((await pending).approved).toBe(true);
    runtime.rooms.markConnectionOffline(runtime.room.id, "delegate-tab");
    const noOnlineApprover = await runtime.guard.submit(request, { timeoutMs: 30 });
    expect(noOnlineApprover).toMatchObject({ approved: false, decision: { outcome: "timeout" } });
    const waitingForDelegate = runtime.guard.submit(request);
    await vi.waitFor(() => expect(runtime.guard.pending()[0]?.noApprover).toBe(true));
    runtime.rooms.markConnectionOnline(runtime.room.id, "delegate-tab");
    expect(await runtime.guard.approve(runtime.guard.pending()[0]!.id, delegate.member.id)).toBe(true);
    expect((await waitingForDelegate).approved).toBe(true);
    const ceiling = runtime.guard.submit({ ...request, memberId: owner.member.id, source: "agent", command: "kill 123", agentRunId: "owner-run" });
    runtime.rooms.markOnline(runtime.room.id, owner.member.id);
    await vi.waitFor(() => expect(runtime.guard.pending()).toHaveLength(1));
    const ceilingId = runtime.guard.pending()[0]!.id;
    expect((await runtime.guard.pendingFor(owner.member.id))[0]?.approverIds).toEqual([owner.member.id]);
    expect(await runtime.guard.approve(ceilingId, owner.member.id)).toBe(true);
    expect((await ceiling).approved).toBe(true);
    await runtime.guard.awaitIdle();
    const auditPath = path.join(getProjectMetadataPath(runtime.project), "guard-audit.jsonl");
    const audit = (await fs.readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "approval", source: "terminal", approver: delegate.member.id, approverRole: "delegate", result: "approved" }),
      expect.objectContaining({ stage: "approval", source: "terminal", memberId: requester.member.id, result: "timeout" }),
      expect.objectContaining({ stage: "approval", source: "agent", agentRunId: "owner-run", approver: owner.member.id, approverRole: "trigger", result: "approved" })
    ]));
    expect((await owner.request(`/members/${delegate.member.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await runtime.guard.pendingFor(delegate.member.id)).toEqual([]);
  });

  it("requires owner review after an agent reads a contributor's file or discussion message", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("agent-source-level-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off" });
    const alice = (await joinMember(running.origin, "demo", { name: "Alice", role: "owner" })).member;
    const bob = (await joinMember(running.origin, "demo", { name: "Bob", role: "contributor" })).member;
    const runtime = running.app.locals.runtimeManager.get("demo");
    const cwd = runtime.project.workspacePath;
    const base = { projectId: "demo", cwd, memberId: alice.id };
    const deletion = { ...base, source: "agent" as const, kind: "command" as const, command: "rm note.txt" };
    await fs.writeFile(path.join(cwd, "note.txt"), "Project note\n");
    await fs.writeFile(path.join(cwd, "alice.txt"), "Alice's note\n");
    await fs.writeFile(path.join(cwd, "bob.txt"), "Bob's note\n");
    await fs.writeFile(path.join(cwd, "editor-note.txt"), "Edited collaboratively\n");
    await runtime.guard.recordWorkspaceWrite(bob.id, "editor-note.txt");
    const edit = { ...base, source: "terminal" as const, kind: "edit" as const };
    expect((await runtime.guard.submit({ ...edit, paths: ["alice.txt"] })).approved).toBe(true);
    expect((await runtime.guard.submit({ ...edit, memberId: bob.id, paths: ["bob.txt"] })).approved).toBe(true);
    for (const [filename, expected] of [["alice.txt", "allow"], ["bob.txt", "ask"], ["editor-note.txt", "ask"]] as const) {
      const agentRunId = `read-${filename}`;
      const read = { ...base, source: "agent" as const, agentRunId, kind: "read" as const, paths: [filename] };
      expect((await runtime.guard.submit(read)).approved).toBe(true);
      expect((await runtime.guard.decide({ ...deletion, agentRunId })).action).toBe(expected);
    }
    for (const command of ["cat bob.txt", "head bob.txt", "sed -n '1,2p' -- 'bob.txt' alice.txt"]) {
      const agentRunId = `read-${command}`;
      expect((await runtime.guard.submit({ ...deletion, agentRunId, command })).approved).toBe(true);
      expect(await runtime.guard.decide({ ...deletion, agentRunId })).toMatchObject({ action: "ask", sourceLevel: "contributor" });
    }
    await runtime.guard.recordPromptSources("attached-file", alice.id, ["bob.txt"], []);
    expect(await runtime.guard.decide({ ...deletion, agentRunId: "attached-file" })).toMatchObject({ action: "ask", sourceLevel: "contributor" });
    const agentRunId = "team-discussion";
    await runtime.guard.recordPromptSources(agentRunId, alice.id, [], [{ id: bob.id, role: "contributor" }]);
    const pending = runtime.guard.submit({ ...deletion, agentRunId, sessionScope: "team" });
    await vi.waitFor(() => expect(runtime.guard.pending()).toHaveLength(1));
    const [card] = await runtime.guard.pendingFor(alice.id);
    expect(card).toMatchObject({ decision: { action: "ask", sourceLevel: "contributor", matchedRules: expect.arrayContaining(["agent.provenance.contributor"]) } });
    expect(await runtime.guard.approve(card!.id, alice.id)).toBe(true);
    expect((await pending).approved).toBe(true);
    expect((await runtime.guard.decide({ ...deletion, source: "terminal", agentRunId })).action).toBe("allow");
    await runtime.guard.awaitIdle();
    const auditPath = path.join(getProjectMetadataPath(runtime.project), "guard-audit.jsonl");
    const audit = (await fs.readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(audit).toContainEqual(expect.objectContaining({
      stage: "approval", source: "team", sourceLevel: "contributor", agentRunId, memberId: alice.id,
      matchedRules: expect.arrayContaining(["agent.provenance.contributor"]), action: "ask", approver: alice.id, approverRole: "trigger", result: "approved"
    }));
  });

  it("reuses approval without changing the rule decision and takes a snapshot before the repeated command", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("remembered-command-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off", guardApprovalTimeoutMs: 2_000 });
    const owner = (await joinMember(running.origin, "demo", { name: "Alice", role: "owner" })).member;
    const requester = (await joinMember(running.origin, "demo", { name: "Bob", role: "contributor" })).member;
    const memberStore = running.app.locals.members;
    await memberStore.changeRole("demo", { actorId: owner.id, targetId: requester.id, role: "maintainer" });
    const runtime = running.app.locals.runtimeManager.get("demo");
    const cwd = runtime.project.workspacePath;
    await fs.writeFile(path.join(cwd, "check.js"), "console.log(eval('1'));\n");
    const command = "node check.js > result.txt";
    const request = { projectId: "demo", memberId: requester.id, source: "terminal" as const, kind: "command" as const, command, cwd };
    const decideBeforeApproval = await runtime.guard.decide(request);
    expect(decideBeforeApproval.action).toBe("ask");
    const pending = runtime.guard.submit(request);
    await vi.waitFor(() => expect(runtime.guard.pending()).toHaveLength(1));
    expect(await runtime.guard.approve(runtime.guard.pending()[0]!.id, owner.id)).toBe(true);
    expect((await pending).approved).toBe(true);
    expect(await runtime.guard.decide(request)).toEqual(decideBeforeApproval);
    await runtime.guard.setControl(requester.id, owner.id);
    const terminal = new WebSocket(`${running.origin.replace("http", "ws")}/terminal?projectId=demo&memberId=${requester.id}`);
    try {
      await opened(terminal);
      await vi.waitFor(() => {
        const foreground = runtime.terminal.foregroundProcess();
        expect(foreground && runtime.terminal.isShellProcess(foreground)).toBe(true);
      }, { timeout: 2_000 });
      const reply = nextMessageMatching(terminal, (message) => message.type === "guard_decision" && message.command === command);
      terminal.send(JSON.stringify({ type: "command", text: command }));
      await expect(reply).resolves.toMatchObject({ action: "allow_snapshot", outcome: "approved", snapshotId: expect.any(String) });
      await vi.waitFor(async () => expect(await fs.readFile(path.join(cwd, "result.txt"), "utf8")).toBe("1\n"));
    } finally {
      terminal.terminate();
    }
    await runtime.guard.awaitIdle();
    const auditPath = path.join(getProjectMetadataPath(runtime.project), "guard-audit.jsonl");
    const audit = (await fs.readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(audit.find((record) => record.stage === "remembered")).toMatchObject({ approver: owner.id, approverRole: "owner", approvedAt: expect.any(String), source: "terminal" });
    expect(audit.find((record) => record.stage === "approval")).toMatchObject({ approver: owner.id, approverRole: "owner", approvedAt: expect.any(String), result: "approved" });
    await memberStore.changeRole("demo", { actorId: owner.id, targetId: requester.id, role: "contributor" });
    const afterDemotion = runtime.guard.submit(request);
    await vi.waitFor(() => expect(runtime.guard.pending()).toHaveLength(1));
    expect(await runtime.guard.reject(runtime.guard.pending()[0]!.id, owner.id)).toBe(true);
    expect((await afterDemotion).approved).toBe(false);
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
      await vi.waitFor(() => {
        const terminal = running.app.locals.runtimeManager.get("demo").terminal;
        const foreground = terminal.foregroundProcess();
        expect(foreground && terminal.isShellProcess(foreground)).toBe(true);
      }, { timeout: 2_000 });
      ownerTerminal.send(JSON.stringify({ type: "command", text: "vim" }));
      await expect(nextMessageMatching(ownerTerminal, (message) => message.type === "guard_decision" && message.command === "vim")).resolves.toMatchObject({ type: "guard_decision", action: "allow", outcome: "allowed", command: "vim" });
    } finally {
      ownerTerminal.terminate();
    }
  });
  it("lets only an owner raise a member's role once the project has an owner", async () => {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
    root = await createTestWorkspace("role-escalation-");
    running = await startServer(root, { guardMode: "full", guardLlmMode: "off" });
    const patchRole = (memberId: string, endpoint: string, role: string) => fetch(`${running.origin}/api/projects/demo${endpoint}`, {
      method: "PATCH", headers: memberHeaders(memberId), body: JSON.stringify({ role })
    });
    const storedRole = async (memberId: string) => (await running.app.locals.members.getMember("demo", memberId))?.role;

    const lead = await joinMember(running.origin, "demo", { name: "Lead", role: "lead" });
    const newcomer = await joinMember(running.origin, "demo", { name: "Newcomer", role: "newcomer" });
    const latecomer = await joinMember(running.origin, "demo", { name: "Latecomer", role: "teacher" });
    expect(lead.member.profileRole).toBe("lead");
    expect(latecomer.member.profileRole).toBeUndefined();

    const selfRaise = await patchRole(newcomer.member.id, "/me", "lead");
    expect(selfRaise.status).toBe(403);
    expect(await storedRole(newcomer.member.id)).toBe("newcomer");
    const rejoin = await joinMember(running.origin, "demo", { name: "Newcomer", memberId: newcomer.member.id, role: "maintainer" });
    expect(rejoin.member.profileRole).toBe("newcomer");
    const peerGrant = await patchRole(newcomer.member.id, `/members/${latecomer.member.id}/role`, "maintainer");
    expect(peerGrant.status).toBe(403);

    expect((await patchRole(newcomer.member.id, "/me", "viewer")).status).toBe(200);
    expect(await storedRole(newcomer.member.id)).toBe("viewer");
    const grant = await patchRole(lead.member.id, `/members/${newcomer.member.id}/role`, "maintainer");
    expect(grant.status).toBe(200);
    expect(await storedRole(newcomer.member.id)).toBe("maintainer");
    const room = running.app.locals.runtimeManager.get("demo").room;
    expect(room.members.find((member: { id: string }) => member.id === newcomer.member.id)?.profileRole).toBe("maintainer");
    expect((await patchRole(lead.member.id, "/members/unknown/role", "viewer")).status).toBe(404);
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
