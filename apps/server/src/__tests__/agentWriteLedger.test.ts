import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentWriteLedger } from "../agent/agentWriteLedger.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("Agent write ledger", () => {
  let root: string;
  beforeEach(async () => { root = await createTestWorkspace("agent-ledger-"); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("records completed apply_patch metadata for update, add, delete and Move to operations", async () => {
    const ledger = createAgentWriteLedger();
    const content = "export const updated = true;\n";
    await fs.writeFile(path.join(root, "a.ts"), content);
    await fs.writeFile(path.join(root, "added.ts"), "added\n");
    await fs.writeFile(path.join(root, "moved.ts"), "moved\n");
    const patchText = "*** Begin Patch\n*** Update File: a.ts\n@@\n-export const updated = false;\n+export const updated = true;\n*** Add File: added.ts\n+added\n*** Delete File: removed.ts\n*** Update File: original.ts\n*** Move to: moved.ts\n@@\n-original\n+moved\n*** End Patch";
    const entries = await ledger.record("project", "run", root, { part: {
      sessionID: "session", messageID: "message", id: "part", type: "tool", tool: "apply_patch", callID: "call",
      state: { status: "completed", input: { patchText }, metadata: { files: [
        { type: "update", filePath: path.join(root, "a.ts") },
        { type: "add", filePath: path.join(root, "added.ts") },
        { type: "delete", filePath: path.join(root, "removed.ts") },
        { type: "move", filePath: path.join(root, "original.ts"), movePath: path.join(root, "moved.ts") }
      ] } }
    } });
    expect(entries?.map((entry) => entry.file)).toEqual(["a.ts", "added.ts", "removed.ts", "original.ts", "moved.ts"]);
    expect(entries?.find((entry) => entry.file === "a.ts")?.contentHash).toBe(crypto.createHash("sha256").update(content).digest("hex"));
    expect(entries?.find((entry) => entry.file === "original.ts")).toMatchObject({ contentHash: null, readError: "Written file no longer exists" });
  });

  it("filters a finished overlapping run's files and lists each own tool file once", async () => {
    const ledger = createAgentWriteLedger();
    for (const [runId, file, callID] of [["first", "a.ts", "first-write"], ["second", "b.ts", "second-write"], ["first", "a.ts", "first-edit"]]) {
      const absolutePath = path.join(root, file!);
      await fs.writeFile(absolutePath, `written by ${runId}\n`);
      await ledger.record("project", runId!, root, { part: { type: "tool", tool: "write", callID, state: { status: "completed", input: { filePath: absolutePath } } } });
    }
    const changes = ["a.ts", "b.ts", "member.ts"].map((file) => ({ file, additions: 1, deletions: 0 }));
    expect(ledger.attribute("project", "first", changes, new Set(["second"]), new Set())).toEqual([
      { file: "a.ts", additions: 1, deletions: 0, attribution: "tool" },
      { file: "member.ts", additions: 1, deletions: 0, attribution: "ambiguous" }
    ]);
    expect(ledger.attribute("project", "first", [], new Set(["second"]), new Set()).map((change) => change.file)).toEqual(["a.ts"]);
    ledger.clearProject("project");
    expect(ledger.listProject("project").size).toBe(0);
  });

  it("keeps a null hash when the written path is a directory", async () => {
    const ledger = createAgentWriteLedger();
    await fs.mkdir(path.join(root, "directory"));
    const entries = await ledger.record("project", "run", root, { part: {
      type: "tool", tool: "write", callID: "directory-write", state: { status: "completed", input: { filePath: path.join(root, "directory") } }
    } });
    expect(entries?.[0]).toMatchObject({ file: "directory", contentHash: null, readError: "Written path is not a regular file" });
  });

  it("没有文件元数据时，补丁文件保留为快照归属", async () => {
    const ledger = createAgentWriteLedger();
    const patchText = "*** Begin Patch\n*** Add File: added.ts\n+export const added = true;\n*** End Patch";
    const entries = await ledger.record("project", "run", root, { part: {
      type: "tool", tool: "apply_patch", callID: "patch", state: { status: "completed", input: { patchText } }
    } });
    expect(entries).toBeUndefined();
  });
});
