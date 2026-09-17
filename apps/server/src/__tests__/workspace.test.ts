import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceDirectory,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspacePath,
  resolveWorkspacePath,
  writeWorkspaceFile
} from "../workspace.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("workspace-");
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

  it("lists one directory level at a time", async () => {
    await expect(listWorkspaceTree(root)).resolves.toEqual([
      {
        name: "README.md",
        path: "README.md",
        type: "file"
      },
      {
        name: "src",
        path: "src",
        type: "directory"
      }
    ]);
    await expect(listWorkspaceDirectory(root, "src")).resolves.toEqual([
      {
        name: "hello.ts",
        path: "src/hello.ts",
        type: "file"
      }
    ]);
  });

  it("filters browser-excluded entries while keeping build output", async () => {
    await fs.writeFile(path.join(root, ".DS_Store"), "");
    await fs.mkdir(path.join(root, ".idea"), { recursive: true });
    await fs.writeFile(path.join(root, ".idea", "workspace.xml"), "<project />");
    await fs.mkdir(path.join(root, "target", "classes"), { recursive: true });
    await fs.writeFile(path.join(root, "target", "classes", "Main.class"), "");
    await fs.writeFile(path.join(root, "src", "Generated.class"), "");

    const tree = await listWorkspaceTree(root);
    const serialized = JSON.stringify(tree);
    const srcEntries = JSON.stringify(await listWorkspaceDirectory(root, "src"));
    const targetEntries = JSON.stringify(
      await listWorkspaceDirectory(root, "target/classes")
    );

    expect(serialized).not.toContain(".DS_Store");
    expect(serialized).toContain(".idea");
    expect(serialized).toContain("target");
    expect(srcEntries).toContain("Generated.class");
    expect(targetEntries).toContain("Main.class");
  });

  it("reads and writes files under the root", async () => {
    await expect(readWorkspaceFile(root, "src/hello.ts")).resolves.toEqual({
      status: "text",
      path: "src/hello.ts",
      size: 30,
      content: "export const hello = 'world';\n"
    });

    await writeWorkspaceFile(
      root,
      "src/hello.ts",
      "export const hello = 'team';\n"
    );

    await expect(readWorkspaceFile(root, "src/hello.ts")).resolves.toMatchObject({
      status: "text",
      content: "export const hello = 'team';\n"
    });
  });

  it("classifies binary files without loading them as text", async () => {
    await fs.writeFile(path.join(root, "image.bin"), Buffer.from([1, 0, 2, 3]));

    await expect(readWorkspaceFile(root, "image.bin")).resolves.toEqual({
      status: "binary",
      path: "image.bin",
      size: 4
    });
  });

  it("requires force before loading large text files", async () => {
    const content = "a".repeat(1024 * 1024 + 1);
    await fs.writeFile(path.join(root, "large.js"), content);

    await expect(readWorkspaceFile(root, "large.js")).resolves.toEqual({
      status: "large",
      path: "large.js",
      size: content.length
    });
    await expect(readWorkspaceFile(root, "large.js", true)).resolves.toMatchObject({
      status: "text",
      content
    });
  });

  it("creates files and directories under the root", async () => {
    await createWorkspaceFile(root, "src/new.ts", "export const value = 1;\n");
    await createWorkspaceDirectory(root, "src/features");

    await expect(readWorkspaceFile(root, "src/new.ts")).resolves.toMatchObject({
      status: "text",
      content: expect.stringContaining("value")
    });
    const featuresStat = await fs.stat(path.join(root, "src", "features"));
    expect(featuresStat.isDirectory()).toBe(true);
  });

  it("renames files and directories without overwriting existing paths", async () => {
    await createWorkspaceDirectory(root, "src/features");
    await renameWorkspacePath(root, "src/hello.ts", "src/greeting.ts");
    await renameWorkspacePath(root, "src/features", "src/modules");

    await expect(readWorkspaceFile(root, "src/greeting.ts")).resolves.toMatchObject({
      status: "text",
      content: expect.stringContaining("world")
    });
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
