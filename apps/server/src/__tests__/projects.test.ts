import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { createProjectRegistry } from "../projects.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;
let dataDir: string;
let demoProjectRoot: string;

beforeEach(async () => {
  root = await createTestWorkspace("projects-");
  dataDir = path.join(root, "data");
  demoProjectRoot = path.join(root, "demo-source");
  await fs.mkdir(path.join(demoProjectRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(demoProjectRoot, "src", "index.js"),
    "console.log('demo');\n"
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("project registry", () => {
  it("rejects invalid registry content", async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, "registry.json"), "null\n", "utf8");
    await expect(createProjectRegistry({ dataDir, demoProjectRoot })).rejects.toThrow(
      "Invalid project registry"
    );
  });

  it("creates the bundled Demo once and reloads it from the registry", async () => {
    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });
    const projects = await registry.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "demo",
      name: "Demo",
      source: "demo"
    });
    await expect(
      fs.readFile(path.join(projects[0]!.workspacePath, "src", "index.js"), "utf8")
    ).resolves.toBe("console.log('demo');\n");

    const restarted = await createProjectRegistry({ dataDir, demoProjectRoot });
    expect(await restarted.listProjects()).toEqual(projects);
  });

  it("creates an empty project and rejects a duplicate name", async () => {
    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });
    const project = await registry.createBlankProject("API Service");

    expect(project).toMatchObject({
      name: "API Service",
      source: "blank"
    });
    await expect(fs.stat(project.workspacePath)).resolves.toMatchObject({});
    await expect(registry.createBlankProject(" api service ")).rejects.toThrow(
      "A project with this name already exists"
    );

    const restarted = await createProjectRegistry({ dataDir, demoProjectRoot });
    expect(restarted.getProject(project.id)).toEqual(project);
  });

  it("deletes a stored project and removes it from the registry", async () => {
    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });
    const project = await registry.createBlankProject("Disposable App");
    const projectDir = path.dirname(project.workspacePath);

    await registry.deleteProject(project.id);

    await expect(fs.stat(projectDir)).rejects.toThrow();
    expect(registry.getProject(project.id)).toBeUndefined();
    expect(await registry.listProjects()).not.toContainEqual(project);
    const restarted = await createProjectRegistry({ dataDir, demoProjectRoot });
    expect(restarted.getProject(project.id)).toBeUndefined();
  });

  it("removes missing project directories from the visible registry", async () => {
    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });
    const project = await registry.createBlankProject("Missing App");
    await fs.rm(path.dirname(project.workspacePath), {
      recursive: true,
      force: true
    });

    const projects = await registry.listProjects();

    expect(projects.map((candidate) => candidate.id)).not.toContain(project.id);
    const restarted = await createProjectRegistry({ dataDir, demoProjectRoot });
    expect(restarted.getProject(project.id)).toBeUndefined();
  });

  it("keeps the bundled Demo project", async () => {
    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });

    await expect(registry.deleteProject("demo")).rejects.toThrow(
      "Demo project cannot be deleted"
    );
    expect(registry.getProject("demo")).toBeDefined();
  });

  it("imports a server directory into an independent filtered workspace", async () => {
    const sourceDir = path.join(root, "existing-project");
    await fs.mkdir(path.join(sourceDir, "src"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "node_modules", "package"), {
      recursive: true
    });
    await fs.mkdir(path.join(sourceDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "src", "main.ts"), "export {};\n");
    await fs.writeFile(path.join(sourceDir, ".DS_Store"), "metadata");

    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });
    const project = await registry.importDirectory("Imported API", sourceDir);

    expect(project.source).toBe("directory");
    expect(project.workspacePath).not.toBe(sourceDir);
    await expect(
      fs.readFile(path.join(project.workspacePath, "src", "main.ts"), "utf8")
    ).resolves.toBe("export {};\n");
    await expect(
      fs.stat(path.join(project.workspacePath, "node_modules"))
    ).rejects.toThrow();
    await expect(
      fs.stat(path.join(project.workspacePath, ".git"))
    ).rejects.toThrow();
    await expect(
      fs.stat(path.join(project.workspacePath, ".DS_Store"))
    ).rejects.toThrow();
    await expect(fs.readFile(path.join(sourceDir, ".DS_Store"), "utf8")).resolves.toBe(
      "metadata"
    );
  });

  it("imports a ZIP archive and reports filtered entries", async () => {
    const archive = await createZip([
      ["src/index.js", "console.log('zip');\n"],
      ["node_modules/package/index.js", "ignored\n"],
      [".DS_Store", "ignored\n"]
    ]);
    const registry = await createProjectRegistry({ dataDir, demoProjectRoot });

    const result = await registry.importZip("ZIP Project", archive);

    expect(result.filteredEntries).toBe(2);
    expect(result.project.source).toBe("zip");
    await expect(
      fs.readFile(path.join(result.project.workspacePath, "src", "index.js"), "utf8")
    ).resolves.toBe("console.log('zip');\n");
    await expect(
      fs.stat(path.join(result.project.workspacePath, "node_modules"))
    ).rejects.toThrow();
  });
});

function createZip(entries: Array<[string, string]>) {
  const zip = new ZipFile();
  for (const [entryPath, content] of entries) {
    zip.addBuffer(Buffer.from(content), entryPath);
  }
  zip.end();
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
