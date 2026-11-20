import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { decide } from "../../../apps/server/src/guard/decide.js";
import type { GuardContext, GuardDecision, GuardRequest, Level, Action } from "../../../apps/server/src/guard/types.js";

export const projectRoot = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const defaultRuntimeRoot = path.join(projectRoot, ".test-workspaces", `guard-${process.pid}`);
export const runtimeRoot = process.env.SIMPLERCP_DATA_DIR ?? defaultRuntimeRoot;
export const workspaceRoot = path.join(runtimeRoot, "workspace");
export const dataRoot = path.join(runtimeRoot, "data");
export const resultsRoot = path.join(projectRoot, "experiments/guard/results-compact");
export const testedRef = process.env.COMPACT_TESTED_REF ?? "guard-compact-v3";
if (!["guard-compact-v1", "guard-compact-v2", "guard-compact-v3"].includes(testedRef)) throw new Error("Unknown ComPACT freeze tag");
export const runVersion = testedRef.replace("guard-compact-", "");

const git = (...args: string[]) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();

export function assertFrozenServer() {
  const commit = git("rev-parse", `${testedRef}^{commit}`);
  const changed = git("diff", "--name-only", commit, "--", "apps/server/src", "packages/shared/src");
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", "apps/server/src", "packages/shared/src");
  if (changed || untracked) throw new Error(`Server sources differ from ${testedRef}`);
  return commit;
}

export interface DatasetRecord {
  id: string;
  family: string;
  scenario: string;
  actor: { level: Level; viaAgent: boolean; agentKind: "personal" | "team" | null };
  input: { kind: "command" | "edit" | "read" | "fetch"; command?: string; paths?: string[]; url?: string; tool?: string };
  expected: Action | { atLeast: "ask" };
  malicious: boolean;
  label_source: string;
  rationale: string;
  notes?: string;
}

export interface RawRow {
  id: string;
  condition?: string;
  dataset: string;
  family: string;
  scenario: string;
  level: Level;
  source: "terminal" | "agent";
  input: DatasetRecord["input"];
  expected: DatasetRecord["expected"];
  actual: Action;
  malicious: boolean;
  matchedRules: string[];
  legacyRisk: string;
  autoEligible: boolean;
  durationMs: number;
  tracePath?: string;
  model?: string;
  risk?: "low" | "medium" | "high";
  confidence?: number;
  reason?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finalAction?: Action;
  llmApplied?: boolean;
  notes?: string;
  propertyEvidence?: Record<string, unknown>;
}

export function context(level: Level, overrides: Partial<GuardContext> = {}): GuardContext {
  return { memberLevel: level, initiatorOnline: true, workspaceRoot, platformDataRoot: dataRoot, otherWorkspaceRoots: [path.join(runtimeRoot, "other-project"), path.join(runtimeRoot, "p2")], ...overrides };
}

export function toRequest(item: DatasetRecord, source: "terminal" | "agent" = item.actor.viaAgent ? "agent" : "terminal"): GuardRequest {
  const resolveDataAlias = (value: string) => value.replaceAll("/platform/data", dataRoot);
  return { projectId: "experiment", memberId: "member", source, agentRunId: source === "agent" ? `run-${item.id}` : undefined, sessionScope: item.actor.agentKind === "team" ? "team" : "personal", agentHandle: source === "agent" ? "experiment-agent" : undefined, kind: item.input.kind, command: item.input.command === undefined ? undefined : resolveDataAlias(item.input.command), paths: item.input.paths?.map(resolveDataAlias), url: item.input.url, cwd: workspaceRoot };
}

export function evaluate(item: DatasetRecord, level: Level = item.actor.level, source: "terminal" | "agent" = item.actor.viaAgent ? "agent" : "terminal", overrides: Partial<GuardContext> = {}): GuardDecision {
  return decide(toRequest(item, source), context(level, overrides));
}

export function actionMeetsExpected(actual: Action, expected: DatasetRecord["expected"]): boolean {
  if (typeof expected === "string") return actual === expected;
  return actual === "ask" || actual === "deny";
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

export function mean(values: number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export async function loadDataset(name: string): Promise<DatasetRecord[]> {
  const datasetVersion = process.env.GUARD_DATASET_VERSION ?? "compact";
  const datasetDirectory = datasetVersion === "v1"
    ? path.join(projectRoot, "experiments/guard/datasets")
    : path.join(projectRoot, "experiments/guard/datasets", datasetVersion);
  const file = path.join(datasetDirectory, `${name}.jsonl`);
  const text = await fs.readFile(file, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as DatasetRecord);
}

export async function ensureRuntimeDirectory() {
  assertFrozenServer();
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });
  const otherProjectRoot = path.join(runtimeRoot, "other-project");
  const p2Root = path.join(runtimeRoot, "p2");
  await fs.mkdir(otherProjectRoot, { recursive: true });
  await fs.mkdir(p2Root, { recursive: true });
  await fs.mkdir(path.join(dataRoot, "projects", "x"), { recursive: true });
  await fs.mkdir(path.join(dataRoot, "projects", "other"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "README.md"), "# guard experiment\n");
  await fs.writeFile(path.join(workspaceRoot, ".env"), "FAKE_DB_PASSWORD=canary-experiment\n");
  await fs.writeFile(path.join(p2Root, "chat.json"), "{\"project\":\"p2\"}\n");
  await fs.writeFile(path.join(dataRoot, "projects", "x", "chat.json"), "{\"project\":\"x\"}\n");
  await fs.writeFile(path.join(dataRoot, "projects", "other", "chat.json"), "{\"project\":\"other\"}\n");
  await fs.rm(path.join(workspaceRoot, "linked"), { recursive: true, force: true });
  await fs.rm(path.join(workspaceRoot, "dangling"), { recursive: true, force: true });
  await fs.symlink(p2Root, path.join(workspaceRoot, "linked"), "dir");
  await fs.symlink(path.join(runtimeRoot, "missing-target"), path.join(workspaceRoot, "dangling"), "dir");
}

export async function environmentRecord(extra: Record<string, unknown> = {}) {
  const commit = assertFrozenServer();
  return {
    testedRef,
    commit,
    harnessCommit: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { cwd: projectRoot, encoding: "utf8" }).trim(),
    openCode: execFileSync(path.join(projectRoot, "apps/server/node_modules/.bin/opencode"), ["--version"], { cwd: projectRoot, encoding: "utf8" }).trim(),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    model: null,
    dataDir: runtimeRoot,
    pathAliases: { "/platform/data": dataRoot },
    ...extra
  };
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function writeRun(runDirectory: string, rows: unknown[], summary: unknown, extraEnv: Record<string, unknown> = {}) {
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "raw.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await fs.writeFile(path.join(runDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await fs.writeFile(path.join(runDirectory, "env.json"), `${JSON.stringify(await environmentRecord(extraEnv), null, 2)}\n`);
}

export function makeRunId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}`;
}
