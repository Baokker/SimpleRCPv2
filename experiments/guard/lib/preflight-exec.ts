import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseShell } from "shell-quote";
import { projectRoot, resultsRoot } from "./common.js";
import { taskDefinitions } from "../x2-agent-e2e/task-runtime.js";
import { attackCalls, normalCalls } from "../x2-agent-e2e/run-deterministic.js";
import { DRAFT_FILE, allVariants, variantPayloads } from "../x2-agent-e2e/d5b-scenario.js";

// Preflight for the execution experiments (X2a, X2b, D5 live). It inspects task definitions, payloads and
// harness sources before anything runs. The run is blocked (exit code 1) when any of these fails:
//   1. a network address other than 127.0.0.1 or localhost appears (the model provider base URL used by
//      the real-model runners is the single listed exception),
//   2. a write or delete target resolves outside .experiment-data/,
//   3. a path reads a .env file outside the experiment workspace.
// The scan is conservative: tokens it cannot resolve are reported as violations rather than skipped.

const experimentData = path.join(projectRoot, ".experiment-data");
const guardRoot = path.join(projectRoot, "experiments/guard");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
// The only non-local endpoint: the MiniMax OpenAI-compatible base URL, supplied through MINIMAX_BASE_URL
// (default below) and used only by the real-model runners (X2b, D5 live).
export const ALLOWED_PROVIDER_URLS = ["https://api.minimaxi.com/v1"];
const PROVIDER_FILES = new Set(["x2-agent-e2e/run.ts", "x2-agent-e2e/run-d5-live.ts", "x2-agent-e2e/run-d5b-strong.ts"]);

interface Finding { check: "network" | "write-target" | "env-read"; where: string; detail: string }
const findings: Finding[] = [];
const notes: string[] = [];
const fail = (check: Finding["check"], where: string, detail: string) => findings.push({ check, where, detail });

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return files.flat();
}

function hostOf(value: string): string | null {
  const match = value.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/\s?#]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function checkNetworkText(where: string, text: string, providerAllowed: boolean) {
  const urls = text.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`)\\<>]+/gi) ?? [];
  for (const url of urls) {
    const cleaned = url.replace(/\$\{[^}]*\}.*$/, "");
    if (/^file:/i.test(cleaned)) continue;
    if (/^postgres:\/\/app:/i.test(cleaned)) { notes.push(`${where}: fake DATABASE_URL fixture value written into the workspace .env, never contacted`); continue; }
    const host = hostOf(cleaned);
    if (host && LOCAL_HOSTS.has(host)) continue;
    if (providerAllowed && ALLOWED_PROVIDER_URLS.includes(cleaned.replace(/\/+$/, ""))) continue;
    if (!host && url.startsWith("${")) continue; // template for the harness mock origin, checked at run time below
    fail("network", where, `non-local address ${url}`);
  }
  const addresses = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
  for (const address of addresses) if (address !== "127.0.0.1" && !isVersionLike(text, address)) fail("network", where, `IPv4 literal ${address}`);
}

function isVersionLike(text: string, address: string) {
  // Version strings such as 1.18.31.0 or package versions are not network addresses.
  const index = text.indexOf(address);
  return /version|v\d|@\d|"\d/i.test(text.slice(Math.max(0, index - 16), index));
}

function isInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const WRITE_VERBS = new Set(["rm", "rmdir", "mv", "cp", "touch", "tee", "mkdir", "ln", "chmod", "chown", "truncate", "dd", "install", "unlink"]);

function analyseCommand(where: string, command: string, workspace: string, origin: string) {
  const tokens = parseShell(command);
  const words: string[] = [];
  let nextIsRedirectTarget = false;
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (typeof token === "string") {
      if (nextIsRedirectTarget) { checkWrite(where, token, workspace, "redirection target"); nextIsRedirectTarget = false; continue; }
      words.push(token); segments.at(-1)!.push(token);
    } else if ("op" in token) {
      if ([">", ">>", ">|", "&>"].includes(token.op)) nextIsRedirectTarget = true;
      else segments.push([]);
    } else {
      fail("write-target", where, `unparsed shell construct in ${command}`);
    }
  }
  const mock = new URL(origin);
  for (const word of words) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word)) {
      const host = hostOf(word);
      if (!host || !LOCAL_HOSTS.has(host)) fail("network", where, `non-local URL ${word}`);
      else if (host === mock.hostname && new URL(word).port !== mock.port) fail("network", where, `local URL ${word} is not the harness mock origin`);
    }
    if (/(^|\/)\.env(\.|$)/.test(word.replace(/^@/, "")) || word === "@.env") checkEnvPath(where, word.replace(/^@/, ""), workspace);
  }
  for (const segment of segments) {
    const verb = path.basename(segment[0] ?? "");
    if (WRITE_VERBS.has(verb)) for (const arg of segment.slice(1).filter((value) => !value.startsWith("-"))) checkWrite(where, arg, workspace, `${verb} operand`);
    if (verb === "git") {
      const sub = segment.slice(1).find((value) => !value.startsWith("-") && !value.includes("="));
      const operands = segment.slice(1 + segment.indexOf(sub ?? "")).filter((value) => !value.startsWith("-"));
      if (sub === "clean" || sub === "checkout" || sub === "restore" || sub === "rm") for (const arg of operands.slice(1)) checkWrite(where, arg, workspace, `git ${sub} operand`);
      if (sub === "push") notes.push(`${where}: git push remote ${operands[1] ?? "?"} (a bare repository created by the harness inside .experiment-data)`);
    }
    if (verb === "curl") {
      segment.forEach((value, index) => {
        if (["-o", "--output", "-T", "--upload-file"].includes(value) && value !== "-T" && value !== "--upload-file") checkWrite(where, segment[index + 1] ?? "", workspace, "curl output");
      });
    }
    if (verb === "kill") {
      const ids = segment.slice(1).filter((value) => /^\d+$/.test(value));
      if (!ids.length || ids.some((value) => Number(value) <= 1)) fail("write-target", where, `kill without a harness-spawned PID: ${segment.join(" ")}`);
    }
    if (verb === "node" && segment.includes("-e")) {
      const script = segment[segment.indexOf("-e") + 1] ?? "";
      for (const match of script.matchAll(/writeFileSync\(\s*'([^']+)'/g)) checkWrite(where, match[1]!, workspace, "node -e write");
    }
  }
}

function checkWrite(where: string, target: string, workspace: string, role: string) {
  if (!target) return;
  if (/[$`*~]/.test(target)) { fail("write-target", where, `${role} ${target} uses an unresolved expansion`); return; }
  const resolved = path.resolve(workspace, target);
  if (!isInside(experimentData, resolved)) fail("write-target", where, `${role} ${target} resolves to ${resolved}, outside .experiment-data`);
  else if (!isInside(workspace, resolved)) notes.push(`${where}: ${role} ${target} stays inside .experiment-data but outside the workspace`);
}

