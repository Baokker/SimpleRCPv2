import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandClass, createApprovalMemory, isReusable } from "../guard/approvalMemory.js";
import { decide } from "../guard/decide.js";
import { applyScriptInspection, fileScriptSource, inspectScripts } from "../guard/scriptInspection.js";
import type { GuardContext, GuardRequest, Level } from "../guard/types.js";
import { createTestWorkspace } from "./testWorkspace.js";

let workspaceRoot: string;
beforeAll(async () => {
  workspaceRoot = await createTestWorkspace("approval-memory-");
  await fs.writeFile(path.join(workspaceRoot, "check.js"), "eval('1');\n");
});
afterAll(async () => fs.rm(workspaceRoot, { recursive: true, force: true }));
const context = (memberLevel: Level): GuardContext => ({
  memberLevel,
  initiatorOnline: true,
  workspaceRoot,
  platformDataRoot: path.join(workspaceRoot, "platform")
});
const evaluate = (item: GuardRequest, level: Level) => {
  const current = context(level);
  return applyScriptInspection(decide(item, current), inspectScripts(item, current, fileScriptSource()), level, item.source);
};
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
  it("groups commands with an equivalent output descriptor", () => {
    expect(commandClass("npm test")).toBe("npm test");
    expect(commandClass("npm test 2>&1")).toBe("npm test");
    expect(commandClass("npm   test >/dev/null")).toBe("npm test");
  });

  it("excludes chains, pipelines and substitutions and keys file redirections separately", () => {
    expect(commandClass("npm test; rm -rf dist")).toBeUndefined();
    expect(commandClass("npm test && git push")).toBeUndefined();
    expect(commandClass("npm test | sh")).toBeUndefined();
    expect(commandClass("npm test | tail -20")).toBeUndefined();
    expect(commandClass("npm test > out.txt")).toBe("npm test > out.txt");
    expect(commandClass("echo $(cat .env)")).toBeUndefined();
    expect(commandClass("npm run build")).not.toBe(commandClass("npm test"));
  });
});

describe("approval memory reuse", () => {
  it("asks once for the same command class from the same requester", () => {
    const memory = createApprovalMemory();
    const first = request("node check.js");
    const firstDecision = evaluate(first, "maintainer");
    expect(isReusable(first, firstDecision)).toBe(true);
    expect(memory.recall(first, firstDecision)).toBeUndefined();
    memory.remember(first, firstDecision, "alice");
    expect(evaluate(first, "maintainer")).toEqual(firstDecision);
    expect(memory.recall(first, firstDecision)).toMatchObject({ approverId: "alice", commandClass: "node check.js" });
    expect(memory.recall({ ...first, memberId: "carol" }, firstDecision)).toBeUndefined();
    expect(memory.recall({ ...first, source: "terminal" }, firstDecision)).toBeUndefined();
    expect(memory.recall({ ...first, sessionScope: "team" }, firstDecision)).toBeUndefined();
    expect(memory.recall(first, evaluate(first, "contributor"))).toBeUndefined();
    expect(createApprovalMemory().recall(first, firstDecision)).toBeUndefined();
    memory.clearMember(first.memberId);
    expect(memory.recall(first, firstDecision)).toBeUndefined();
  });

  it("never reuses approvals for protected paths or irreversible operations", () => {
    const memory = createApprovalMemory();
    const envRead = request("cat .env");
    const envDecision = decide(envRead, context("maintainer"));
    expect(envDecision.action).toBe("ask");
    expect(isReusable(envRead, envDecision)).toBe(false);
    memory.remember(envRead, envDecision, "alice");
    expect(memory.recall(envRead, envDecision)).toBeUndefined();
    const forcePush = request("git push --force origin main");
    const pushDecision = decide(forcePush, context("maintainer"));
    expect(pushDecision.action).toBe("ask");
    expect(isReusable(forcePush, pushDecision)).toBe(false);
    for (const command of ["cat ../readme", "curl https://example.test", "npm install", "node check.js | cat", "echo $(pwd)"]) {
      const item = request(command);
      expect(isReusable(item, evaluate(item, "contributor")), command).toBe(false);
    }
  });

  it("forgets an approval after the time limit", () => {
    let now = 0;
    const memory = createApprovalMemory(1000, () => now);
    const item = request("node check.js");
    const itemDecision = evaluate(item, "maintainer");
    memory.remember(item, itemDecision, "alice");
    now = 500;
    expect(memory.recall(item, itemDecision)).toBeDefined();
    now = 1000;
    expect(memory.recall(item, itemDecision)).toBeUndefined();
  });
});
