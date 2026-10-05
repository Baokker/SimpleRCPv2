import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTraceStore } from "../agent/traceStore.js";
import { createTestWorkspace } from "./testWorkspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Agent trace 写入隔离", () => {
  it("文件路径故障恢复后继续写入并保持成功事件的连续序号", async () => {
    const root = await createTestWorkspace("agent-trace-recovery-");
    roots.push(root);
    const storagePath = path.join(root, "trace.jsonl");
    const trace = createTraceStore(storagePath, []);
    await trace.append({ type: "before_failure" });
    await fs.rename(storagePath, `${storagePath}.saved`);
    await fs.mkdir(storagePath);
    await expect(trace.append({ type: "failed_write" })).rejects.toThrow();
    await fs.rmdir(storagePath);
    await fs.rename(`${storagePath}.saved`, storagePath);
    await expect(trace.append({ type: "after_failure" })).resolves.toMatchObject({ type: "after_failure", sequence: 2 });
    await expect(trace.list()).resolves.toMatchObject([{ type: "before_failure", sequence: 1 }, { type: "after_failure", sequence: 2 }]);
    expect(trace.diagnostics()).toMatchObject({ writeFailures: 1, readFailures: 0 });
  });
});
