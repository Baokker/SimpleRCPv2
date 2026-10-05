import { describe, expect, test } from "vitest";
import { VirtualCaptureClock, createCaptureEngine, replayEvents, createAgentRecapFallback, parseAgentRecapDraft, type CaptureEvent } from "../src/index.js";

function run(events: CaptureEvent[]) {
  const clock = new VirtualCaptureClock(events[0]?.at ?? 0);
  const suggestions: import("../src/schema/card.js").CaptureSuggestion[] = [];
  const engine = createCaptureEngine({ clock, onSuggestion: (suggestion) => suggestions.push(suggestion) });
  for (const event of events) { clock.advanceTo(event.at); engine.process(event); }
  return { suggestions, engine };
}

function event<T extends CaptureEvent>(value: Omit<T, "schemaVersion" | "seq">, seq: number) {
  return { schemaVersion: 1, seq, ...value } as T;
}

describe("Agent capture events", () => {
  test("creates grounded recap fallback citations", () => {
    expect(createAgentRecapFallback({ previousRun: { runId: "run-1" } }).evidenceCitations).toEqual(["evidence.previousRun"]);
    expect(createAgentRecapFallback({}).evidenceCitations).toEqual(["evidence"]);
    expect(parseAgentRecapDraft(JSON.stringify({
      type: "decision", title: "Rule", summary: "Summary", whatHappened: "Agent changed a file", correction: "A member corrected it", rule: "Follow the member correction", appliesTo: { files: ["src/a.ts"], globs: [], taskKinds: [] }, notApplicable: "Other files", scopeSuggestion: { scope: "personal", reason: "Needs review" }, confidence: 0.8, evidenceCitations: ["evidence.previousRun.runId"], unknowns: []
    }), { previousRun: { runId: "run-1" } })).toMatchObject({ title: "Rule" });
  });

  test("captures interruption and correction in one session", () => {
    const { suggestions } = run([
      event({ type: "agentRun", at: 0, runId: "run-1", memberId: "Ada", action: "start", status: "running", sessionId: "session", prompt: "Implement the parser" }, 1),
      event({ type: "agentRun", at: 10, runId: "run-1", memberId: "Ada", action: "interrupted", status: "cancelled", sessionId: "session", prompt: "Implement the parser", interruptedByMemberId: "Bob" }, 2),
      event({ type: "agentRun", at: 20, runId: "run-2", memberId: "Ada", action: "start", status: "running", sessionId: "session", prompt: "不要使用正则，改用 parser" }, 3)
    ]);
    expect(suggestions.map((suggestion) => suggestion.triggerType)).toEqual(["agent.interrupted", "agent.corrected"]);
    expect(suggestions[0]?.actors.memberIds).toEqual(["Ada", "Bob"]);
  });

  test("captures failed tool recovery after an edit", () => {
    const { suggestions } = run([
      event({ type: "agentRun", at: 0, runId: "run-1", memberId: "Ada", action: "start", status: "running", prompt: "Fix tests" }, 1),
      event({ type: "agentTool", at: 1, runId: "run-1", memberId: "Ada", tool: "bash", command: "npm test", success: false, error: "exit 1" }, 2),
      event({ type: "docOpen", at: 2, file: "src/a.ts", text: "old\n" }, 3),
      event({ type: "fileExternal", at: 3, file: "src/a.ts", change: "change", textBefore: "old\n", textAfter: "new\n" }, 4),
      event({ type: "agentTool", at: 4, runId: "run-1", memberId: "Ada", tool: "bash", command: "npm test", success: true, exitCode: 0 }, 5)
    ]);
    expect(suggestions.map((suggestion) => suggestion.triggerType)).toContain("agent.toolRecovered");
  });

  test("does not report recovery when success happens before the file edit", () => {
    const { suggestions } = run([
      event({ type: "agentRun", at: 0, runId: "run-1", memberId: "Ada", action: "start", status: "running", prompt: "Fix tests" }, 1),
      event({ type: "agentTool", at: 1, runId: "run-1", memberId: "Ada", tool: "bash", command: "npm test", success: false, error: "exit 1" }, 2),
      event({ type: "agentTool", at: 2, runId: "run-1", memberId: "Ada", tool: "bash", command: "npm test", success: true, exitCode: 0 }, 3),
      event({ type: "docOpen", at: 3, file: "src/a.ts", text: "old\n" }, 4),
      event({ type: "fileExternal", at: 4, file: "src/a.ts", change: "change", textBefore: "old\n", textAfter: "new\n" }, 5),
      event({ type: "agentRun", at: 5, runId: "run-1", memberId: "Ada", action: "end", status: "completed", prompt: "Fix tests" }, 6)
    ]);
    expect(suggestions.map((suggestion) => suggestion.triggerType)).not.toContain("agent.toolRecovered");
  });

  test("does not treat unrelated commands from the same executable as recovery", () => {
    const { suggestions } = run([
      event({ type: "agentRun", at: 0, runId: "run-1", memberId: "Ada", action: "start", status: "running", prompt: "Fix tests" }, 1),
      event({ type: "agentTool", at: 1, runId: "run-1", memberId: "Ada", tool: "bash", command: "npm test", success: false, error: "exit 1" }, 2),
      event({ type: "docOpen", at: 2, file: "src/a.ts", text: "old\n" }, 3),
      event({ type: "fileExternal", at: 3, file: "src/a.ts", change: "change", textBefore: "old\n", textAfter: "new\n" }, 4),
      event({ type: "agentTool", at: 4, runId: "run-1", memberId: "Ada", tool: "bash", command: "npm install", success: true, exitCode: 0 }, 5)
    ]);
    expect(suggestions.map((suggestion) => suggestion.triggerType)).not.toContain("agent.toolRecovered");
  });

  test("emits retry only after the replacement run succeeds", () => {
    const first = run([
      event({ type: "agentRun", at: 0, runId: "run-1", memberId: "Ada", action: "start", status: "running", sessionId: "session", prompt: "Run the parser tests" }, 1),
      event({ type: "agentRun", at: 1, runId: "run-1", memberId: "Ada", action: "failed", status: "failed", sessionId: "session", prompt: "Run the parser tests", error: "exit 1" }, 2),
      event({ type: "agentRun", at: 2, runId: "run-2", memberId: "Ada", action: "start", status: "running", sessionId: "session", prompt: "Run the parser tests again" }, 3),
      event({ type: "agentRun", at: 3, runId: "run-2", memberId: "Ada", action: "end", status: "completed", sessionId: "session", prompt: "Run the parser tests again" }, 4)
    ]);
    expect(first.suggestions.map((suggestion) => suggestion.triggerType)).toContain("agent.retried");
  });

  test("does not attribute a retry to a different member", () => {
    const { suggestions } = run([
      event({ type: "agentRun", at: 0, runId: "run-1", memberId: "Ada", action: "start", status: "running", sessionId: "session", prompt: "Run the parser tests" }, 1),
      event({ type: "agentRun", at: 1, runId: "run-1", memberId: "Ada", action: "failed", status: "failed", sessionId: "session", prompt: "Run the parser tests", error: "exit 1" }, 2),
      event({ type: "agentRun", at: 2, runId: "run-2", memberId: "Bob", action: "start", status: "running", sessionId: "session", prompt: "Run the parser tests again" }, 3),
      event({ type: "agentRun", at: 3, runId: "run-2", memberId: "Bob", action: "end", status: "completed", sessionId: "session", prompt: "Run the parser tests again" }, 4)
    ]);
    expect(suggestions.map((suggestion) => suggestion.triggerType)).not.toContain("agent.retried");
  });

  test("reports member revision of an Agent interval without member overwrite", () => {
    const clock = new VirtualCaptureClock(0);
    const revisions: unknown[] = [];
    const engine = createCaptureEngine({ clock, onSuggestion: () => undefined, onAgentRevised: (revision) => revisions.push(revision) });
    engine.process(event({ type: "docOpen", at: 0, file: "src/a.ts", text: "one\ntwo\nthree\n" }, 1));
    engine.authorship.register("src/a.ts", "agent:run-1", [{ start: 0, end: 14, text: "one\ntwo\nthree\n", ownerId: "Ada" }], 0);
    clock.advanceTo(1);
    engine.process(event({ type: "edit", at: 1, file: "src/a.ts", actor: "Bob", ops: [{ start: 0, deleteCount: 14, insertText: "replacement\n" }], textBefore: "one\ntwo\nthree\n", textAfter: "replacement\n" }, 2));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ runId: "run-1", ownerId: "Ada", editor: "Bob" });
  });

  test("registers recorded Agent ranges and replays a revision", () => {
    const events = [
      event({ type: "docOpen", at: 0, file: "src/a.ts", text: "abcdefghij" }, 1),
      event({ type: "agentRun", at: 1, runId: "run-1", memberId: "Ada", action: "end", status: "completed", prompt: "write", agentRanges: [{ file: "src/a.ts", start: 0, end: 10, text: "abcdefghij", ownerId: "Ada" }] }, 2),
      event({ type: "edit", at: 2, file: "src/a.ts", actor: "Bob", ops: [{ start: 0, deleteCount: 2, insertText: "" }], textBefore: "abcdefghij", textAfter: "cdefghij" }, 3),
      event({ type: "edit", at: 3, file: "src/a.ts", actor: "Bob", ops: [{ start: 0, deleteCount: 2, insertText: "" }], textBefore: "cdefghij", textAfter: "efghij" }, 4)
    ];
    const suggestions = replayEvents(events);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ triggerType: "agent.revised", actors: { memberIds: ["Ada", "Bob"] } });
  });
});
