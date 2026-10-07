import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemberStore } from "../auth/identity.js";
import { createTraceStore, redactSensitive } from "../agent/traceStore.js";
import { createEventLog } from "../eventLog.js";
import { createChatStore } from "../chat.js";
import { agentEnv, terminalEnv } from "../processEnv.js";
import { createTestWorkspace } from "./testWorkspace.js";
import {isCaptureEvent} from "@simplercp/knowledge";
import {enrichRecapEvidence} from "../knowledge/recapEvidence.js";

describe("foundation identity and isolation", () => {
  it("resolves JavaScript imports and records unavailable symbol sources", async () => {
    const root = await createTestWorkspace("recap-sources-");
    try {
      await fs.writeFile(path.join(root, "session.js"), "import {sharedHelper} from './sharedHelper.js'; import './missing.js'; export function setup() { return sharedHelper(); }");
      await fs.writeFile(path.join(root, "sharedHelper.js"), "export function sharedHelper() { return 1; }");
      const evidence = await enrichRecapEvidence({correctionFiles: [{file: "session.js", beforeText: "", afterText: ""}]}, root);
      expect(evidence.symbolSources).toHaveProperty("sharedHelper.js");
      expect(evidence.unresolvedSymbolSources).toEqual(["session.js: ./missing.js"]);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
  });
  it("preserves capture coordinates when redacting source text", () => {
    const text = "Authorization: request.credentials\n";
    const event = {schemaVersion: 1, type: "agentRun", seq: 1, at: 1, runId: "run", memberId: "member", action: "end", prompt: "Update authentication", agentRanges: [{file: "auth.ts", start: 0, end: text.length, text}]};
    expect(isCaptureEvent(event)).toBe(true);
    const redacted = redactSensitive(event, [], {preserveLength: true});
    expect(isCaptureEvent(redacted)).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain("request.credentials");
  });
  it("assigns members, resumes an existing member, and stores the role", async () => {
    const root = await createTestWorkspace("member-");
    const project = { id: "demo", name: "Demo", source: "demo", workspacePath: path.join(root, "workspace"), metadataPath: root, createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() } as const;
    const members = createMemberStore({ projects: () => [project] });
    const first = await members.join("demo", { displayName: "Alice", role: "student" });
    const resumed = await members.join("demo", { memberId: first.memberId, displayName: "Alice Updated", role: "reviewer" });
    const newMember = await members.join("demo", { memberId: "unknown", displayName: "Bob" });
    expect(resumed.memberId).toBe(first.memberId);
    expect(resumed.role).toBe("reviewer");
    expect(newMember.memberId).not.toBe(first.memberId);
    await expect(fs.readFile(path.join(root, "members.json"), "utf8")).resolves.toContain(first.memberId);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("filters identity variables from terminal and keeps the model key for Agent", () => {
    const env = { PATH: "/bin", HOME: "/home/test", DEEPSEEK_API_KEY: "fake-key-value", SESSION_TOKEN: "session-token", OTHER_SECRET: "secret-value", LANG: "C" };
    expect(terminalEnv(env)).toEqual({ PATH: "/bin", HOME: "/home/test", LANG: "C" });
    expect(agentEnv(env)).toMatchObject({ PATH: "/bin", HOME: "/home/test", DEEPSEEK_API_KEY: "fake-key-value" });
    expect(agentEnv(env)).not.toHaveProperty("SESSION_TOKEN");
    expect(agentEnv(env)).not.toHaveProperty("OTHER_SECRET");
  });

  it("redacts environment values and common credential formats", () => {
    const output = redactSensitive("key=fake-key-value Bearer abcdefghijkl sk-abcdefghijklmnop", ["fake-key-value"]);
    expect(output).toBe("key=[REDACTED:TOKEN] Bearer [REDACTED:TOKEN] [REDACTED:API_KEY]");
  });

  it("redacts named secrets in trace, activity and Agent chat", async () => {
    const root = await createTestWorkspace("redaction-");
    const previous = process.env.TEST_SECRET;
    process.env.TEST_SECRET = "redaction-secret-value";
    try {
      const text = "redaction-secret-value\nAuthorization: Basic abcdefghijklmnop\nsk-abcdefghijklmnop Bearer abcdefghijkl";
      const redacted = String(redactSensitive(text));
      expect(redacted).toContain("[REDACTED:TEST_SECRET]");
      expect(redacted).not.toContain("abcdefghijkl");
      const trace = createTraceStore(path.join(root, "trace.jsonl"), []);
      await trace.append({ type: "assistant_message", summary: text });
      const events = createEventLog(path.join(root, "activity.json"));
      const chat = createChatStore(events, { storagePath: path.join(root, "chat.json") });
      events.append({ type: "agent_task_completed", payload: { output: text } });
      await chat.createMessage({ roomId: "room", authorId: "member", authorName: "Agent", text });
      await events.awaitIdle();
      await chat.awaitIdle();
      for (const file of ["trace.jsonl", "activity.json", "chat.json"]) {
        const content = await fs.readFile(path.join(root, file), "utf8");
        expect(content).not.toContain("redaction-secret-value");
        expect(content).not.toContain("abcdefghijkl");
      }
    } finally {
      if (previous === undefined) delete process.env.TEST_SECRET;
      else process.env.TEST_SECRET = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
