import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listWorkspaceTree,
  readWorkspaceFile,
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
});
