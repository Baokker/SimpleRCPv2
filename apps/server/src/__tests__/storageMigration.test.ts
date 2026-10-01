import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectRegistry } from "../projects.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { createAgentRunStore } from "../agent/agentRunStore.js";
import { createChatStore } from "../chat.js";
import { createEventLog } from "../eventLog.js";

describe("project storage migration", () => {
  it("moves legacy workspaces and records explicit metadata paths", async () => {
    const root = await createTestWorkspace("migration-");
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
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([false, true])("preserves metadata and resumes migration after a workspace move: %s", async (moved) => {
    const root = await createTestWorkspace("migration-data-");
    try {
      const metadataPath = path.join(root, "projects/legacy");
      const oldWorkspace = path.join(metadataPath, "workspace");
      const nextWorkspace = path.join(root, "workspaces/legacy");
      await fs.mkdir(oldWorkspace, { recursive: true });
      await fs.mkdir(path.join(root, "workspaces"));
      await fs.mkdir(path.join(root, "instance"));
      await fs.mkdir(path.join(root, "source"));
      await fs.writeFile(path.join(oldWorkspace, "README.md"), "legacy-content");
      const timestamp = new Date().toISOString();
      const project = { id: "legacy", name: "Legacy", source: "blank", workspacePath: oldWorkspace, createdAt: timestamp, lastOpenedAt: timestamp };
      await fs.writeFile(path.join(root, "registry.json"), JSON.stringify({ version: 1, projects: [project] }));
      await fs.writeFile(path.join(metadataPath, "project.json"), JSON.stringify(project));
      const events = createEventLog(path.join(metadataPath, "activity.json"));
      const event = events.append({ type: "workspace_file_created", memberId: "legacy-member", payload: { path: "README.md" } });
      await events.awaitIdle();
      const chat = createChatStore(events, { storagePath: path.join(metadataPath, "chat.json") });
      const message = await chat.createMessage({ roomId: "old-room", authorId: "legacy-member", authorName: "Ada", text: "Preserved chat" });
      await chat.awaitIdle();
      await events.awaitIdle();
      const runs = createAgentRunStore("legacy", metadataPath);
      const run = await runs.create({ projectId: "legacy", memberId: "legacy-member", prompt: "Historical task", status: "completed", runtime: "opencode", provider: "deepseek", model: "test" });
      if (moved) {
        await fs.writeFile(path.join(root, "instance/migration-legacy.started"), timestamp);
        await fs.rename(oldWorkspace, nextWorkspace);
      }
      const options = { dataDir: root, demoProjectRoot: path.join(root, "source") };
      const registry = await createProjectRegistry(options);
      const migrated = registry.getProject("legacy");
      expect(migrated).toMatchObject({ workspacePath: nextWorkspace, metadataPath });
      expect(JSON.parse(await fs.readFile(path.join(metadataPath, "project.json"), "utf8"))).toEqual(migrated);
      expect(await createAgentRunStore("legacy", metadataPath).get(run.id)).toEqual(run);
      const restoredEvents = createEventLog(path.join(metadataPath, "activity.json"));
      await restoredEvents.awaitIdle();
      expect(restoredEvents.list()).toContainEqual(event);
      const restoredChat = createChatStore(restoredEvents, { storagePath: path.join(metadataPath, "chat.json") });
      expect(await restoredChat.listMessages("old-room")).toEqual([message]);
      expect(await fs.readFile(path.join(nextWorkspace, "README.md"), "utf8")).toBe("legacy-content");
      await expect(fs.stat(path.join(root, "instance/migration-legacy.complete"))).resolves.toBeDefined();
      const restarted = await createProjectRegistry(options);
      expect(restarted.getProject("legacy")).toEqual(migrated);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
