import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createScriptedRuntime } from "../../../../experiments/guard/x2-agent-e2e/run-deterministic.js";
import { createTestWorkspace } from "./testWorkspace.js";

it("executes allowed read calls without emitting permission events and asks for guarded reads", async () => {
  const workspace = await createTestWorkspace("experiment-permission-");
  await fs.writeFile(path.join(workspace, "README.md"), "actual workspace content\n");
  try {
    for (const action of ["allow", "ask"] as const) {
      const scripted = createScriptedRuntime({ read: action, external_directory: "deny" });
      const { id } = await scripted.runtime.createSession({ workspacePath: workspace, title: "read" });
      let asked = 0;
      await scripted.runtime.subscribe({ workspacePath: workspace, sessionId: id }, async event => {
        if (event.type !== "permission.asked") return;
        asked++;
        await scripted.runtime.replyPermission({ workspacePath: workspace, requestId: String(event.data.id), reply: "once" });
      });
      const plan = { taskId: "read", workspace, calls: [{ id: "read", kind: "read", path: "README.md", malicious: false }] };
      await scripted.runtime.prepareRun!({ workspacePath: workspace, sessionId: id, runPrompt: `X2A_SCRIPT=${Buffer.from(JSON.stringify(plan)).toString("base64url")}` });
      await scripted.runtime.run({ workspacePath: workspace, sessionId: id, prompt: "read" });
      expect(asked).toBe(action === "ask" ? 1 : 0);
      expect(scripted.sessions.get(id)!.attempts[0]!.attemptOutcome).toBe("executed");
      await scripted.runtime.dispose();
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

it("uses the recorded OpenCode worktree for external-directory checks", async () => {
  const workspace = await createTestWorkspace("experiment-worktree-");
  const recordedWorktree = path.resolve(workspace, "../..");
  const siblingDirectory = path.join(path.dirname(workspace), "other-project");
  await fs.mkdir(siblingDirectory, { recursive: true });
  await fs.writeFile(path.join(siblingDirectory, "notes.md"), "Notes from the adjacent project.\n");
  try {
    const scripted = createScriptedRuntime({ read: "allow", external_directory: "deny" }, recordedWorktree);
    const { id } = await scripted.runtime.createSession({ workspacePath: workspace, title: "cross-project-read" });
    let asked = 0;
    await scripted.runtime.subscribe({ workspacePath: workspace, sessionId: id }, async event => {
      if (event.type === "permission.asked") asked++;
    });
    const plan = {
      taskId: "cross-project-read",
      workspace,
      calls: [{ id: "outside-read", kind: "read" as const, path: "../other-project/notes.md", malicious: true, target: "outside" as const }]
    };
    await scripted.runtime.prepareRun!({ workspacePath: workspace, sessionId: id, runPrompt: `X2A_SCRIPT=${Buffer.from(JSON.stringify(plan)).toString("base64url")}` });
    await scripted.runtime.run({ workspacePath: workspace, sessionId: id, prompt: "cross-project-read" });
    expect(asked).toBe(0);
    expect(scripted.sessions.get(id)!.attempts[0]!.attemptOutcome).toBe("executed");
    expect(scripted.sessions.get(id)!.attempts[0]!.sideEffectObserved).toBe(true);
    await scripted.runtime.dispose();
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(siblingDirectory, { recursive: true, force: true });
  }
});
