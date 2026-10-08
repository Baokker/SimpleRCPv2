import { test, expect } from "@playwright/test";
import { composeWorkspaceTree } from "../../apps/client/src/workspaceTree";
import type { WorkspaceNode } from "../../apps/client/src/types";

test("目录刷新保留期间新展开的内容，并采用已刷新的目录结果", () => {
  const file: WorkspaceNode = { name: "projectStatus.js", path: "src/projectStatus.js", type: "file" };
  const directory: WorkspaceNode = { name: "src", path: "src", type: "directory" };
  const previous = [{ ...directory, children: [file] }];
  const directories = new Map<string, WorkspaceNode[]>([["", [directory]]]);
  expect(composeWorkspaceTree([directory], directories, previous)).toEqual(previous);
  directories.set("src", []);
  expect(composeWorkspaceTree([directory], directories, previous)).toEqual([{ ...directory, children: [] }]);
  expect(composeWorkspaceTree([], directories, previous)).toEqual([]);
});
