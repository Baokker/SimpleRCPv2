import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandClass, createApprovalMemory, isReusable } from "../guard/approvalMemory.js";
import { decide } from "../guard/decide.js";
import type { GuardContext, GuardRequest, Level } from "../guard/types.js";

const workspaceRoot = path.join(os.tmpdir(), "approval-memory-workspace");
const context = (memberLevel: Level): GuardContext => ({
  memberLevel,
  initiatorOnline: true,
  workspaceRoot,
  platformDataRoot: path.join(os.tmpdir(), "approval-memory-platform")
});
const request = (command: string, overrides: Partial<GuardRequest> = {}): GuardRequest => ({
  projectId: "p1",
  memberId: "bob",
  source: "agent",
  agentRunId: "run-1",
  kind: "command",
  command,
  cwd: workspaceRoot,
  ...overrides
});

describe("approval memory command classes", () => {
  it("treats read-only output filters and output redirection as the same command", () => {
    expect(commandClass("npm test")).toBe("npm test");
    expect(commandClass("npm test 2>&1")).toBe("npm test");
    expect(commandClass("npm test 2>&1 | tail -20")).toBe("npm test");
    expect(commandClass("npm test 2>&1 | grep -E \"^ℹ (pass|fail)\" | tr '\\n' ' '")).toBe("npm test");
    expect(commandClass("npm   test >/dev/null")).toBe("npm test");
  });

  it("does not merge chained commands, substitutions or writes to files", () => {
    expect(commandClass("npm test; rm -rf dist")).toBeUndefined();
    expect(commandClass("npm test && git push")).toBeUndefined();
    expect(commandClass("npm test | sh")).toBeUndefined();
    expect(commandClass("npm test > /tmp/out.txt")).toBeUndefined();
    expect(commandClass("echo $(cat .env)")).toBeUndefined();
    expect(commandClass("npm run build")).not.toBe(commandClass("npm test"));
  });
});

describe("approval memory reuse", () => {
  it("asks once for the same command class from the same requester", () => {
    const memory = createApprovalMemory();
    const first = request("npm test 2>&1");
    const firstDecision = { ...decide(first, context("collaborator")), action: "ask" as const, approvers: "owners" as const };
    expect(isReusable(first, firstDecision)).toBe(true);
    expect(memory.recall(first, firstDecision)).toBeUndefined();
    memory.remember(first, firstDecision, "alice");
    const second = request("npm test 2>&1 | tail -20");
    const secondDecision = { ...decide(second, context("collaborator")), action: "ask" as const, approvers: "owners" as const };
    expect(memory.recall(second, secondDecision)).toMatchObject({ approverId: "alice", commandClass: "npm test" });
    expect(memory.recall(request("npm test", { memberId: "carol" }), secondDecision)).toBeUndefined();
    expect(memory.recall(request("npm test", { source: "terminal" }), secondDecision)).toBeUndefined();
  });

  it("never reuses approvals for protected paths or irreversible operations", () => {
    const memory = createApprovalMemory();
    const envRead = request("cat .env");
    const envDecision = decide(envRead, context("collaborator"));
    expect(envDecision.action).toBe("ask");
    expect(isReusable(envRead, envDecision)).toBe(false);
    memory.remember(envRead, envDecision, "alice");
    expect(memory.recall(envRead, envDecision)).toBeUndefined();
    const forcePush = request("git push --force origin main");
    const pushDecision = decide(forcePush, context("collaborator"));
    expect(pushDecision.action).toBe("ask");
    expect(isReusable(forcePush, pushDecision)).toBe(false);
  });

  it("forgets an approval after the time limit", () => {
    let now = 0;
    const memory = createApprovalMemory(1000, () => now);
    const item = request("npm test");
    const itemDecision = { ...decide(item, context("collaborator")), action: "ask" as const, approvers: "owners" as const };
    memory.remember(item, itemDecision, "alice");
    now = 500;
    expect(memory.recall(item, itemDecision)).toBeDefined();
    now = 1501;
    expect(memory.recall(item, itemDecision)).toBeUndefined();
  });
});
