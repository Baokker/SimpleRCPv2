import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "../guard/decide.js";
import { legacyRisk } from "../guard/legacy/classifier.js";

const fixtureRoot = path.join(process.cwd(), "src/__tests__/fixtures/guard");
const workspace = "/workspace/project";

async function readLines(fileName: string) {
  const text = await fs.readFile(path.join(fixtureRoot, fileName), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("legacy guard fixture replay", () => {
  it("keeps the legacy risk labels for E1 command forms", async () => {
    const records = await readLines("commands.v2.provisional.jsonl");
    let total = 0;
    let matched = 0;
    for (const record of records) {
      const expected = record.expectedSemanticRisk;
      for (const item of record.commands as Array<{ text: string }>) {
        total += 1;
        if (legacyRisk(item.text) === (expected === null ? "unknown" : expected)) matched += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(matched).toBe(total);
  });

  it("does not allow E2 adversarial paths for student members", async () => {
    const records = await readLines("adversarial-cases.provisional.jsonl");
    const replacements: Record<string, string> = {
      "{OUTSIDE_FILE}": "/outside/file.txt",
      "{OUTSIDE}": "/outside",
      "{PROTECTED_FILE}": ".env"
    };
    for (const record of records) {
      if (record.expectedPathDecision !== "block") continue;
      const command = String(record.command).replace(/\{OUTSIDE_FILE\}|\{OUTSIDE\}|\{PROTECTED_FILE\}/g, (value) => replacements[value]!);
      const result = decide({ projectId: "project", memberId: "member", source: "terminal", kind: "command", command, cwd: workspace }, {
        memberLevel: "student",
        initiatorOnline: true,
        workspaceRoot: workspace,
        platformDataRoot: "/platform/data"
      });
      expect(result.action).not.toBe("allow");
    }
  });
});
