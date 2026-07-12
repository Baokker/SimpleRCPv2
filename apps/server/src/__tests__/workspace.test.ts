import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspacePath,
  resolveWorkspacePath,
  writeWorkspaceFile
} from "../workspace.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-workspace-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "hello.ts"),
    "export const hello = 'world';\n"
  );
  await fs.writeFile(path.join(root, "README.md"), "# Sample\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("workspace service", () => {
  it("resolves paths inside the workspace root", () => {
    expect(resolveWorkspacePath(root, "src/hello.ts")).toBe(
      path.join(root, "src", "hello.ts")
    );
  });

  it("rejects path traversal outside the workspace root", () => {
    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow(
      "Path escapes workspace root"
    );
  });

  it("lists nested files and directories", async () => {
    await expect(listWorkspaceTree(root)).resolves.toEqual([
      {
        name: "README.md",
        path: "README.md",
        type: "file"
      },
      {
        name: "src",
        path: "src",
        type: "directory",
        children: [
          {
            name: "hello.ts",
            path: "src/hello.ts",
            type: "file"
          }
        ]
      }
    ]);
  });

  it("hides common IDE, build, and binary noise from the tree", async () => {
    await fs.writeFile(path.join(root, ".DS_Store"), "");
    await fs.mkdir(path.join(root, ".idea"), { recursive: true });
    await fs.writeFile(path.join(root, ".idea", "workspace.xml"), "<project />");
    await fs.mkdir(path.join(root, "target", "classes"), { recursive: true });
    await fs.writeFile(path.join(root, "target", "classes", "Main.class"), "");
    await fs.writeFile(path.join(root, "src", "Generated.class"), "");

    const tree = await listWorkspaceTree(root);
    const serialized = JSON.stringify(tree);

    expect(serialized).not.toContain(".DS_Store");
    expect(serialized).not.toContain(".idea");
    expect(serialized).not.toContain("target");
    expect(serialized).not.toContain("Generated.class");
  });

  it("reads and writes files under the root", async () => {
    await expect(readWorkspaceFile(root, "src/hello.ts")).resolves.toBe(
      "export const hello = 'world';\n"
    );

    await writeWorkspaceFile(
      root,
      "src/hello.ts",
      "export const hello = 'team';\n"
    );

    await expect(readWorkspaceFile(root, "src/hello.ts")).resolves.toBe(
      "export const hello = 'team';\n"
    );
  });

  it("creates files and directories under the root", async () => {
    await createWorkspaceFile(root, "src/new.ts", "export const value = 1;\n");
    await createWorkspaceDirectory(root, "src/features");

    await expect(readWorkspaceFile(root, "src/new.ts")).resolves.toContain(
      "value"
    );
    const featuresStat = await fs.stat(path.join(root, "src", "features"));
    expect(featuresStat.isDirectory()).toBe(true);
  });

  it("renames files and directories without overwriting existing paths", async () => {
    await createWorkspaceDirectory(root, "src/features");
    await renameWorkspacePath(root, "src/hello.ts", "src/greeting.ts");
    await renameWorkspacePath(root, "src/features", "src/modules");

    await expect(readWorkspaceFile(root, "src/greeting.ts")).resolves.toContain(
      "world"
    );
    const modulesStat = await fs.stat(path.join(root, "src", "modules"));
    expect(modulesStat.isDirectory()).toBe(true);
    await expect(
      renameWorkspacePath(root, "src/greeting.ts", "README.md")
    ).rejects.toThrow("Target path already exists");
  });

  it("deletes files and directories but not the workspace root", async () => {
    await createWorkspaceDirectory(root, "src/features");
    await createWorkspaceFile(root, "src/features/example.ts", "");
    await deleteWorkspacePath(root, "src/features");

    await expect(
      fs.stat(path.join(root, "src", "features"))
    ).rejects.toThrow();
    await expect(deleteWorkspacePath(root, "")).rejects.toThrow(
      "Cannot delete workspace root"
    );
  });

  it("rejects mutation path traversal", async () => {
    await expect(
      createWorkspaceFile(root, "../escape.ts", "")
    ).rejects.toThrow("Path escapes workspace root");
    await expect(
      renameWorkspacePath(root, "src/hello.ts", "../escape.ts")
    ).rejects.toThrow("Path escapes workspace root");
    await expect(deleteWorkspacePath(root, "../escape.ts")).rejects.toThrow(
      "Path escapes workspace root"
    );
  });
});
