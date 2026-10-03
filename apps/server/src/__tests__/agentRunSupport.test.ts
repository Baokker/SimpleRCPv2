import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimePrompt } from "../agent/agentRunSupport.js";
import { createTestWorkspace } from "./testWorkspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Agent runtime prompt scope", () => {
  it("adds workspace scope with selected file contexts", async () => {
    const root = await createTestWorkspace("agent-prompt-scope-");
    roots.push(root);
    await fs.writeFile(path.join(root, "README.md"), "Current project notes\n");

    const prompt = await buildRuntimePrompt(
      root,
      "Introduce this project",
      [{ type: "file", path: "README.md" }],
      "Current Project"
    );

    expect(prompt).toContain('You are working only on the project "Current Project".');
    expect(prompt).toContain(`The project workspace is ${root}.`);
    expect(prompt).toContain("Do not inspect, describe, or use any parent directory or parent repository.");
    expect(prompt).toContain("Current project notes");
    expect(prompt).toContain("User request:\nIntroduce this project");
  });

  it("adds workspace scope when no file contexts are selected", async () => {
    const root = await createTestWorkspace("agent-prompt-empty-context-");
    roots.push(root);

    const prompt = await buildRuntimePrompt(root, "Summarize this project", undefined, "Current Project");

    expect(prompt).toContain('You are working only on the project "Current Project".');
    expect(prompt).toContain(`The project workspace is ${root}.`);
    expect(prompt).toContain("User request:\nSummarize this project");
  });
});
