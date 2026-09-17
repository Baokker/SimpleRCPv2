import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testWorkspacesRoot = fileURLToPath(
  new URL("../../../../.test-workspaces/", import.meta.url)
);

export async function createTestWorkspace(prefix: string) {
  await fs.mkdir(testWorkspacesRoot, { recursive: true });
  return fs.mkdtemp(path.join(testWorkspacesRoot, prefix));
}
