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

      const createResponse = await fetch(`${origin}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Blank App" })
      });
      const created = await createResponse.json() as {
        project: { id: string; name: string };
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
    } finally {
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
