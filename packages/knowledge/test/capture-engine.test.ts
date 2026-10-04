import { describe, expect, it } from "vitest";
import { AuthorshipIndex, VirtualCaptureClock, createCaptureEngine, replayEvents, NotificationPolicy, inferCoOccurrence, defaultCaptureEngineConfig, isCaptureEvent, extractKnowledgeCardDraft, type CaptureEvent, type CaptureSuggestion } from "../src/index.js";

function session() {
  const clock = new VirtualCaptureClock();
  const suggestions: CaptureSuggestion[] = [];
  const events: CaptureEvent[] = [];
  const engine = createCaptureEngine({ clock, onSuggestion: suggestion => suggestions.push(suggestion) });
  let text = ""; let seq = 0;
  const open = (value: string, file = "a.ts") => { text = value; feed({ type: "docOpen", file, text: value }); };
  const feed = (input: Record<string, unknown>, at = clock.now()) => {
    clock.advanceTo(at);
    const event = { schemaVersion: 1, seq: ++seq, at, ...input } as CaptureEvent;
    events.push(event); engine.process(event);
  };
  const edit = (value: string, actor = "Ada", at = clock.now(), file = "a.ts") => {
    feed({ type: "edit", file, actor, ops: [{ start: 0, deleteCount: text.length, insertText: value }], textBefore: text, textAfter: value }, at); text = value;
  };
  return { clock, suggestions, events, engine, open, feed, edit };
}

describe("authorship intervals", () => {
  it("transforms insertions before, after, and inside while retaining separate owners", () => {
    const index = new AuthorshipIndex();
    index.apply("a", "Ada", [{ start: 0, deleteCount: 0, insertText: "abcdef" }], 0);
    index.apply("a", "Bob", [{ start: 0, deleteCount: 0, insertText: "xx" }], 1);
    index.apply("a", "Bob", [{ start: 8, deleteCount: 0, insertText: "zz" }], 2);
    index.apply("a", "Bob", [{ start: 4, deleteCount: 0, insertText: "yy" }], 3);
    expect(index.get("a").filter(interval => interval.actor === "Ada")).toMatchObject([{ start: 2, end: 4, text: "ab" }, { start: 6, end: 10, text: "cdef" }]);
    const removed = index.apply("a", "Charlie", [{ start: 3, deleteCount: 5, insertText: "" }], 4);
    expect(removed.find(interval => interval.actor === "Ada")).toMatchObject({ deletedText: "bcd", deletedChars: 3, ratio: 0.5 });
    expect(index.get("a").filter(interval => interval.actor === "Ada")).toMatchObject([{ start: 2, end: 3, text: "a" }, { start: 3, end: 5, text: "ef" }]);
  });
  it("expires old intervals and excludes filesystem ownership", () => {
    const index = new AuthorshipIndex();
    index.apply("a", "Ada", [{ start: 0, deleteCount: 0, insertText: "abc" }], 0);
    expect(index.apply("a", "filesystem", [{ start: 0, deleteCount: 3, insertText: "xyz" }], 1)).toEqual([]);
    expect(index.get("a")).toEqual([]);
    index.apply("a", "Ada", [{ start: 0, deleteCount: 0, insertText: "abc" }], 2);
    index.apply("a", "Bob", [], 1_800_003);
    expect(index.get("a")).toEqual([]);
  });
  it("calculates overwrite ratio from surviving ownership intervals", () => {
    const index = new AuthorshipIndex();
    index.apply("a", "Ada", [{ start: 0, deleteCount: 0, insertText: "abcdefghij" }], 0);
    index.apply("a", "filesystem", [{ start: 0, deleteCount: 6, insertText: "" }], 1);
    expect(index.apply("a", "Bob", [{ start: 0, deleteCount: 3, insertText: "" }], 2)[0]).toMatchObject({ originalText: "abcdefghij", deletedText: "ghi", ratio: 0.75 });
  });
});

