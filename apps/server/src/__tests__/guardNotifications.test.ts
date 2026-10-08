import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createTestWorkspace } from "./testWorkspace.js";
import { createGuardNotificationStore } from "../conflictGuard/notificationStore.js";

it("restores notification read and handled state and restricts updates to its owner", async () => {
  const root = await createTestWorkspace("guard-notices-");
  try {
    const file = path.join(root, "project", "notifications.json");
    const store = createGuardNotificationStore(file);
    store.add({ id: "notice", memberId: "owner", runId: "run", summary: "请检查修改", at: 100, level: "action" });
    expect(store.update("notice", "other", { handled: true })).toBe(false);
    expect(store.update("notice", "owner", { read: true, handled: true })).toBe(true);
    await store.flush();
    expect(createGuardNotificationStore(file).list("owner")).toEqual([{ id: "notice", memberId: "owner", runId: "run", summary: "请检查修改", at: 100, read: true, handled: true, level: "action" }]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("filters configured sensitive values before notification persistence and retrieval", async () => {
  const root = await createTestWorkspace("guard-notice-filter-");
  try {
    const file = path.join(root, "notifications.json");
    const secret = "notification-sensitive-value";
    const store = createGuardNotificationStore(file, [secret]);
    store.add({ id: "notice", memberId: "owner", runId: "run", summary: `请检查 ${secret}`, at: 1 });
    await store.flush();
    expect(await fs.readFile(file, "utf8")).not.toContain(secret);
    expect(JSON.stringify(store.list("owner"))).not.toContain(secret);
    expect(JSON.stringify(createGuardNotificationStore(file, [secret]).list("owner"))).toContain("[REDACTED]");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
