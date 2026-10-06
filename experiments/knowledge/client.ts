import fs from "node:fs/promises";
import path from "node:path";
import type {AgentRun, AgentTraceEvent, ProjectRecord} from "@simplercp/shared";
import type {ExperimentConfig, Task} from "./common.js";
import {benchRoot, exec, exists, hash, pause, readJson, root, writeJson} from "./common.js";

export class PlatformClient {
  constructor(readonly config: ExperimentConfig) {}
  async request<T = any>(route: string, member?: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
    const response = await fetch(this.config.origin + route, {
      method, headers: {"Content-Type": "application/json", ...(member ? {"X-SimpleRCP-Member": member} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  projectRoute(project: ProjectRecord, suffix: string) {return `/api/projects/${project.id}/${suffix}`;}
  async verify() {
    const settings = await this.request("/api/agent/settings");
    if (settings.provider !== this.config.provider || settings.model !== this.config.model) throw new Error("Experiment model differs from server settings");
    const status = await this.request("/api/experiments/status");
    if (!status.enabled || status.fakeAgentRuntime) throw new Error("A real experiment server is required");
    return status;
  }
  async verifyFor(directory: string) {
    const status = await this.verify();
    const file = path.join(directory, "server-configuration.json");
    if (await exists(file)) {
      if (JSON.stringify(await readJson(file)) !== JSON.stringify(status)) throw new Error("Server capture configuration changed during resume");
    } else await writeJson(file, status);
    await writeJson(path.join(directory, "runtime-status.json"), await this.request("/api/agent/status"));
    return status;
  }
  async create(task: Task, raw: string, key: string) {
    const saved = path.join(raw, "project.json");
    let created: {project: ProjectRecord; members: string[]; initialized?: boolean};
    if (await exists(saved)) created = await readJson(saved);
    else {
      const {project} = await this.request<{project: ProjectRecord}>("/api/projects/import", undefined, {name: `${key}-${Date.now()}`, path: path.join(benchRoot, "repos", task.repository)});
      created = {project, members: []};
      await writeJson(saved, created);
    }
    const {project, members} = created;
    if (created.initialized) return created;
    for (const name of ["member-a", "member-b", "member-c"].slice(members.length)) {
      const response = await this.request(this.projectRoute(project, "members"), undefined, {name, role: "developer"});
      members.push(response.member.id ?? response.member.memberId);
      await writeJson(saved, created);
    }
    // 依赖安装使用项目自身的 lockfile，输出保存在本次项目目录。
    const installed = await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {cwd: project.workspacePath, timeout: 60000});
    await fs.writeFile(path.join(raw, "install.txt"), installed.stdout + installed.stderr);
    if (!await exists(path.join(project.workspacePath, ".git"))) {
      await exec("git", ["init", "-q"], {cwd: project.workspacePath});
      await exec("git", ["add", "."], {cwd: project.workspacePath});
      await exec("git", ["-c", "user.name=Experiment", "-c", "user.email=experiment@example.invalid", "commit", "-qm", "baseline"], {cwd: project.workspacePath});
    }
    created.initialized = true;
    await writeJson(saved, created);
    return created;
  }
  async configure(project: ProjectRecord, member: string, patch: unknown) {
    return this.request(this.projectRoute(project, "knowledge/config"), member, patch, "PUT");
  }
  async run(project: ProjectRecord, member: string, prompt: string, saved: string, sessionId?: string): Promise<AgentRun> {
    if (await exists(saved)) return readJson<AgentRun>(saved);
    const {run} = await this.request<{run: AgentRun}>(this.projectRoute(project, "agent/runs"), member, {prompt, ...(sessionId ? {sessionId} : {})});
    await writeJson(saved, run);
    return run;
  }
  async teamRun(project: ProjectRecord, member: string, handle: string, prompt: string, saved: string): Promise<AgentRun> {
    if (await exists(saved)) return readJson<AgentRun>(saved);
    const messageFile = `${saved}.message.json`;
    let message: any;
    if (await exists(messageFile)) message = await readJson(messageFile);
    else {
      message = (await this.request(this.projectRoute(project, "chat"), member, {text: `@${handle} ${prompt}`})).message;
      await writeJson(messageFile, message);
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const {runs} = await this.request<{runs: AgentRun[]}>(this.projectRoute(project, "agent/runs"), member);
      const run = runs.find(item => item.chatMessageId === message.id);
      if (run) {await writeJson(saved, run); return run;}
      await pause(100);
    }
    throw new Error(`Team Agent did not accept chat: ${message.id}`);
  }
  async wait(project: ProjectRecord, member: string, run: AgentRun) {
    const deadline = Date.now() + this.config.timeoutMs + 30000;
    while (Date.now() < deadline) {
      const {run: current} = await this.request<{run: AgentRun}>(this.projectRoute(project, `agent/runs/${run.id}`), member);
      if (["completed", "failed", "cancelled"].includes(current.status)) return current;
      await pause(500);
    }
    await this.request(this.projectRoute(project, `agent/runs/${run.id}/cancel`), member, {});
    throw new Error(`Agent wait exceeded configured timeout: ${run.id}`);
  }
  async collect(project: ProjectRecord, member: string, run: AgentRun, raw: string) {
    const {events} = await this.request<{events: AgentTraceEvent[]}>(this.projectRoute(project, `agent/runs/${run.id}/trace`), member);
    await writeJson(path.join(raw, "run.json"), run);
    await writeJson(path.join(raw, "trace.json"), events);
    const injected = events.filter(event => event.type === "knowledge_injected");
    const tools = events.filter(event => event.type === "knowledge_tool_call");
    const postCheck = events.filter(event => event.type === "knowledge_post_check");
    await writeJson(path.join(raw, "injection.json"), {injected, tools, postCheck});
    await exec("git", ["add", "-N", "."], {cwd: project.workspacePath});
    const diff = (await exec("git", ["diff", "--no-ext-diff"], {cwd: project.workspacePath, maxBuffer: 20 * 1024 * 1024})).stdout;
    await fs.writeFile(path.join(raw, "workspace.patch"), diff);
    const snapshot = path.join(raw, "workspace");
    if (!await exists(snapshot)) await fs.cp(project.workspacePath, snapshot, {recursive: true, filter: source => !source.split(path.sep).includes(".git")});
    return {events, injected, tools, postCheck, snapshot, diffHash: hash(diff)};
  }
}
export async function judge(task: Task, workspace: string, raw: string) {
  const source = path.join(benchRoot, "tools/run-judge.mjs");
  const copy = path.join(root, ".work/judge/tools/run-judge.mjs");
  const bytes = await fs.readFile(source);
  await fs.mkdir(path.dirname(copy), {recursive: true});
  if (!await exists(copy)) await fs.copyFile(source, copy);
  if (hash(await fs.readFile(copy)) !== hash(bytes)) throw new Error("Judge copy differs from frozen dataset");
  const result = await exec(process.execPath, [copy, task.directory, workspace], {timeout: 190000, maxBuffer: 12 * 1024 * 1024});
  await fs.mkdir(raw, {recursive: true});
  await fs.writeFile(path.join(raw, "judge-output.json"), result.stdout);
  const actual = JSON.parse(result.stdout.trim());
  return {...actual, judgeHash: hash(bytes)};
}