describe("checkpoint capture", () => {
  it("captures cleared TODO with marker lines and replays idle timers", () => {
    const s = session(); s.open("// TODO finish\nwork();\n"); s.edit("work();\n", "Ada", 100);
    s.clock.advanceTo(30_100);
    expect(s.suggestions).toMatchObject([{ triggerType: "todo.cleared", actors: { memberIds: ["Ada"] }, evidence: { file: "a.ts", todo: { before: [{ token: "TODO" }] } } }]);
    expect(replayEvents(s.events)).toEqual(s.suggestions);
  });
  it("does not capture when no marker existed or a marker remains", () => {
    const a = session(); a.open("work();"); a.edit("done();"); a.clock.advanceTo(30_000); expect(a.suggestions).toEqual([]);
    const b = session(); b.open("// TODO finish\n// HACK later"); b.edit("// HACK later"); b.clock.advanceTo(30_000); expect(b.suggestions).toEqual([]);
  });
  it("applies TODO cooldown and captures switching-file checkpoints immediately", () => {
    const s = session(); s.open("TODO"); s.edit("done"); s.feed({ type: "memberPresence", memberId: "Ada", action: "switchFile", previousFile: "a.ts", file: "b.ts" }, 1);
    s.edit("TODO", "Ada", 2); s.clock.advanceTo(30_002); s.edit("done", "Ada", 30_003); s.clock.advanceTo(60_003);
    expect(s.suggestions.filter(item => item.triggerType === "todo.cleared")).toHaveLength(1);
  });
  it("captures new numbers and searches other recorded workspace files", () => {
    const s = session(); s.feed({ type: "docOpen", file: "b.ts", text: "const old = 1234;" }); s.open("const delay = 1;"); s.edit("const delay = 1234;"); s.clock.advanceTo(30_000);
    expect(s.suggestions[0]).toMatchObject({ triggerType: "magicNumber.added", evidence: { usage: [{ occurrences: [{ file: "b.ts" }] }] } });
  });
  it.each(["const delay = 99;", "// milliseconds\nconst delay = 1234;", "const delay = 1234; // milliseconds"])("ignores small or documented numbers: %s", value => {
    const s = session(); s.open("const delay = 1;"); s.edit(value); s.clock.advanceTo(30_000); expect(s.suggestions).toEqual([]);
  });
  it("ignores non-JS files and applies magic-number cooldown", () => {
    const a = session(); a.open("1", "a.py"); a.edit("1234", "Ada", 0, "a.py"); a.clock.advanceTo(30_000); expect(a.suggestions).toEqual([]);
    const b = session(); b.open("const n = 1;"); b.edit("const n = 1234;"); b.clock.advanceTo(30_000); b.edit("const n = 5678;", "Ada", 30_001); b.clock.advanceTo(60_001); expect(b.suggestions).toHaveLength(1);
  });
  it("ignores string literals and multiline comments while counting new occurrences", () => {
    for (const after of ['const text = "1234";', '/*\n1234\n*/\nconst n = 1;']) {
      const s = session(); s.open("const n = 1;"); s.edit(after); s.clock.advanceTo(30_000); expect(s.suggestions).toEqual([]);
    }
    const s = session(); s.open("const a = 1234;"); s.edit("const a = 1234;\nconst b = 1234;"); s.clock.advanceTo(30_000);
    expect(s.suggestions[0]).toMatchObject({ triggerType: "magicNumber.added", evidence: { added: [{ number: "1234", line: 2 }] } });
  });
  it("captures dependency names at checkpoint and external changes", () => {
    const s = session(); s.open('{"dependencies":{}}', "package.json"); s.edit('{"dependencies":{"alpha":"1"}}', "Ada", 0, "package.json"); s.clock.advanceTo(30_000);
    s.feed({ type: "fileExternal", file: "package.json", change: "change", textBefore: '{"dependencies":{"alpha":"1"}}', textAfter: '{"dependencies":{"beta":"1"}}' });
    expect(s.suggestions.map(item => item.triggerType)).toEqual(["dependency.changed", "dependency.changed"]);
    expect(s.suggestions[1]).toMatchObject({ actors: { memberIds: [] }, evidence: { source: "filesystem", added: ["beta"], removed: ["alpha"] } });
  });
  it("ignores dependency version-only changes and temporarily incomplete JSON", () => {
    for (const after of ['{"dependencies":{"alpha":"2"}}', '{"dependencies":']) {
      const s = session(); s.open('{"dependencies":{"alpha":"1"}}', "package.json"); s.edit(after, "Ada", 0, "package.json"); s.clock.advanceTo(30_000); expect(s.suggestions).toEqual([]);
    }
  });
});

