import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createOpenCodeRuntime } from "../apps/server/src/agent/openCodeRuntime.ts";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
require("../apps/server/node_modules/dotenv/lib/main.js").config({ path: path.join(repositoryRoot, ".env") });
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1";
const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");

const workspacePath = path.join(repositoryRoot, ".scratch/verify-opencode-concurrent-diff");
await fs.rm(workspacePath, { recursive: true, force: true });
await fs.mkdir(workspacePath, { recursive: true });
const execFileAsync = promisify(execFile);
const runtime = createOpenCodeRuntime({
  port: 40_960,
  apiKey,
  baseUrl,
  getSettings: () => ({
    provider: "deepseek",
    model,
    enabled: true,
    apiKeyConfigured: true
  })
});

await runtime.prepareWorkspace?.(workspacePath);
await fs.writeFile(path.join(workspacePath, "a.ts"), "export const baseA = true;\n", "utf8");
await fs.writeFile(path.join(workspacePath, "b.ts"), "export const baseB = true;\n", "utf8");
await execFileAsync("git", ["-C", workspacePath, "add", "a.ts", "b.ts"]);
await execFileAsync("git", ["-C", workspacePath, "-c", "user.name=verification", "-c", "user.email=verification@example.invalid", "commit", "--quiet", "-m", "baseline"]);
const first = await runtime.createSession({ workspacePath, title: "diff-a" });
const second = await runtime.createSession({ workspacePath, title: "diff-b" });
const differentResults = await Promise.all([
  runtime.run({
    workspacePath,
    sessionId: first.id,
    prompt: "Edit a.ts with the write tool and add an exported function named fromA. Reply with done."
  }),
  runtime.run({
    workspacePath,
    sessionId: second.id,
    prompt: "Edit b.ts with the write tool and add an exported function named fromB. Reply with done."
  })
]);
const differentFiles = await Promise.all([
  runtime.getDiff({ workspacePath, sessionId: first.id, messageId: differentResults[0].messageId }),
  runtime.getDiff({ workspacePath, sessionId: second.id, messageId: differentResults[1].messageId })
]);

await fs.writeFile(path.join(workspacePath, "a.ts"), "export const original = true;\n", "utf8");
await execFileAsync("git", ["-C", workspacePath, "add", "a.ts"]);
await execFileAsync("git", ["-C", workspacePath, "-c", "user.name=verification", "-c", "user.email=verification@example.invalid", "commit", "--quiet", "-m", "same-file-baseline"]);
const third = await runtime.createSession({ workspacePath, title: "same-a-1" });
const fourth = await runtime.createSession({ workspacePath, title: "same-a-2" });
const sameResults = await Promise.all([
  runtime.run({ workspacePath, sessionId: third.id, prompt: "Edit a.ts and add an exported function named fromC. Reply with done." }),
  runtime.run({ workspacePath, sessionId: fourth.id, prompt: "Edit a.ts and add an exported function named fromD. Reply with done." })
]);
const sameFile = await Promise.all([
  runtime.getDiff({ workspacePath, sessionId: third.id, messageId: sameResults[0].messageId }),
  runtime.getDiff({ workspacePath, sessionId: fourth.id, messageId: sameResults[1].messageId })
]);

console.log(JSON.stringify({ differentFiles, sameFile }, null, 2));
await runtime.dispose();
