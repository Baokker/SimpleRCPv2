import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import type { AgentIntent } from "@simplercp/conflict-guard";
import { createProjectConflictGuard } from "../conflictGuard/projectConflictGuard.js";
import { reviewExplicitDiscounts, intentReviewKey } from "../conflictGuard/intentReview.js";
import { createWarningAcknowledgements } from "../conflictGuard/warningAcknowledgements.js";
import { createTestWorkspace } from "./testWorkspace.js";

const intent = (task: string): AgentIntent => ({ actor: { kind: "agent", runId: task, ownerId: "owner" }, owner: "owner", task, plannedScope: [], actualScope: [], baseRevision: {}, taskRevision: 0, status: "planning" });

it("identifies incompatible requested discount outcomes and keeps compatible tasks independent", () => {
  expect(reviewExplicitDiscounts(intent("把618逻辑改成五折"), intent("把618逻辑改成八折"))?.decision).toBe("lock");
  expect(reviewExplicitDiscounts(intent("把618从五折改成八折"), intent("把618逻辑改成八折"))).toBeUndefined();
  expect(reviewExplicitDiscounts(intent("双十一改为五折"), intent("618改为八折"))).toBeUndefined();
  expect(reviewExplicitDiscounts(intent("给618添加日志"), intent("618改为八折"))).toBeUndefined();
  expect(reviewExplicitDiscounts(intent("618会员五折"), intent("618普通用户八折"))).toBeUndefined();
  const first = intent("618改为八折");
  expect(intentReviewKey(first, first)).not.toBe(intentReviewKey(first, { ...first, plannedScope: ["src/pricing.ts#price"] }));
});