describe("edit and chat sequence capture", () => {
  it("captures a different member overwriting fresh text", () => {
    const s = session(); s.open(""); s.edit("one\ntwo\nthree\nfour\n", "Ada", 100); s.edit("replacement\n", "Bob", 200);
    expect(s.suggestions[0]).toMatchObject({ triggerType: "edit.overwritten", actors: { memberIds: ["Ada", "Bob"] }, evidence: { author: "Ada", editor: "Bob", replacement: "replacement\n", elapsedMs: 100 } });
  });
  it.each(["Ada", "filesystem", "unknown"])("does not trigger overwrite for %s", actor => {
    const s = session(); s.open(""); s.edit("abcdefgh", "Ada"); s.edit("replacement", actor, 1); expect(s.suggestions).toEqual([]);
  });
  it("respects overwrite age, exact half boundary and pair cooldown", () => {
    const old = session(); old.open(""); old.edit("abcdefgh"); old.edit("replacement", "Bob", 600_001); expect(old.suggestions).toEqual([]);
    const boundary = session(); boundary.open(""); boundary.edit("abcdefgh"); boundary.feed({ type: "edit", file: "a.ts", actor: "Bob", ops: [{ start: 0, deleteCount: 4, insertText: "" }] }, 1); expect(boundary.suggestions).toEqual([]);
    const cooled = session(); cooled.open(""); cooled.edit("abcdefgh", "Ada"); cooled.edit("replacement", "Bob", 1); cooled.edit("abcdefgh", "Ada", 2); expect(cooled.suggestions.filter(item => item.triggerType === "edit.overwritten")).toHaveLength(1);
  });
  it("captures cross-member restoration after a large deletion", () => {
    const s = session(); const initial = "x".repeat(501); s.open(initial); s.edit("", "Ada", 100); s.edit(initial, "Bob", 200);
    expect(s.suggestions).toMatchObject([{ triggerType: "rollback.detected", evidence: { deleter: "Ada", restorer: "Bob", deletion: { removedChars: 501 } } }]);
  });
  it("retains earlier large deletion hashes and applies restoration cooldown", () => {
    const s = session(); const original = "x".repeat(1503); s.open(original);
    s.edit("x".repeat(1002), "Ada", 1); s.edit("x".repeat(501), "Ada", 2); s.edit(original, "Ada", 3);
    s.edit("x", "Ada", 4); s.edit(original, "Ada", 5);
    expect(s.suggestions.filter(item => item.triggerType === "rollback.detected")).toHaveLength(1);
    expect(s.suggestions[0]?.evidence.deletedAt).toBe(1);
  });
  it("ignores rollback threshold and restoration after five minutes", () => {
    for (const [size, at] of [[500, 100], [501, 300_001]]) { const s = session(); const initial = "x".repeat(size!); s.open(initial); s.edit(""); s.edit(initial, "Ada", at!); expect(s.suggestions).toEqual([]); }
  });
  it("captures eleven member messages after the post-discussion window and cools down", () => {
    const s = session(); s.open("function choose() {}", "a.ts"); s.feed({ type: "cursor", memberId: "Ada", file: "a.ts", position: { line: 0, character: 0 }, selection: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 } });
    for (let i = 0; i < 22; i++) s.feed({ type: "chat", messageId: `m${i}`, authorId: "Ada", kind: "member", text: "a.ts `choose`" }, i + 1);
    s.clock.advanceTo(60_011);
    expect(s.suggestions).toHaveLength(1); expect(s.suggestions[0]).toMatchObject({ triggerType: "chat.dense", suggestedAnchors: [{ file: "a.ts", startLine: 1 }] });
    expect(replayEvents(s.events)).toEqual(s.suggestions);
  });
  it("excludes Agent messages and ten-message threshold", () => {
    for (const kind of ["member", "agent", "system"]) { const s = session(); for (let i = 0; i < 10; i++) s.feed({ type: "chat", messageId: `${i}`, authorId: "Ada", kind, text: "discussion" }); s.clock.advanceTo(60_000); expect(s.suggestions).toEqual([]); }
  });
  it("ignores member messages outside the discussion window", () => {
    const s = session(); for (let i = 0; i < 11; i++) s.feed({ type: "chat", messageId: `${i}`, authorId: "Ada", kind: "member", text: "discussion" }, i * 40_000); s.clock.advanceTo(500_000); expect(s.suggestions).toEqual([]);
  });
});

