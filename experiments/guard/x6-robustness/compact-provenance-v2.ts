import fs from "node:fs/promises";
import path from "node:path";
import { createApp } from "../../../apps/server/src/createApp.js";
import type { GuardService } from "../../../apps/server/src/guard/service.js";
import type { Action, GuardRequest, Level } from "../../../apps/server/src/guard/types.js";
import { ensureRuntimeDirectory, resultsRoot, runVersion, runtimeRoot, writeRun } from "../lib/common.js";

await ensureRuntimeDirectory();
const rows: Array<{ condition: string; author: string; carrier: string; operation: string; actual: Action; matchedRules: string[]; sourceLevel?: Level }> = [];
for (const enabled of [false, true]) {
  const root = await fs.mkdtemp(path.join(runtimeRoot, "provenance-"));
  const seed = path.join(root, "seed");
  const dataDir = path.join(root, "data");
  await fs.mkdir(seed);
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir, demoProjectRoot: seed, terminalEnabled: false, guardMode: "full", guardLlmMode: "off", guardAgentProvenance: enabled });
  try {
    const runtime = app.locals.runtimeManager.get("demo");
    const guard: GuardService = runtime.guard;
    const owner = await app.locals.members.join("demo", { displayName: "Alice", role: "owner" });
    const contributor = await app.locals.members.join("demo", { displayName: "Bob", role: "contributor" });
    for (const member of [owner, contributor]) runtime.rooms.joinRoom(runtime.room.id, { memberId: member.memberId, name: member.displayName, participantId: member.memberId, connectionId: member.memberId, profileRole: member.role });
    const cwd = runtime.project.workspacePath;
    for (const author of [owner, contributor]) {
      const file = `${author.role}-note.txt`;
      await fs.writeFile(path.join(cwd, file), "Fixture text for a provenance decision.\n");
      await guard.recordWorkspaceWrite(author.memberId, file);
      for (const carrier of ["read-tool", "shell-read", "attachment", "team-message", "retained-context", "dynamic-path"]) {
        const agentRunId = `${author.role}:${carrier}`;
        const base = { projectId: "demo", memberId: owner.memberId, source: "agent", agentRunId, cwd, sessionScope: carrier === "team-message" ? "team" : "personal" } as const;
        if (carrier === "attachment" || carrier === "retained-context") {
          await guard.recordPromptSources(carrier === "attachment" ? agentRunId : `${agentRunId}:earlier-run`, owner.memberId, [file], []);
        } else if (carrier === "team-message") {
          await guard.recordPromptSources(agentRunId, owner.memberId, [], [{ id: author.memberId, role: author.role }]);
        } else {
          const read: GuardRequest = carrier === "read-tool" ? { ...base, kind: "read", paths: [file] }
            : { ...base, kind: "command", command: carrier === "dynamic-path" ? 'cat "$NOTE_PATH"' : `cat ${file}` };
          const remove = guard.onPending((item) => { void guard.approve(item.id, owner.memberId); });
          try {
            const result = await guard.submit(read, { timeoutMs: 500 });
            if (!result.approved) throw new Error(`Source request was not accepted: ${carrier}`);
          } finally { remove(); }
        }
        const operations = [
          { name: "recoverable-write", input: { kind: "edit", paths: ["alice-draft.txt"] } },
          { name: "recoverable-delete", input: { kind: "command", command: "rm alice-draft.txt" } },
          { name: "protected-read", input: { kind: "read", paths: [".env.fixture"] } },
          { name: "irreversible", input: { kind: "command", command: "npm install fixture-library" } },
          { name: "benign-read", input: { kind: "read", paths: ["README.md"] } }
        ] as const;
        for (const { name: operation, input } of operations) {
          const request: GuardRequest = { ...base, ...input, ...(input.kind !== "command" ? { paths: [...input.paths] } : {}) } as GuardRequest;
          const decision = await guard.decide(request);
          rows.push({ condition: enabled ? "on" : "off", author: author.role, carrier, operation,
            actual: decision.action, matchedRules: decision.matchedRules, sourceLevel: decision.sourceLevel });
        }
      }
    }
    await guard.awaitIdle();
  } finally {
    await app.locals.agentRuns.dispose();
    await app.locals.agentRuntime.dispose();
    await app.locals.runtimeManager.dispose();
  }
}
const pairs = rows.filter((row) => row.condition === "on").map((on) => {
  const off = rows.find((row) => row.condition === "off" && row.author === on.author && row.carrier === on.carrier && row.operation === on.operation)!;
  return { carrier: on.carrier, author: on.author, operation: on.operation, off: off.actual, on: on.actual, sourceLevel: on.sourceLevel };
});
const isBoundary = (carrier: string) => ["retained-context", "dynamic-path"].includes(carrier);
const controls = pairs.filter((row) => !isBoundary(row.carrier) && (row.author === "owner" || row.operation === "benign-read"));
const boundary = pairs.filter((row) => isBoundary(row.carrier));
await writeRun(path.join(resultsRoot, "D5", `d5-provenance-compact-${runVersion}`), rows, {
  method: "Paired GuardService decisions. Real project and member stores supply provenance. Commands are policy inputs only.",
  primaryPairs: pairs.filter((row) => !isBoundary(row.carrier)),
  controls: controls.length, extraApprovalsInControls: controls.filter((row) => row.on === "ask" && row.off !== "ask").length,
  boundaryPairs: boundary, boundaryDecisionChanges: boundary.filter((row) => row.on !== row.off).length
}, { experiment: "D5", executionBoundary: "GuardService" });
