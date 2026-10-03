import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureWorkspaceRepository } from "../agent/openCodeRuntime.js";
import { createTestWorkspace } from "./testWorkspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Team Agent workspace repository", () => {
  it("keeps an existing workspace repository and does not initialize it again", async () => {
    const root = await createTestWorkspace("team-workspace-git-");
    roots.push(root);
    await fs.mkdir(path.join(root, ".git"));
    await fs.writeFile(path.join(root, ".git", "marker"), "preserved\n");

    await expect(ensureWorkspaceRepository(root)).resolves.toBe(false);

    await expect(fs.readFile(path.join(root, ".git", "marker"), "utf8")).resolves.toBe("preserved\n");
  });
});
