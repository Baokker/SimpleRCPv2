import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../fixtures/sample-workspace");
const target = path.join(os.tmpdir(), "simplercp-e2e-workspace");

await fs.rm(target, { recursive: true, force: true });
await fs.cp(source, target, { recursive: true });
