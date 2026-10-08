import { describe, expect, it } from "vitest";
import { transformRanges } from "./rangeTransform.js";
import { ConflictGuardTracker, type ConflictGuardClock } from "./tracker.js";
import type { TextEdit } from "../model/types.js";

class FakeClock implements ConflictGuardClock {
  value = 0;
  private timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  now() { return this.value; }
  setTimeout(callback: () => void, delayMs: number) {
    const timer = { at: this.value + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(handle: unknown) { (handle as { cancelled: boolean }).cancelled = true; }
  advance(ms: number) {
    this.value += ms;
    for (const timer of this.timers.filter((candidate) => !candidate.cancelled && candidate.at <= this.value).sort((left, right) => left.at - right.at)) {
      timer.cancelled = true;
      timer.callback();
    }
    this.timers = this.timers.filter((timer) => !timer.cancelled);
  }
}

describe("range transformation", () => {
  it("moves ranges for insertion before, after and inside", () => {
    expect(transformRanges([{ start: 5, end: 8 }], [{ from: 2, deleted: "", inserted: "xx" }])).toEqual([{ start: 7, end: 10 }]);
    expect(transformRanges([{ start: 5, end: 8 }], [{ from: 8, deleted: "", inserted: "xx" }])).toEqual([{ start: 5, end: 8 }]);
    expect(transformRanges([{ start: 5, end: 8 }], [{ from: 6, deleted: "", inserted: "xx" }])).toEqual([{ start: 5, end: 10 }]);
  });

  it("shrinks and removes ranges for covered deletion", () => {
    expect(transformRanges([{ start: 5, end: 10 }], [{ from: 3, deleted: "123", inserted: "" }])).toEqual([{ start: 3, end: 7 }]);
    expect(transformRanges([{ start: 5, end: 10 }], [{ from: 3, deleted: "123456789", inserted: "" }])).toEqual([{ start: 3, end: 3 }]);
  });

  it("handles deletions at both range boundaries", () => {
    expect(transformRanges([{ start: 5, end: 10 }], [{ from: 2, deleted: "abc", inserted: "" }])).toEqual([{ start: 2, end: 7 }]);
    expect(transformRanges([{ start: 5, end: 10 }], [{ from: 5, deleted: "abc", inserted: "" }])).toEqual([{ start: 5, end: 7 }]);
    expect(transformRanges([{ start: 5, end: 10 }], [{ from: 10, deleted: "abc", inserted: "" }])).toEqual([{ start: 5, end: 10 }]);
  });

  it("transforms replacements and accumulates offsets across one transaction", () => {
    expect(transformRanges([{ start: 5, end: 10 }], [{ from: 6, deleted: "ab", inserted: "WXYZ" }])).toEqual([{ start: 5, end: 12 }]);
    expect(transformRanges([{ start: 10, end: 20 }], [
      { from: 2, deleted: "", inserted: "abc" },
      { from: 15, deleted: "123", inserted: "Z" }
    ])).toEqual([{ start: 13, end: 21 }]);
  });
});

describe("tracker", () => {
  it("keeps an Agent change set until run completion and tracks its edit batch", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock, activeIdleMs: 100 });
    const actor = { kind: "agent" as const, runId: "run-a", ownerId: "alice" };
    tracker.startAgent(actor);
    tracker.openDocument("a.ts", "a");
    tracker.edit({ file: "a.ts", origin: actor, at: 0, ops: [{ from: 1, deleted: "", inserted: "A" }], revisionAfter: 1, textBefore: "a", textAfter: "aA" });
    clock.advance(10_000);
    expect(tracker.getActiveChangeSets()).toMatchObject([{ actor, status: "settled" }]);
    expect(tracker.getActiveChangeSets()[0]?.files.get("a.ts")?.baseText).toBe("a");
    tracker.markDone(actor);
    expect(tracker.getActiveChangeSets()).toEqual([]);
  });
  it("returns to editing when a settled actor starts editing another file", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock });
    tracker.openDocument("a.ts", "a");
    tracker.openDocument("b.ts", "b");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 1, "", "A", "aA", 0));
    clock.advance(1_500);
    expect(tracker.getActiveChangeSets()[0]?.status).toBe("settled");
    tracker.edit(edit("b.ts", { kind: "human", memberId: "alice" }, 1, "", "B", "bB", clock.now()));
    expect(tracker.getActiveChangeSets()[0]?.status).toBe("editing");
    tracker.flush();
  });

  it("closes existing batches when a document receives a new replay baseline", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock });
    const closed: string[] = [];
    tracker.onEvent((event) => { if (event.type === "batch_closed") closed.push(event.batch.file); });
    tracker.openDocument("a.ts", "a");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 1, "", "A", "aA", 0));
    tracker.openDocument("a.ts", "new");
    expect(closed).toEqual(["a.ts"]);
    expect(tracker.getActiveChangeSets()).toEqual([]);
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 3, "", "!", "new!", 1));
    expect(tracker.getActiveChangeSets()[0]?.files.get("a.ts")?.ranges).toEqual([{ start: 3, end: 4 }]);
    tracker.flush();
  });

  it("closes batches by idle, cursor distance and maximum duration", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock, createId: (() => { let id = 0; return () => `batch-${++id}`; })() });
    const events: string[] = [];
    tracker.onEvent((event) => events.push(event.type));
    tracker.openDocument("a.ts", "hello");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 0, "", "x", "xhello", clock.now()));
    clock.advance(1_500);
    expect(events).toContain("batch_closed");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 1, "", "y", "xyhello", clock.now()));
    tracker.cursorChanged({ actor: { kind: "human", memberId: "alice" }, file: "a.ts", lineNumber: 1, column: 1, at: clock.now() });
    tracker.cursorChanged({ actor: { kind: "human", memberId: "alice" }, file: "a.ts", lineNumber: 5, column: 1, at: clock.now() });
    expect(events.filter((event) => event === "batch_closed")).toHaveLength(2);
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 2, "", "z", "xyzhello", clock.now()));
    clock.advance(5_000);
    expect(events.filter((event) => event === "batch_closed")).toHaveLength(3);
  });

  it("keeps alternating actors in separate change sets and closes on done", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock });
    tracker.openDocument("a.ts", "0123456789");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 1, "", "A", "0A123456789", 0));
    tracker.edit(edit("a.ts", { kind: "human", memberId: "bob" }, 8, "", "B", "0A123456B789", 1));
    const sets = tracker.getActiveChangeSets();
    expect(sets).toHaveLength(2);
    expect(sets.map((set) => [...set.files.values()][0]?.baseText)).toEqual(["0123456789", "0A123456789"]);
    tracker.markDone({ kind: "human", memberId: "alice" });
    expect(tracker.getActiveChangeSets()).toHaveLength(1);
  });

  it("aggregates one actor across files and closes each file after active idle", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock, activeIdleMs: 600_000 });
    const events: string[] = [];
    tracker.onEvent((event) => events.push(event.type));
    tracker.openDocument("a.ts", "a");
    tracker.openDocument("b.ts", "b");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 1, "", "A", "aA", 0));
    tracker.edit(edit("b.ts", { kind: "human", memberId: "alice" }, 1, "", "B", "bB", 1));
    expect(tracker.getActiveChangeSets()).toHaveLength(1);
    expect([...tracker.getActiveChangeSets()[0]!.files.keys()]).toEqual(["a.ts", "b.ts"]);
    clock.advance(600_000);
    expect(tracker.getActiveChangeSets()).toHaveLength(0);
    expect(events.filter((event) => event === "change_set_closed")).toHaveLength(1);
  });

  it("closes the previous file batch when the cursor switches files", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock, cursorLeaveLines: 3 });
    const closed: Array<{ file: string; reason: string }> = [];
    tracker.onEvent((event) => {
      if (event.type === "batch_closed") closed.push({ file: event.batch.file, reason: event.batch.closeReason });
    });
    tracker.openDocument("a.ts", "hello");
    tracker.openDocument("b.ts", "world");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 0, "", "A", "Ahello", 0));
    tracker.cursorChanged({ actor: { kind: "human", memberId: "alice" }, file: "b.ts", lineNumber: 1, column: 1, at: 1 });
    expect(closed).toEqual([{ file: "a.ts", reason: "cursor-left" }]);
  });

  it("reports exact ranges for alternating edits by two actors", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock });
    tracker.openDocument("a.ts", "0123456789");
    tracker.edit(edit("a.ts", { kind: "human", memberId: "alice" }, 1, "", "A", "0A123456789", 0));
    tracker.edit({ file: "a.ts", origin: { kind: "human", memberId: "bob" }, at: 1, revisionAfter: 2, ops: [{ from: 10, deleted: "", inserted: "B" }], textBefore: "0A123456789", textAfter: "0A12345678B9" });
    const sets = tracker.getActiveChangeSets();
    expect(sets.find((set) => set.actor.kind === "human" && set.actor.memberId === "alice")?.files.get("a.ts")?.ranges).toEqual([{ start: 1, end: 2 }]);
    expect(sets.find((set) => set.actor.kind === "human" && set.actor.memberId === "bob")?.files.get("a.ts")?.ranges).toEqual([{ start: 10, end: 11 }]);
  });

  it("keeps a zero length range for a pure deletion", () => {
    const clock = new FakeClock();
    const tracker = new ConflictGuardTracker({ clock });
    tracker.openDocument("a.ts", "hello");
    tracker.edit({ file: "a.ts", origin: { kind: "human", memberId: "alice" }, at: 0, revisionAfter: 1, ops: [{ from: 1, deleted: "ell", inserted: "" }], textBefore: "hello", textAfter: "ho" });
    expect(tracker.getActiveChangeSets()[0]!.files.get("a.ts")?.ranges).toEqual([{ start: 1, end: 1 }]);
  });
});

function edit(file: string, origin: TextEdit["origin"], from: number, deleted: string, inserted: string, textAfter: string, at: number): TextEdit {
  return { file, origin, at, revisionAfter: at + 1, ops: [{ from, deleted, inserted }], textBefore: textAfter.slice(0, from) + deleted + textAfter.slice(from + inserted.length), textAfter };
}