function checkEnvPath(where: string, target: string, workspace: string) {
  const resolved = path.resolve(workspace, target);
  if (!isInside(workspace, resolved) || path.basename(resolved) !== ".env") fail("env-read", where, `.env path ${target} resolves to ${resolved}, outside the experiment workspace`);
}

async function scanSources() {
  const files = [
    ...(await walk(path.join(guardRoot, "x2-agent-e2e"))), ...(await walk(path.join(guardRoot, "tasks/v2"))),
    path.join(guardRoot, "x8-script/run.ts"), path.join(guardRoot, "x8-script/compact-v2.ts"), path.join(guardRoot, "lib/approval.ts"), path.join(guardRoot, "lib/mock-network.ts")
  ];
  for (const file of files.filter((value) => /\.(ts|json|md|sh)$/.test(value))) {
    const relative = path.relative(guardRoot, file);
    const text = await fs.readFile(file, "utf8");
    checkNetworkText(relative, text, PROVIDER_FILES.has(relative));
    // Any code that opens a .env file by itself (as opposed to the workspace-relative @.env payload).
    for (const match of text.matchAll(/(readFile\w*|parse|dotenv|config|source)\([^)\n]*["'\/]\.env["'\/.][^)\n]*\)|path\.join\([^)\n]*["']\.env["']/g)) {
      const line = text.slice(text.lastIndexOf("\n", match.index!) + 1, text.indexOf("\n", match.index!));
      if (!/workspace/.test(line)) fail("env-read", relative, `code reads .env: ${line.trim().slice(0, 160)}`);
    }
    if (/process\.env\.MINIMAX_API_KEY|MINIMAX_BASE_URL/.test(text) && !PROVIDER_FILES.has(relative)) notes.push(`${relative}: references provider settings`);
  }
  return files.length;
}

async function scanTaskPlans() {
  const root = path.join(experimentData, "preflight-check");
  let planned = 0;
  for (const task of taskDefinitions) {
    const workspace = path.join(root, task.id, "data/workspaces/demo");
    const origin = "http://127.0.0.1:43111";
    const calls = [...normalCalls(task), ...attackCalls(task, origin, 424242),
      { id: "normal-read", kind: "read" as const, path: "README.md" }, { id: "cross-project-read", kind: "read" as const, path: "../other-project/notes.md" }];
    for (const call of calls) {
      const where = `x2a/${task.id}/${call.id}`;
      planned += 1;
      if (call.kind === "bash") analyseCommand(where, call.command ?? "", workspace, origin);
      if (call.kind === "edit") checkWrite(where, call.path ?? "", workspace, "edit path");
      if (call.kind === "read") {
        const resolved = path.resolve(workspace, call.path ?? "");
        if (/\.env/.test(call.path ?? "")) checkEnvPath(where, call.path ?? "", workspace);
        if (!isInside(path.join(root, task.id), resolved)) fail("env-read", where, `read path ${call.path} resolves outside the experiment sandbox (${resolved})`);
      }
      if (call.kind === "webfetch") checkNetworkText(where, call.url ?? "", false);
    }
    // Prompts and injected instructions given to the model in X2b, and README payloads of the v2 tasks.
    const readme = task.prompt;
    checkNetworkText(`x2b/${task.id}/prompt`, readme, false);
  }
  return planned;
}

async function scanD5bPayloads() {
  const workspace = path.join(experimentData, "preflight-check", "d5b", "data", "workspaces", "demo");
  const allowedFiles = new Set([DRAFT_FILE, "README.md", "notes-bob.md", "package.json", "sum.cjs", "test.cjs", "cleanup.sh", "CHECKLIST.md", "SUMMARY.md"]);
  let count = 0;
  for (const payload of variantPayloads()) {
    const where = `d5b/${payload.variant}/${payload.where}`;
    count += 1;
    checkNetworkText(where, payload.text, false);
    for (const match of payload.text.matchAll(/(?:^|[\s`"'(])((?:\.\.\/|\/)[^\s`"')]+|[A-Za-z0-9_.-]+\.(?:txt|md|json|cjs|sh))/g)) {
      const target = match[1]!;
      if (target.startsWith("../") || target.startsWith("/")) { fail("write-target", where, `payload path ${target} is outside the workspace`); continue; }
      if (target === ".env" || target.startsWith(".env.")) { fail("env-read", where, `payload references ${target}`); continue; }
      if (!allowedFiles.has(target)) fail("write-target", where, `payload references unexpected workspace file ${target}`);
    }
    for (const match of payload.text.matchAll(/\b(rm|unlink|truncate|mv|cp|shred)\s+(?:-\S+\s+)*([^\s`"';|]+)/g)) {
      const target = match[2]!;
      if (target !== DRAFT_FILE) fail("write-target", where, `${match[1]} operand ${target} is not ${DRAFT_FILE}`);
    }
  }
  return { payloads: count, variants: allVariants.length, workspace };
}

async function scanTaskFiles() {
  let count = 0;
  for (const file of (await walk(path.join(guardRoot, "tasks/v2"))).filter((value) => value.endsWith(".sh"))) {
    count += 1;
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split("\n").filter((value) => value.trim() && !value.startsWith("#") && !value.startsWith("set "))) {
      analyseCommand(`tasks/v2/${path.relative(path.join(guardRoot, "tasks/v2"), file)}`, line, path.join(experimentData, "preflight-check/task-scripts/data/workspaces/demo"), "http://127.0.0.1:43121");
    }
  }
  return count;
}

async function main() {
  const gitignored = await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8");
  if (!/^\.experiment-data\/?$/m.test(gitignored)) fail("write-target", ".gitignore", ".experiment-data/ is not ignored by git");
  await fs.mkdir(experimentData, { recursive: true });
  const real = await fs.realpath(experimentData);
  if (real !== experimentData && !isInside(projectRoot, real)) fail("write-target", ".experiment-data", `resolves through a link to ${real}`);
  const sources = await scanSources();
  const plans = await scanTaskPlans();
  const scripts = await scanTaskFiles();
  const d5b = await scanD5bPayloads();
  const result = {
    status: findings.length ? "failed" : "passed",
    checkedAt: new Date().toISOString(),
    scope: { sourceFiles: sources, plannedHarnessCalls: plans, taskScripts: scripts, tasks: taskDefinitions.length, d5bVariants: d5b.variants, d5bPayloads: d5b.payloads, d5bWorkspace: d5b.workspace },
    allowedNonLocalEndpoints: ALLOWED_PROVIDER_URLS.map((url) => ({ url, usedBy: [...PROVIDER_FILES], reason: "MiniMax model provider for the real-model conditions only" })),
    rules: ["every network address is 127.0.0.1 or localhost, except the listed provider URL", "every write or delete target resolves inside .experiment-data/", "no path reads a .env file outside the experiment workspace", "every D5b payload mentions only allowed workspace files and targets alice-draft.txt for deletion"],
    findings, notes
  };
  await fs.mkdir(resultsRoot, { recursive: true });
  await fs.writeFile(path.join(resultsRoot, "PREFLIGHT.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (findings.length) { console.error(`PREFLIGHT FAILED: ${findings.length} finding(s). No experiment may run.`); process.exit(1); }
}

await main();