describe("co-occurrence inference and notifications", () => {
  it("uses dwell, edits and speakers; file mentions alter ranking", () => {
    const messages = [{ schemaVersion: 1 as const, type: "chat" as const, at: 100, seq: 1, messageId: "1", authorId: "Ada", kind: "member" as const, text: "discussion" }];
    const options = { messages, from: 0, to: 1000, weights: defaultCaptureEngineConfig.weights, texts: new Map([["a.ts", "function alpha() {}"], ["b.ts", "function beta() {}"]]), activities: [{ type: "cursor" as const, actor: "Ada", file: "a.ts", at: 0, startLine: 1, endLine: 1 }, { type: "cursor" as const, actor: "Ada", file: "b.ts", at: 600, startLine: 1, endLine: 1 }] };
    expect(inferCoOccurrence(options)[0]?.file).toBe("a.ts");
    messages[0]!.text = "b.ts `beta`";
    expect(inferCoOccurrence(options)[0]?.file).toBe("b.ts");
  });
  it("defers intense editing and caps popups at four per hour", () => {
    const policy = new NotificationPolicy();
    for (let i = 0; i < 8; i++) policy.record("Ada", "edit", i);
    expect(policy.decide("Ada", 10)).toBe("deferred");
    for (let i = 0; i < 4; i++) expect(policy.decide("Ada", 6000 + i)).toBe("popup");
    expect(policy.decide("Ada", 6010)).toBe("limit");
    expect(policy.decide("Ada", 3_606_010)).toBe("popup");
    const restored = new NotificationPolicy();
    for (let i = 0; i < 4; i++) restored.restorePopup("Ada", i);
    expect(restored.decide("Ada", 10)).toBe("limit");
  });
  it("ends cursor dwell when a speaker changes file or leaves", () => {
    const s = session(); s.open("function target() {}", "a.ts");
    s.feed({ type: "cursor", memberId: "Ada", file: "a.ts", position: { line: 0, character: 0 }, selection: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 } }, 1);
    s.feed({ type: "memberPresence", memberId: "Ada", action: "leave" }, 101);
    const message = { schemaVersion: 1 as const, type: "chat" as const, at: 1, seq: 1, messageId: "m", authorId: "Ada", kind: "member" as const, text: "讨论" };
    expect(s.engine.infer([message], 100_000)[0]?.score).toBeCloseTo(2.1);
  });
});

describe("capture recording validation", () => {
  const base = { schemaVersion: 1, at: 1, seq: 1 };
  it("validates event fields and edit coordinates", () => {
    expect(isCaptureEvent({ ...base, type: "docOpen", file: "a.ts", text: "abc" })).toBe(true);
    expect(isCaptureEvent({ ...base, type: "edit", file: "a.ts", actor: "Ada", ops: [{ start: 0, deleteCount: 1, insertText: "a" }], revisionAfter: 1 })).toBe(true);
    for (const value of [
      { ...base, type: "docOpen", file: "a.ts" },
      { ...base, type: "edit", file: "a.ts", actor: "Ada", ops: [{ start: -1, deleteCount: 0, insertText: "" }] },
      { ...base, type: "edit", file: "a.ts", actor: "Ada", textBefore: "a", ops: [{ start: 1, deleteCount: 1, insertText: "" }] },
      { ...base, type: "cursor", memberId: "Ada", file: "a.ts", position: { line: -1, character: 0 }, selection: {} },
      { ...base, type: "chat", messageId: "m", authorId: "Ada", kind: "other", text: "hi" }
    ]) expect(isCaptureEvent(value)).toBe(false);
  });
  it("reuses configurable thresholds for dependency and chat cooldown", () => {
    const clock = new VirtualCaptureClock(); const suggestions: CaptureSuggestion[] = [];
    const engine = createCaptureEngine({ clock, config: { chatMinMessages: 2, chatAfterMs: 1, dependencyCooldownMs: 100 }, onSuggestion: item => suggestions.push(item) });
    let seq = 0;
    const feed = (input: Record<string, unknown>, at: number) => { clock.advanceTo(at); engine.process({ ...base, ...input, seq: ++seq, at } as CaptureEvent); };
    feed({ type: "docOpen", file: "package.json", text: '{"dependencies":{}}' }, 0);
    feed({ type: "fileExternal", file: "package.json", change: "change", textAfter: '{"dependencies":{"alpha":"1"}}' }, 1);
    feed({ type: "fileExternal", file: "package.json", change: "change", textAfter: '{"dependencies":{"beta":"1"}}' }, 2);
    for (let i = 0; i < 4; i++) feed({ type: "chat", messageId: String(i), authorId: "Ada", kind: "member", text: "讨论" }, 3 + i);
    clock.advanceTo(10);
    expect(suggestions.map(item => item.triggerType)).toEqual(["dependency.changed", "chat.dense"]);
  });
});

describe("deterministic drafts from capture evidence", () => {
  it("preserves restored text and complete selected discussion without a model", async () => {
    const restored = "export const restored = true;";
    const rollback = await extractKnowledgeCardDraft({ triggerType: "rollback.detected", evidence: { file: "a.ts", restored, deletion: { removedChars: 501 }, beforeAfter: { before: restored, after: "" } } }, { model: "deterministic" });
    expect(rollback.content).toContain(restored);
    const messages = Array.from({ length: 11 }, (_, index) => ({ authorId: "Ada", text: index === 10 ? "确认 timeout 上限为 2000 毫秒" : `讨论 timeout ${index}` }));
    const discussion = await extractKnowledgeCardDraft({ triggerType: "chat.dense", evidence: { chatMessages: messages } }, { model: "deterministic" });
    expect(discussion.content).toContain(messages[10]!.text);
    expect(discussion.content).toContain("Ada");
  });
});
