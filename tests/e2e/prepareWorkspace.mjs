import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../fixtures/sample-workspace");
const target = fileURLToPath(
  new URL("../../.test-workspaces/e2e-workspace/", import.meta.url)
);

await fs.rm(target, { recursive: true, force: true });
await fs.cp(source, target, { recursive: true });
await fs.mkdir(path.join(target, "target", "classes"), { recursive: true });
await fs.mkdir(path.join(target, "target", "generated"), { recursive: true });
await fs.writeFile(
  path.join(target, "target", "classes", "Main.class"),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x01])
);
await fs.writeFile(
  path.join(target, "target", "generated", "large.js"),
  `// generated file\n${"const generated = true;\n".repeat(48_000)}`
);
