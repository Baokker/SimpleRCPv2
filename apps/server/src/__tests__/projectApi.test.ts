import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("project-api-");
  await fs.mkdir(path.join(root, "demo", "workspace"), { recursive: true });
  await fs.writeFile(
    path.join(root, "demo", "workspace", "README.md"),
    "# Demo\n"
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("project API", () => {
  it("reports when the shared terminal is disabled", async () => {
    const app = await createApp({
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: path.join(root, "demo", "workspace"),
      terminalEnabled: false
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }

    try {
      const health = await fetch(
        `http://127.0.0.1:${address.port}/api/health`
      ).then((response) => response.json()) as {
        features: { terminal: boolean };
      };
      expect(health.features).toEqual({ terminal: false });
    } finally {
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  });

  it("lists the Demo and creates an empty project that can be opened", async () => {
    const app = await createApp({
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: path.join(root, "demo", "workspace")
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const initial = await fetch(`${origin}/api/projects`).then((response) =>
        response.json()
      ) as { projects: Array<{ id: string; name: string }> };
      expect(initial.projects).toMatchObject([{ id: "demo", name: "Demo" }]);

      await fetch(`${origin}/api/projects/demo`);
      expect(app.locals.runtimeManager.find("demo")).toBeDefined();
      const deleteDemoResponse = await fetch(`${origin}/api/projects/demo`, {
        method: "DELETE"
      });
      expect(deleteDemoResponse.status).toBe(400);
      expect(app.locals.runtimeManager.find("demo")).toBeDefined();

      const createResponse = await fetch(`${origin}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Blank App" })
      });
      const created = await createResponse.json() as {
        project: { id: string; name: string; workspacePath: string };
      };
      expect(createResponse.status).toBe(201);
      expect(created.project.name).toBe("Blank App");

      const openResponse = await fetch(
        `${origin}/api/projects/${created.project.id}`
      );
      const opened = await openResponse.json() as {
        project: { id: string };
        roomId: string;
      };
      expect(openResponse.status).toBe(200);
      expect(opened.project.id).toBe(created.project.id);
      expect(opened.roomId).toBeTruthy();

      const deleteResponse = await fetch(
        `${origin}/api/projects/${created.project.id}`,
        { method: "DELETE" }
      );
      expect(deleteResponse.status).toBe(200);
      await expect(deleteResponse.json()).resolves.toEqual({
        deletedProjectId: created.project.id
      });
      await expect(fs.stat(path.dirname(created.project.workspacePath))).rejects.toThrow();

      const projectsAfterDelete = await fetch(`${origin}/api/projects`).then(
        (response) => response.json()
      ) as { projects: Array<{ id: string }> };
      expect(projectsAfterDelete.projects.map((project) => project.id)).not.toContain(
        created.project.id
      );
    } finally {
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
