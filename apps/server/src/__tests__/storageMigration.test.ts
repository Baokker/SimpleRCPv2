import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectRegistry } from "../projects.js";

describe("project storage migration", () => {
  it("moves legacy workspaces and records explicit metadata paths", async () => {
    await fs.mkdir(path.join(process.cwd(), ".test-workspaces"), { recursive: true });
    const root = await fs.mkdtemp(path.join(process.cwd(), ".test-workspaces", "migration-"));
    const projectDir = path.join(root, "projects", "legacy");
    const legacyWorkspace = path.join(projectDir, "workspace");
    await fs.mkdir(legacyWorkspace, { recursive: true });
    await fs.writeFile(path.join(legacyWorkspace, "README.md"), "legacy", "utf8");
    const project = { id: "legacy", name: "Legacy", source: "blank", workspacePath: legacyWorkspace, createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() };
    await fs.mkdir(path.join(root, "projects"), { recursive: true });
    await fs.writeFile(path.join(root, "registry.json"), JSON.stringify({ version: 1, projects: [project] }), "utf8");
    const demoRoot = path.join(root, "demo");
    await fs.mkdir(demoRoot, { recursive: true });
    const registry = await createProjectRegistry({ dataDir: root, workspacesDir: path.join(root, "workspaces"), demoProjectRoot: demoRoot });
    const migrated = registry.getProject("legacy");
    expect(migrated?.metadataPath).toBe(projectDir);
    expect(migrated?.workspacePath).toBe(path.join(root, "workspaces", "legacy"));
    await expect(fs.readFile(path.join(root, "workspaces", "legacy", "README.md"), "utf8")).resolves.toBe("legacy");
    await expect(fs.stat(path.join(root, "instance", "migration-legacy.complete"))).resolves.toBeDefined();
  });
});
