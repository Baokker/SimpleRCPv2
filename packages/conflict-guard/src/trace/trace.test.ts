import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readTrace, validateTrace } from "./trace.js";

describe("trace replay", () => {
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
});
