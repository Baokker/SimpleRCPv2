import { describe, expect, it } from "vitest";
import { agentInsertedRanges, withSnapshotContents } from "../agent/agentKnowledgeHooks.js";

describe("Agent 知识归属", () => {
  it("仅登记可明确归属的新增文本，保留修改前后的内容", () => {
    const before = new Map([
      ["src/session.ts", { content: "export const session = 1;\n", bytes: Buffer.from("export const session = 1;\n") }],
      ["src/shared.ts", { content: "export const shared = 1;\n", bytes: Buffer.from("export const shared = 1;\n") }]
    ]);
    const after = new Map([
      ["src/session.ts", { content: "export const session = 1;\nexport const helper = 2;\n", bytes: Buffer.from("export const session = 1;\nexport const helper = 2;\n") }],
      ["src/shared.ts", { content: "export const shared = 3;\n", bytes: Buffer.from("export const shared = 3;\n") }]
    ]);
    const changes = withSnapshotContents([
      { file: "src/session.ts", additions: 1, deletions: 0, status: "modified", attribution: "tool" },
      { file: "src/shared.ts", additions: 1, deletions: 1, status: "modified", attribution: "ambiguous" }
    ], before, after);
    expect(changes[0]).toMatchObject({ beforeText: before.get("src/session.ts")!.content, afterText: after.get("src/session.ts")!.content });
    expect(agentInsertedRanges(changes, "alice")).toEqual([
      { file: "src/session.ts", start: 26, end: 51, text: "export const helper = 2;\n", ownerId: "alice" }
    ]);
  });
});
