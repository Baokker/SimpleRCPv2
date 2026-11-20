import fs from "node:fs/promises";
import path from "node:path";
import { createApp } from "../../../apps/server/src/createApp.js";
import { decide } from "../../../apps/server/src/guard/decide.js";
import type { ApprovalOutcome } from "../../../apps/server/src/guard/approvals.js";
import type { GuardService } from "../../../apps/server/src/guard/service.js";
import type { Action, GuardRequest } from "../../../apps/server/src/guard/types.js";
import { context, ensureRuntimeDirectory, resultsRoot, runVersion, runtimeRoot, writeRun } from "../lib/common.js";

await ensureRuntimeDirectory();
const root = await fs.mkdtemp(path.join(runtimeRoot, "approvals-"));
const seed = path.join(root, "seed");
const dataDir = path.join(root, "data");
await fs.mkdir(seed);
const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir, demoProjectRoot: seed, terminalEnabled: false, guardMode: "full", guardLlmMode: "off" });
try {
  const runtime = app.locals.runtimeManager.get("demo");
  const guard: GuardService = runtime.guard;
  const cwd = runtime.project.workspacePath;
  const alice = await app.locals.members.join("demo", { displayName: "Alice", role: "owner" });
  const bob = await app.locals.members.join("demo", { displayName: "Bob", role: "contributor" });
  const online = (member: typeof alice) => runtime.rooms.joinRoom(runtime.room.id, { memberId: member.memberId, name: member.displayName, participantId: member.memberId, connectionId: member.memberId, profileRole: member.role });
  const changeBob = (role: string) => app.locals.members.changeRole("demo", { actorId: alice.memberId, targetId: bob.memberId, role });
  online(alice);
  online(bob);
  await fs.writeFile(path.join(cwd, "draft.txt"), "Alice's draft\n");
  await fs.writeFile(path.join(cwd, "review.sh"), "#!/bin/sh\nrm draft.txt\n");
  await guard.recordWorkspaceWrite(alice.memberId, "draft.txt");
  await guard.recordWorkspaceWrite(bob.memberId, "review.sh");
  const sample = { projectId: "demo", memberId: bob.memberId, source: "agent", agentRunId: "membership", kind: "command", command: "rm draft.txt", cwd } as const;
  const settings = context("maintainer", { workspaceRoot: cwd, platformDataRoot: dataDir });
  const rows: Array<{ scenario: string; compact: Action; fixedMaintainer: Action; terminalOnly: Action }> = [];
  async function compare(scenario: string, request: GuardRequest) {
    rows.push({ scenario, compact: (await guard.decide(request)).action, fixedMaintainer: decide(request, settings).action, terminalOnly: "allow" });
  }
  await compare("contributor-delete", sample);
  await compare("contributor-edit", { ...sample, kind: "edit", command: undefined, paths: ["draft.txt"] });
  await changeBob("maintainer");
  await compare("before-demotion", sample);
  await changeBob("contributor");
  await compare("after-demotion", sample);
  await compare("owner-executes-contributor-script", { ...sample, memberId: alice.memberId, command: "sh review.sh" });

  type Pending = { id: string };
  function startApproval(request: GuardRequest, timeoutMs: number) {
    let remove: () => void;
    const pending = new Promise<Pending>((resolve, reject) => {
      const deadline = setTimeout(() => { remove(); reject(new Error("Request did not enter the approval queue")); }, 1000);
      remove = guard.onPending((item) => {
        if (item.request.agentRunId !== request.agentRunId) return;
        clearTimeout(deadline);
        remove();
        resolve(item);
      });
    });
    return { pending, outcome: guard.submit(request, { timeoutMs }) };
  }

  const revocations = [];
  for (const event of ["demotion", "offline", "team-interrupted"] as const) {
    const request = { ...sample, agentRunId: `revocation-${event}`, sessionScope: "team" } as const;
    const approval = startApproval(request, 60);
    const pending = await approval.pending;
    if (event === "demotion") await changeBob("viewer");
    if (event === "offline") runtime.rooms.markOffline(runtime.room.id, bob.memberId);
    if (event === "team-interrupted") guard.cancelRun(request.agentRunId);
    const approved = await guard.approve(pending.id, alice.memberId);
    const { decision } = await approval.outcome;
    const firstCall = await guard.submit(request, { timeoutMs: 60 });
    revocations.push({ event, approved, pendingOutcome: decision.outcome, nextAction: firstCall.decision.action, nextApproved: firstCall.approved });
    online(bob);
    await changeBob("contributor");
  }
  await writeRun(path.join(resultsRoot, "D4", `d4-member-binding-compact-${runVersion}`), rows, {
    method: "The frozen GuardService with real project, member and file stores. Fixed maintainer uses rule decisions and terminal-only admits the agent request. Requests are evaluated without executing the requested commands.",
    rows, teamInterruption: revocations.find((row) => row.event === "team-interrupted"),
    scheduler: "Team mention queue and owner takeover scheduling were outside this GuardService measurement."
  }, { experiment: "D4" });

  const events = ["cancel", "timeout", "duplicate", "stale-resolution"] as const;
  const queueOutcomes = new Map<string, ApprovalOutcome>();
  const stopObserving = guard.onResolution((id, outcome) => { queueOutcomes.set(id, outcome); });
  let random = 0xbb67ae85;
  const faults = [];
  for (let index = 0; index < 500; index += 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const event = events[random >>> 30]!;
    const request = { ...sample, agentRunId: `fault-${index}`, sessionScope: "team" } as const;
    const approval = startApproval(request, event === "timeout" ? 8 : 500);
    const pending = await approval.pending;
    const resolutions: boolean[] = [];
    if (event === "cancel") guard.cancelRun(request.agentRunId);
    if (event === "duplicate") resolutions.push(...await Promise.all([guard.approve(pending.id, alice.memberId), guard.approve(pending.id, alice.memberId)]));
    if (event === "stale-resolution") {
      resolutions.push(await guard.reject(pending.id, alice.memberId));
      resolutions.push(await guard.approve(pending.id, alice.memberId));
    }
    const { decision, approved } = await approval.outcome;
    const expected = { cancel: "cancelled", timeout: "timeout", duplicate: "approved", "stale-resolution": "rejected" }[event];
    const queueOutcome = queueOutcomes.get(pending.id);
    queueOutcomes.delete(pending.id);
    const remaining = guard.pending().filter((item) => item.request.agentRunId === request.agentRunId).length;
    const accepted = resolutions.filter(Boolean).length;
    const expectedDecisionOutcome = expected === "cancelled" ? "rejected" : expected;
    faults.push({ id: request.agentRunId, event, queueOutcome, outcome: decision.outcome, expected, accepted, remaining,
      passed: queueOutcome === expected && decision.outcome === expectedDecisionOutcome && approved === (expected === "approved") && remaining === 0 && accepted === (resolutions.length ? 1 : 0) });
  }
  stopObserving();
  await guard.awaitIdle();
  await writeRun(path.join(resultsRoot, "X6", `x6-approval-runtime-compact-${runVersion}`), faults, {
    cases: faults.length, failed: faults.filter((row) => !row.passed).length, staleOrDuplicateResolutionsAccepted: faults.filter((row) => row.accepted > 1).length,
    leftoverApprovals: faults.reduce((count, row) => count + row.remaining, 0), revocations,
    scope: "GuardService approval lifecycle. No OpenCode permission reply transport or event-stream fault injection."
  }, { experiment: "X6 approval runtime", seed: "0xbb67ae85" });
} finally {
  await app.locals.agentRuns.dispose();
  await app.locals.agentRuntime.dispose();
  await app.locals.runtimeManager.dispose();
}
