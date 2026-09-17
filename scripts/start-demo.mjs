import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(pnpmCommand, ["dev"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit"
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});

process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
