import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
const child = spawn("pnpm", ["--filter", "@simplercp/server", "replay:ui", ...process.argv.slice(2).filter((item) => item !== "--")], { cwd, stdio: "inherit" });
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
