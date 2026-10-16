import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import type * as YTypes from "yjs";
import { checkReplay, readTrace } from "@simplercp/conflict-guard";
import { createProjectConflictGuard } from "../conflictGuard/projectConflictGuard.js";
import { createTestWorkspace } from "./testWorkspace.js";

const Y = createRequire(import.meta.url)("yjs") as typeof YTypes;

it("服务端保留半成品候选并在批次结束时判定，关闭时记录原因", async () => {
  const root = await createTestWorkspace("guard-pending-");
  const workspacePath = path.join(root, "workspace");
  await fs.mkdir(workspacePath);
  const baseline = {
    "a.ts": "export function target(value: number) { return value + 1; }\n",
    "b.ts": 'import { target } from "./a.js";\nexport function invoke() { return target(1); }\n'
  };
  await Promise.all(Object.entries(baseline).map(([file, text]) => fs.writeFile(path.join(workspacePath, file), text)));
  const guard = createProjectConflictGuard({ projectId: "pending", metadataPath: path.join(root, "metadata"), workspacePath, getRevision: () => 0, config: { mode: "rules", idleMs: 10000, cursorLeaveLines: 3, maxBatchDurationMs: 30000, activeIdleMs: 600000, cursorDebounceMs: 20 } })!;
  const documents = new Map<string, YTypes.Doc>();
  const alice = {};
  const bob = {};
  guard.registerConnection(alice, { projectId: "pending", memberId: "alice", connectedAt: Date.now() });
  guard.registerConnection(bob, { projectId: "pending", memberId: "bob", connectedAt: Date.now() });
  for (const [file, text] of Object.entries(baseline)) {
    const document = new Y.Doc();
    document.getText("content").insert(0, text);
    documents.set(file, document);
    guard.documentPrepared(file, document, file);
  }
  const replace = (file: string, text: string, origin: object) => {
    const document = documents.get(file)!;
    const content = document.getText("content");
    document.transact(() => { content.delete(0, content.length); content.insert(0, text); }, origin);
  };
  const refresh = async () => {
    const version = guard.state().version;
    await waitFor(() => guard.state().version > version);
    expect(guard.state().degraded).toBe(false);
  };
  const finishBatch = (memberId: string) => guard.cursorChanged({ memberId, path: memberId === "alice" ? "b.ts" : "a.ts", position: { lineNumber: 1, column: 1 } });
  try {
    await waitFor(() => !guard.state().indexing);
    replace("a.ts", baseline["a.ts"].replace("+ 1", "+ 2"), alice);
    replace("b.ts", baseline["b.ts"].replace("target(1)", "target(2)"), bob);
    await waitFor(() => guard.state().candidatePairs.length === 1);
    const pairId = guard.state().candidatePairs[0]!.id;
    expect(guard.pairCoordinator.get(pairId)?.status).toBe("pending");
    replace("b.ts", 'import { target } from "./a.js";\nexport function invoke() { return ', bob);
    await refresh();
    expect(guard.state().candidatePairs).toEqual([]);
    expect(guard.pairCoordinator.get(pairId)?.status).toBe("pending");
    replace("b.ts", baseline["b.ts"].replace("target(1)", "target(3)"), bob);
    finishBatch("alice");
    finishBatch("bob");
    await waitFor(() => guard.pairCoordinator.get(pairId)?.status === "judged");
    replace("b.ts", `${baseline["b.ts"]}// 说明调用方式\n`, bob);
    finishBatch("bob");
    await waitFor(() => guard.pairCoordinator.get(pairId)?.status === "closed");
    expect(guard.pairCoordinator.get(pairId)?.closeReason).toBe("no-semantic-change");
    await guard.waitForTrace();
    expect(checkReplay(readTrace(await guard.exportTrace()))).toMatchObject({ valid: true, differences: [], coordinationDifferences: [], errors: [] });

    replace("b.ts", baseline["b.ts"].replace("target(1)", "target(4)"), bob);
    finishBatch("bob");
    await waitFor(() => guard.pairCoordinator.get(pairId)?.status === "judged");
    replace("b.ts", baseline["b.ts"].replace("target(1)", "42"), bob);
    finishBatch("bob");
    await waitFor(() => guard.pairCoordinator.get(pairId)?.status === "closed");
    expect(guard.pairCoordinator.get(pairId)?.closeReason).toBe("relation-removed");

    replace("b.ts", baseline["b.ts"].replace("target(1)", "target(5)"), bob);
    finishBatch("bob");
    await waitFor(() => guard.pairCoordinator.get(pairId)?.status === "judged");
    guard.markDone("alice");
    await waitFor(() => guard.pairCoordinator.get(pairId)?.status === "closed");
    expect(guard.pairCoordinator.get(pairId)?.closeReason).toBe("change-set-closed");
    await guard.waitForTrace();
    const events = readTrace(await guard.exportTrace());
    expect(events.find((event) => event.type === "session_start")?.pairRevisionMode).toBe("judged-input");
    expect(events.filter((event) => event.type === "pair_closed").map((event) => event.closeReason)).toEqual(["no-semantic-change", "relation-removed", "change-set-closed"]);
  } finally {
    await guard.dispose();
    for (const document of documents.values()) document.destroy();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("等待服务端候选状态超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
