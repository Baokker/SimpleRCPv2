import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(
  new URL("../demo/workspace/", import.meta.url)
);

test("bundled demo workspace passes its own tests", () => {
  const result = spawnSync("npm", ["test", "--silent"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message
  );
});
