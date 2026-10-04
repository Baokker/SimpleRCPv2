import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../fixtures/sample-workspace");
const target = fileURLToPath(
  new URL("../../.test-workspaces/e2e-data/workspaces/demo/", import.meta.url)
);

const dataDir = fileURLToPath(
  new URL("../../.test-workspaces/e2e-data/", import.meta.url)
);

await fs.rm(dataDir, { recursive: true, force: true });

await fs.cp(source, target, { recursive: true });
if ((process.env.KNOWLEDGE ?? "off") !== "off") {
  await fs.copyFile(
    path.resolve(here, "../../demo/workspace/src/projectStatus.js"),
    path.join(target, "src", "projectStatus.js")
  );
}
await fs.mkdir(path.join(dataDir, "projects", "demo"), { recursive: true });
const timestamp = new Date().toISOString();
const project = {
  id: "demo",
  name: "Demo",
  source: "demo",
  workspacePath: target.replace(/\/$/, ""),
  metadataPath: fileURLToPath(new URL("../../.test-workspaces/e2e-data/projects/demo/", import.meta.url)),
  createdAt: timestamp,
  lastOpenedAt: timestamp
};
await fs.writeFile(
  path.join(dataDir, "registry.json"),
  `${JSON.stringify({ version: 1, projects: [project] }, null, 2)}\n`
);
await fs.writeFile(
  path.join(dataDir, "projects", "demo", "project.json"),
  `${JSON.stringify(project, null, 2)}\n`
);
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
