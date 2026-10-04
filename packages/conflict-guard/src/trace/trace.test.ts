import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readTrace, traceEventFromConflictEvent, validateTrace, validateTraceDetailed } from "./trace.js";

describe("trace replay", () => {
  it("schema 2 新会话可以重新建立同一候选编号", () => {
    const pair = { id: "stable", left: { actor: { kind: "human", memberId: "alice" }, symbol: "a.ts#a" }, right: { actor: { kind: "human", memberId: "bob" }, symbol: "a.ts#a" }, distance: 0, path: null };
    const events = [
      { schema: 2 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 2 as const, seq: 2, at: 1, type: "pair_candidate_opened", pair },
      { schema: 2 as const, seq: 3, at: 2, type: "session_start" },
      { schema: 2 as const, seq: 4, at: 3, type: "pair_candidate_opened", pair },
      { schema: 2 as const, seq: 5, at: 4, type: "pair_candidate_closed", pair }
    ];
    expect(validateTrace(events)).toBe(true);
    expect(() => validateTrace([events[0]!, events[1]!, { ...events[3]!, seq: 3 }])).toThrow("已经打开");
  });
  it("keeps document, batch and redaction state across session boundaries", () => {
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const events = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: "a.ts", text: "a", textHash: hash("a") },
      { schema: 1 as const, seq: 3, at: 0, type: "batch_opened", file: "a.ts", id: "first" },
      { schema: 1 as const, seq: 4, at: 0, type: "doc_open", file: "secret.ts", text: "[REDACTED]", textHash: hash("[REDACTED]"), redacted: true },
      { schema: 1 as const, seq: 5, at: 0, type: "doc_open", file: ".env", skipped: "sensitive" },
      { schema: 1 as const, seq: 6, at: 1, type: "session_start" },
      { schema: 1 as const, seq: 7, at: 2, type: "edit", file: "a.ts", ops: [{ from: 1, deleted: "", inserted: "b" }] },
      { schema: 1 as const, seq: 8, at: 3, type: "batch_closed", file: "a.ts", id: "first", textAfterHash: hash("ab") }
    ];
    expect(validateTraceDetailed(events)).toEqual({ valid: true, redactedFiles: ["secret.ts"], skippedFiles: [".env"] });
    expect(() => validateTrace(events.slice(0, 6))).toThrow("unclosed batches");
  });

  it("reports a file first redacted during an edit", () => {
    const events = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: "a.ts", text: "", textHash: createHash("sha256").update("").digest("hex") },
      { schema: 1 as const, seq: 3, at: 1, type: "edit", file: "a.ts", ops: [{ from: 0, deleted: "", inserted: "[REDACTED]" }], redacted: true }
    ];
    expect(validateTraceDetailed(events).redactedFiles).toEqual(["a.ts"]);
  });

  it("replays a complete trace and rejects missing or unordered events", () => {
    const text = "hello";
    const hash = createHash("sha256").update("hello brave").digest("hex");
    const events = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: "a.ts", text, textHash: createHash("sha256").update(text).digest("hex") },
      { schema: 1 as const, seq: 3, at: 1, type: "edit", file: "a.ts", ops: [{ from: 5, deleted: "", inserted: " brave" }], revisionAfter: 1 },
      { schema: 1 as const, seq: 4, at: 2, type: "batch_opened", id: "batch-1", file: "a.ts" },
      { schema: 1 as const, seq: 5, at: 3, type: "batch_closed", id: "batch-1", file: "a.ts", textAfterHash: hash }
    ];
    expect(validateTrace(events)).toBe(true);
    expect(readTrace(events.map((event) => JSON.stringify(event)))).toEqual(events);
    expect(() => validateTrace(events.map((event, index) => ({ ...event, seq: index + 2 })))).toThrow("contiguous");
    expect(() => validateTrace(events.slice(0, 4))).toThrow("unclosed batches");
  });

  it("keeps ordinary code intact and reports redacted files separately", () => {
    const ordinary = "task-list-container-wrapper";
    const ordinaryHash = createHash("sha256").update(ordinary).digest("hex");
    const redacted = "[REDACTED]";
    const events = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: "ordinary.ts", text: ordinary, textHash: ordinaryHash },
      { schema: 1 as const, seq: 3, at: 1, type: "edit", file: "ordinary.ts", ops: [{ from: ordinary.length, deleted: "", inserted: "!" }] },
      { schema: 1 as const, seq: 4, at: 2, type: "doc_open", file: "secret.ts", text: redacted, textHash: createHash("sha256").update(redacted).digest("hex"), redacted: true },
      { schema: 1 as const, seq: 5, at: 3, type: "edit", file: "secret.ts", ops: [{ from: 0, deleted: "", inserted: redacted }], redacted: true }
    ];
    expect(validateTrace(events)).toBe(true);
    expect(validateTraceDetailed(events)).toEqual({ valid: true, redactedFiles: ["secret.ts"], skippedFiles: [] });
  });

  it("replays a mirror resynchronization", () => {
    const initial = "old";
    const replacement = "new";
    const events = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: "a.ts", text: initial, textHash: createHash("sha256").update(initial).digest("hex") },
      { schema: 1 as const, seq: 3, at: 1, type: "mirror_resync", file: "a.ts", previousTextHash: createHash("sha256").update(initial).digest("hex"), textHash: createHash("sha256").update(replacement).digest("hex"), text: replacement },
      { schema: 1 as const, seq: 4, at: 2, type: "edit", file: "a.ts", ops: [{ from: 3, deleted: "", inserted: "!" }] }
    ];
    expect(validateTrace(events)).toBe(true);
  });

  it("reports sensitive documents as skipped", () => {
    const events = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: ".env", skipped: "sensitive" }
    ];
    expect(validateTraceDetailed(events)).toEqual({ valid: true, redactedFiles: [], skippedFiles: [".env"] });
  });

  it("rejects a reordered batch trace and tampered edit content", () => {
    const hash = createHash("sha256").update("hello brave").digest("hex");
    const ordered = [
      { schema: 1 as const, seq: 1, at: 0, type: "session_start" },
      { schema: 1 as const, seq: 2, at: 0, type: "doc_open", file: "a.ts", text: "hello", textHash: createHash("sha256").update("hello").digest("hex") },
      { schema: 1 as const, seq: 3, at: 1, type: "batch_opened", id: "batch-1", file: "a.ts" },
      { schema: 1 as const, seq: 4, at: 2, type: "edit", file: "a.ts", ops: [{ from: 5, deleted: "", inserted: " brave" }] },
      { schema: 1 as const, seq: 5, at: 3, type: "batch_closed", id: "batch-1", file: "a.ts", textAfterHash: hash }
    ];
    expect(validateTrace(ordered)).toBe(true);
    expect(() => validateTrace([ordered[0]!, ordered[1]!, ordered[2]!, { ...ordered[4]!, seq: 4 }, { ...ordered[3]!, seq: 5 }])).toThrow("batch_closed");
    const tampered = ordered.map((event) => event.type === "edit" ? { ...event, ops: [{ from: 5, deleted: "", inserted: " evil" }] } : event);
    expect(() => validateTrace(tampered)).toThrow("text hash");
  });

  it("redacts configured values without changing ordinary identifiers", () => {
    const event = {
      type: "edit" as const,
      edit: {
        file: "a.ts",
        origin: { kind: "human" as const, memberId: "alice" },
        at: 0,
        revisionAfter: 1,
        ops: [{ from: 0, deleted: "", inserted: "task-list-container-wrapper KEY_VALUE" }],
        textBefore: "",
        textAfter: "task-list-container-wrapper KEY_VALUE"
      }
    };
    const result = traceEventFromConflictEvent(event, ["KEY_VALUE"]);
    expect(result).toMatchObject({ ops: [{ inserted: "task-list-container-wrapper [REDACTED]" }] });
  });
});
