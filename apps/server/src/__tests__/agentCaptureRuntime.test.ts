import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createFakeAgentRuntime } from "../agent/fakeAgentRuntime.js";

describe("fake Agent capture markers", () => {
  test("emits edit and tool trace events", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), ".agent-capture-test-"));
    await fs.writeFile(path.join(root, "file.ts"), "one\n");
    const runtime = createFakeAgentRuntime();
    const session = await runtime.createSession({ workspacePath: root, title: "fake-edit" });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const stop = await runtime.subscribe({ workspacePath: root, sessionId: session.id }, (event) => { events.push(event); });
    await runtime.run({ workspacePath: root, sessionId: session.id, prompt: "fake-edit=file.ts:1:two fake-tool=fail:npm test fake-tool=ok:npm test" });
    await stop();
    await runtime.dispose();
    expect(await fs.readFile(path.join(root, "file.ts"), "utf8")).toContain("two");
    const toolEvents = events.filter((event) => event.type === "message.part.updated");
    expect(toolEvents).toHaveLength(2);
    expect((toolEvents[0]?.data.part as { state: { status: string } }).state.status).toBe("error");
    await fs.rm(root, { recursive: true, force: true });
  });
});