it("conflicting tasks create an owner card before execution and resume after both owners accept", async () => {
  const root = await createTestWorkspace("intent-review-");
  const guard = createProjectConflictGuard({ projectId: path.basename(root), metadataPath: path.join(root, "metadata"), workspacePath: root, getRevision: () => 0, config: { mode: "rules", idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 30_000, activeIdleMs: 600_000, cursorDebounceMs: 200 } })!;
  const controller = new AbortController();
  try {
    for (const [runId, ownerId, task] of [["alice-run", "alice", "618改成五折"], ["bob-run", "bob", "618改成八折"]]) {
      const actor = { kind: "agent" as const, runId: runId!, ownerId: ownerId! };
      guard.beginAgentRun(actor, new Map());
      guard.arbitration.board.create(actor, task!, {});
    }
    const waiting = guard.arbitration.beforeRun("bob-run", controller.signal);
    await guard.arbitration.checkIntents("alice-run");
    const [card] = guard.arbitration.cards.list("alice");
    expect(card?.status).toBe("waiting");
    expect(card?.conflict.ruleId).toBe("intent-target-conflict");
    expect(card?.suggestionStatus).toBe("ready");
    expect(guard.arbitration.board.get("alice-run")?.status).toBe("blocked");
    expect(guard.arbitration.board.get("bob-run")?.status).toBe("blocked");
    expect(guard.arbitration.cards.list("bob")).toHaveLength(1);
    expect(guard.arbitration.stats().members.map((member) => member.interruptions)).toEqual([1, 1]);
    guard.arbitration.act(card!.id, "alice", "accept");
    expect(guard.arbitration.cards.list()[0]?.status).toBe("waiting");
    guard.arbitration.act(card!.id, "bob", "accept");
    expect(await waiting).toContain("双方属主已经同意");
    expect(guard.arbitration.cards.list()[0]?.status).toBe("accepted");
    guard.arbitration.plan("bob-run", "PLAN:\nsrc/pricing.ts#price\nEND_PLAN");
    await guard.arbitration.checkIntents("bob-run");
    expect(guard.arbitration.cards.list()).toHaveLength(1);
    expect(await guard.arbitration.beforeRun("bob-run", controller.signal)).toContain("双方属主已经同意");
  } finally { controller.abort(); await guard.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});

it("same-owner tasks wait for the earlier task without creating owner cards", async () => {
  const root = await createTestWorkspace("intent-owner-");
  const guard = createProjectConflictGuard({ projectId: path.basename(root), metadataPath: path.join(root, "metadata"), workspacePath: root, getRevision: () => 0, config: { mode: "rules", idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 30_000, activeIdleMs: 600_000, cursorDebounceMs: 200 } })!;
  const controller = new AbortController();
  try {
    guard.arbitration.board.create({ kind: "agent", runId: "earlier", ownerId: "alice" }, "618改成五折", {});
    guard.arbitration.board.create({ kind: "agent", runId: "later", ownerId: "alice" }, "618改成八折", {});
    const waiting = guard.arbitration.beforeRun("later", controller.signal);
    expect(await guard.arbitration.beforeRun("earlier", controller.signal)).toBe("");
    expect(guard.arbitration.cards.list()).toEqual([]);
    guard.arbitration.finish("earlier", false);
    expect(await waiting).toBe("");
    expect(guard.arbitration.board.get("later")?.status).toBe("running");
  } finally { controller.abort(); await guard.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});

it("warning acknowledgements persist independently for each member and revision", async () => {
  const root = await createTestWorkspace("warning-acknowledgements-");
  try {
    const file = path.join(root, "acknowledgements.json");
    const store = createWarningAcknowledgements(file);
    await Promise.all([store.add("alice", "pair", 1, "first-content"), store.add("bob", "pair", 1, "first-content")]);
    const reopened = createWarningAcknowledgements(file);
    expect(reopened.has("alice", "pair", 1, "first-content")).toBe(true);
    expect(reopened.has("bob", "pair", 1, "first-content")).toBe(true);
    expect(reopened.has("charlie", "pair", 1, "first-content")).toBe(false);
    expect(reopened.has("alice", "pair", 2, "first-content")).toBe(false);
    expect(reopened.has("alice", "pair", 1, "changed-content")).toBe(false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("checks every active counterpart and cancellation releases task negotiation", async () => {
  const root = await createTestWorkspace("intent-counterparts-");
  const guard = createProjectConflictGuard({ projectId: path.basename(root), metadataPath: path.join(root, "metadata"), workspacePath: root, getRevision: () => 0, config: { mode: "rules", idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 30_000, activeIdleMs: 600_000, cursorDebounceMs: 200 } })!;
  const controller = new AbortController();
  try {
    for (let index = 0; index < 6; index += 1) guard.arbitration.board.create({ kind: "agent", runId: `other-${index}`, ownerId: `owner-${index}` }, index === 5 ? "618改成五折" : "添加日志", {});
    guard.arbitration.board.create({ kind: "agent", runId: "current", ownerId: "current-owner" }, "618改成八折", {});
    const waiting = guard.arbitration.beforeRun("current", controller.signal);
    await guard.arbitration.checkIntents("current");
    expect(guard.arbitration.cards.list()).toHaveLength(1);
    expect(guard.arbitration.cards.list()[0]?.conflict.other).toMatchObject({ runId: "other-5" });
    guard.arbitration.cancel("current");
    await waiting;
    expect(guard.arbitration.cards.list()[0]?.status).toBe("closed");
    await guard.arbitration.checkIntents("current");
    expect(guard.arbitration.cards.list()).toHaveLength(1);
  } finally { controller.abort(); await guard.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});

it("reports storage failures and accepts subsequent acknowledgements after storage is available", async () => {
  const root = await createTestWorkspace("warning-storage-");
  const parent = path.join(root, "records");
  const store = createWarningAcknowledgements(path.join(parent, "acknowledgements.json"));
  try {
    await fs.writeFile(parent, "occupied");
    await expect(store.add("alice", "pair", 1, "content")).rejects.toThrow();
    expect(store.has("alice", "pair", 1, "content")).toBe(false);
    await fs.unlink(parent);
    await store.add("alice", "pair", 1, "content");
    expect(store.has("alice", "pair", 1, "content")).toBe(true);
    expect(createWarningAcknowledgements(path.join(parent, "acknowledgements.json")).has("alice", "pair", 1, "content")).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
