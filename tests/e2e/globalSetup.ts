import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export default async function globalSetup() {
  const source = path.resolve("tests/fixtures/sample-workspace");
  const target = path.join(os.tmpdir(), "simplercp-e2e-workspace");

  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true });
  process.env.SIMPLERCP_E2E_WORKSPACE = target;
}
