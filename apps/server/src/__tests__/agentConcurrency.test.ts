import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { getProjectMetadataPath } from "../projects.js";
import type { AgentRuntime } from "../agent/agentRuntime.js";
import { createOpenCodeRuntime } from "../agent/openCodeRuntime.js";
import { createLocalProcessLifecycle } from "./testProcessLifecycle.js";

describe("Agent concurrency with fake runtime", () => {
  let root: string;
  let server: http.Server;
  let origin: string;
  let memberId: string;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    root = await createTestWorkspace("agent-concurrency-");
    const demoRoot = path.join(root, "demo", "workspace");
    await fs.mkdir(demoRoot, { recursive: true });
    app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: demoRoot,
      fakeAgentRuntime: true,
      agent: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "fake-agent",
        maxConcurrentRuns: 2,
        runTimeoutMs: 10_000
      }
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    origin = `http://127.0.0.1:${address.port}`;
    const member = await joinMember(origin, "demo", { name: "Concurrency tester" });
    memberId = member.member.id;
  });

  afterEach(async () => {
    await app.locals.agentRuns.dispose();
    await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it("starts two sessions and fills the next slot when one finishes", async () => {
    const runs = await Promise.all([300, 300, 300].map((delay) => createRun(`fake-delay=${delay}`)));
    await waitFor(() => getRuns().then((items) => items.filter((run) => run.status === "running").length === 2));
    const firstRunning = (await getRuns()).filter((run) => run.status === "running");
    expect(firstRunning).toHaveLength(2);
    expect(firstRunning.every((run) => run.startedAt)).toBe(true);
    expect((await getRuns()).filter((run) => run.status === "queued")).toHaveLength(1);
    const finishedBeforeRefill = firstRunning[0]!;
    const queuedRun = runs[2]!;
    await waitFor(async () => {
      const items = await getRuns();
      return items.some((run) => run.id === finishedBeforeRefill.id && run.status === "completed") &&
        items.some((run) => run.id === queuedRun.id && run.status === "running");
    });
    const refilled = (await getRuns()).find((run) => run.id === queuedRun.id)!;
    const finishedRecord = (await getRuns()).find((run) => run.id === finishedBeforeRefill.id)!;
    expect(new Date(refilled.startedAt!).getTime()).toBeLessThanOrEqual(
      new Date(finishedRecord.finishedAt!).getTime() + 100
    );
    await waitFor(async () => (await getRuns()).every((run) => run.status === "completed"));
    const completed = (await getRuns()).filter((run) => runs.some((created) => created.id === run.id));
    expect(completed).toHaveLength(3);
    expect(completed.every((run) => new Date(run.startedAt!).getTime() < new Date(run.finishedAt!).getTime())).toBe(true);
    const initial = completed.filter((run) => firstRunning.some((running) => running.id === run.id));
    expect(initial).toHaveLength(2);
    expect(new Date(initial[0]!.startedAt!).getTime()).toBeLessThan(new Date(initial[1]!.finishedAt!).getTime());
    expect(new Date(initial[1]!.startedAt!).getTime()).toBeLessThan(new Date(initial[0]!.finishedAt!).getTime());
  });

  it("工作区快照读取失败时保留成功结果并记录归属错误", async () => {
    const run = await createRun("fake-delay=250 fake-write=snapshot-error.ts");
    await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && item.status === "running"));
    await waitFor(async () => (await getTrace(run.id)).some((event) => event.type === "agent_write"));
    const workspace = app.locals.runtimeManager.get("demo").project.workspacePath as string;
    const heldWorkspace = `${workspace}-held`;
    await fs.rename(workspace, heldWorkspace);
    try {
      await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && ["completed", "failed"].includes(item.status)));
      expect((await getRuns()).find((item) => item.id === run.id)?.status).toBe("completed");
      expect((await getTrace(run.id)).some((event) => event.type === "attribution_error")).toBe(true);
      expect(app.locals.agentRuns.diagnostics()).toMatchObject({ degraded: true, failures: { attribution: 1 } });
    } finally {
      await fs.rename(heldWorkspace, workspace);
    }
  });

  it("进程切换期间开始的运行记录订阅完成后的实际模型", async () => {
    let model = "old-model";
    const lifecycle = createLocalProcessLifecycle(100);
    const processRuntime = createOpenCodeRuntime({ port: 4096, baseUrl: "http://127.0.0.1:1", getSettings: () => ({ provider: "deepseek", model, enabled: true, apiKeyConfigured: true }), createProcess: lifecycle.create });
    const runtime = app.locals.agentRuntime as AgentRuntime;
    const originalSubscribe = runtime.subscribe.bind(runtime);
    runtime.acquireRun = processRuntime.acquireRun;
    runtime.getCurrentModel = processRuntime.getCurrentModel;
    runtime.subscribe = async (input, listener, onListenerError) => {
      await processRuntime.status();
      return originalSubscribe(input, listener, onListenerError);
    };
    try {
      await processRuntime.status();
      const previousRun = processRuntime.acquireRun!();
      model = "new-model";
      previousRun();
      const run = await createRun("fake-delay=20");
      await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && item.status === "completed"));
      expect((await app.locals.agentRuns.getRun("demo", run.id)).model).toBe(processRuntime.getCurrentModel!());
      expect(processRuntime.getCurrentModel!()).toBe("new-model");
      expect(lifecycle.records[0]!.disposeCount).toBe(1);
    } finally {
      await processRuntime.dispose();
      await lifecycle.disposeAll();
    }
  });

  it("轨迹文件无法写入时运行成功且恢复后仍能读取已有事件", async () => {
    const runtime = app.locals.agentRuntime as AgentRuntime;
    const subscribe = runtime.subscribe.bind(runtime);
    runtime.subscribe = async (input, listener, onListenerError) => {
      const stop = await subscribe(input, listener, onListenerError);
      return async () => { await stop(); throw new Error("event stop injection"); };
    };
    const run = await createRun("fake-delay=250");
    await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && item.status === "running"));
    await waitFor(async () => (await getTrace(run.id)).some((event) => event.type === "run_started"));
    const project = app.locals.runtimeManager.get("demo").project;
    const tracePath = path.join(getProjectMetadataPath(project), "agent-runs", run.id, "trace.jsonl");
    await fs.rename(tracePath, `${tracePath}.saved`);
    await fs.mkdir(tracePath);
    try {
      await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && ["completed", "failed"].includes(item.status)));
      expect((await getRuns()).find((item) => item.id === run.id)?.status).toBe("completed");
      expect(app.locals.agentRuns.diagnostics().failures.trace).toBeGreaterThan(0);
      expect(app.locals.agentRuns.diagnostics().failures.listener).toBe(1);
    } finally {
      await fs.rmdir(tracePath);
      await fs.rename(`${tracePath}.saved`, tracePath);
    }
    expect((await getTrace(run.id)).some((event) => event.type === "run_started")).toBe(true);
    const next = await createRun("fake-delay=10");
    await waitFor(async () => (await getRuns()).some((item) => item.id === next.id && item.status === "completed"));
  });

  it("serializes the same session and records tool attribution", async () => {
    const sessionResponse = await fetch(`${origin}/api/projects/demo/agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ title: "Shared session" })
    });
    const session = (await sessionResponse.json() as { session: { id: string } }).session;
    const first = await createRun("fake-delay=250 fake-write=one.ts", session.id);
    const second = await createRun("fake-delay=250 fake-write=two.ts", session.id);
    const independent = await createRun("fake-delay=250 fake-write=independent.ts");
    await waitFor(async () => {
      const items = await getRuns();
      return items.find((run) => run.id === first.id)?.status === "running" &&
        items.find((run) => run.id === second.id)?.status === "queued" &&
        items.find((run) => run.id === independent.id)?.status === "running";
    });
    await waitFor(async () => (await getRuns()).every((run) => run.status === "completed"));
    const completed = await getRuns();
    expect(completed.filter((run) => run.id === second.id && run.startedAt && run.finishedAt).every((run) =>
      new Date(run.startedAt!).getTime() >= new Date(completed.find((item) => item.id === first.id)!.finishedAt!).getTime()
    )).toBe(true);
    expect(completed.find((run) => run.id === independent.id)?.status).toBe("completed");
    expect(completed.flatMap((run) => run.fileChanges ?? []).map((change) => change.attribution)).toContain("tool");
  });

  it("attributes simultaneous writes to their own files", async () => {
    const created = await Promise.all([
      createRun("fake-delay=250 fake-write=alpha.ts"),
      createRun("fake-delay=250 fake-write=beta.ts")
    ]);
    await waitFor(async () => (await getRuns()).filter((run) => created.some((item) => item.id === run.id)).every((run) => run.status === "completed"));
    const completed = (await getRuns()).filter((run) => created.some((item) => item.id === run.id));
    expect(completed.map((run) => run.fileChanges?.map((change) => ({ file: change.file, attribution: change.attribution })))).toEqual(expect.arrayContaining([
      [{ file: "alpha.ts", attribution: "tool" }],
      [{ file: "beta.ts", attribution: "tool" }]
    ]));
  });

  it.each([[200, 50], [50, 200]])("同一 session 连续运行仅归属各自文件（%i ms、%i ms）", async (firstDelay, secondDelay) => {
    const response = await fetch(`${origin}/api/projects/demo/agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ title: "Sequential attribution" })
    });
    expect(response.status).toBe(201);
    const { session } = await response.json() as { session: { id: string } };
    const first = await createRun(`fake-delay=${firstDelay} fake-write=session-first.ts`, session.id);
    await waitFor(async () => (await getRuns()).find((run) => run.id === first.id)?.status === "completed");
    const second = await createRun(`fake-delay=${secondDelay} fake-write=session-second.ts`, session.id);
    await waitFor(async () => (await getRuns()).find((run) => run.id === second.id)?.status === "completed");

    const runs = await getRuns();
    expect(runs.find((run) => run.id === first.id)?.fileChanges?.map((change) => change.file)).toEqual(["session-first.ts"]);
    expect(runs.find((run) => run.id === second.id)?.fileChanges?.map((change) => change.file)).toEqual(["session-second.ts"]);
    const secondTrace = await getTrace(second.id);
    expect(secondTrace.find((event) => event.type === "session_diff_observed")?.data?.files).toEqual(["session-second.ts"]);
  });

  it("records overlap only for runs that actually overlap", async () => {
    const [first, second] = await Promise.all([
      createRun("fake-delay=250 fake-write=shared.ts"),
      createRun("fake-delay=250 fake-write=shared.ts")
    ]);
    await waitFor(async () => (await getRuns()).filter((run) => [first.id, second.id].includes(run.id)).every((run) => run.status === "completed"));
    const overlappingTrace = await Promise.all([first.id, second.id].map((runId) => getTrace(runId)));
    expect(overlappingTrace.every((events) => events.some((event) => event.type === "agent_overlap"))).toBe(true);
    expect(overlappingTrace[0]?.find((event) => event.type === "agent_overlap")?.data?.otherRunId).toBe(second.id);
    expect(overlappingTrace[1]?.find((event) => event.type === "agent_overlap")?.data?.otherRunId).toBe(first.id);

    const later = await createRun("fake-delay=10 fake-write=shared.ts");
    await waitFor(async () => (await getRuns()).some((run) => run.id === later.id && run.status === "completed"));
    const laterTrace = await getTrace(later.id);
    expect(laterTrace.some((event) => event.type === "agent_overlap")).toBe(false);
  });

  it("keeps a late short run out of the earlier run's file changes", async () => {
    const first = await createRun("fake-delay=200 fake-write=round2-first.ts");
    await waitFor(async () => (await getRuns()).some((run) => run.id === first.id && run.status === "running"));
    const second = await createRun("fake-delay=50 fake-write=round2-second.ts");
    await waitFor(async () => (await getRuns()).filter((run) => [first.id, second.id].includes(run.id)).every((run) => run.status === "completed"));
    const firstRun = (await getRuns()).find((run) => run.id === first.id)!;
    expect(firstRun.fileChanges?.map((change) => change.file)).toEqual(["round2-first.ts"]);
    await waitFor(async () => (await getTrace(first.id)).some((event) => event.type === "run_completed"));
    const firstCompleted = (await getTrace(first.id)).find((event) => event.type === "run_completed");
    expect(firstCompleted?.data).toMatchObject({ overlappingRunIds: [second.id] });
  });

  it("keeps different delayed concurrent runs attributed to their own files", async () => {
    const first = await createRun("fake-delay=220 fake-write=round2-own-a.ts");
    await waitFor(async () => (await getRuns()).some((run) => run.id === first.id && run.status === "running"));
    const second = await createRun("fake-delay=40 fake-write=round2-own-b.ts");
    await waitFor(async () => (await getRuns()).filter((run) => [first.id, second.id].includes(run.id)).every((run) => run.status === "completed"));
    const runs = await getRuns();
    expect(runs.find((run) => run.id === first.id)?.fileChanges?.map((change) => change.file)).toEqual(["round2-own-a.ts"]);
    expect(runs.find((run) => run.id === second.id)?.fileChanges?.map((change) => change.file)).toEqual(["round2-own-b.ts"]);
  });

  it("keeps a concurrent member edit in the Agent record", async () => {
    const runtime = app.locals.runtimeManager.get("demo");
    await fs.writeFile(path.join(runtime.project.workspacePath, "member.ts"), "base\n", "utf8");
    const document = await runtime.documents.getDocument(runtime.room.id, "member.ts");
    const run = await createRun("fake-delay=350 fake-write=member.ts");
    await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && item.status === "running"));
    document.getText("content").insert(0, "member edit\n");
    await waitFor(async () => (await getRuns()).some((item) => item.id === run.id && item.status === "completed"));
    const trace = await getTrace(run.id);
    expect(trace.some((event) => event.type === "concurrent_change")).toBe(true);
  });

  it("cancels one active run while the other completes", async () => {
    const [cancelled, completed] = await Promise.all([
      createRun("fake-delay=500 fake-write=cancelled.ts"),
      createRun("fake-delay=180 fake-write=completed.ts")
    ]);
    await waitFor(async () => (await getRuns()).some((run) => run.id === cancelled.id && run.status === "running"));
    await waitFor(async () => (await getTrace(cancelled.id)).some((event) => event.type === "agent_write"));
    const response = await fetch(`${origin}/api/projects/demo/agent/runs/${cancelled.id}/cancel`, { method: "POST", headers: { "X-SimpleRCP-Member": memberId } });
    expect(response.status).toBe(200);
    await waitFor(async () => (await getRuns()).filter((run) => [cancelled.id, completed.id].includes(run.id)).every((run) => ["cancelled", "completed"].includes(run.status)) && Boolean((await getRuns()).find((run) => run.id === cancelled.id)?.fileChanges));
    const runs = (await getRuns()).filter((run) => [cancelled.id, completed.id].includes(run.id));
    expect(runs.find((run) => run.id === cancelled.id)?.status).toBe("cancelled");
    expect(runs.find((run) => run.id === completed.id)?.status).toBe("completed");
    expect(runs.find((run) => run.id === cancelled.id)?.fileChanges).toEqual(expect.arrayContaining([expect.objectContaining({ file: "cancelled.ts", attribution: "tool" })]));
  });

  it("keeps an independent run completed when another run fails", async () => {
    const [failed, completed] = await Promise.all([
      createRun("fake-delay=100 fake-fail"),
      createRun("fake-delay=180 fake-write=survivor.ts")
    ]);
    await waitFor(async () => (await getRuns()).filter((run) => [failed.id, completed.id].includes(run.id)).every((run) => ["failed", "completed"].includes(run.status)));
    const runs = (await getRuns()).filter((run) => [failed.id, completed.id].includes(run.id));
    expect(runs.find((run) => run.id === failed.id)?.status).toBe("failed");
    expect(runs.find((run) => run.id === completed.id)?.status).toBe("completed");
  });

  it("runs three independent sessions together when the limit is three", async () => {
    const isolated = await startFakeServer(3);
    try {
      const created = await Promise.all([100, 140, 180].map((delay) => isolated.createRun(`fake-delay=${delay}`)));
      await isolated.waitFor(() => isolated.getRuns().then((runs) => created.every((createdRun) => runs.find((run) => run.id === createdRun.id)?.status === "running")));
      const running = await isolated.getRuns();
      const active = created.map((createdRun) => running.find((run) => run.id === createdRun.id)!);
      expect(active).toHaveLength(3);
      expect(new Set(active.map((run) => run.status))).toEqual(new Set(["running"]));
      expect(active.every((run) => run.startedAt)).toBe(true);
      expect(active.every((run) => active.some((other) => other.id !== run.id &&
        new Date(run.startedAt!).getTime() < new Date(other.finishedAt ?? "9999-12-31T23:59:59.999Z").getTime()
      ))).toBe(true);
      await isolated.waitFor(() => isolated.getRuns().then((runs) => created.every((createdRun) => runs.find((run) => run.id === createdRun.id)?.status === "completed")));
      const finished = await isolated.getRuns();
      const completed = finished.filter((run) => created.some((createdRun) => createdRun.id === run.id));
      expect(completed.every((run) => run.finishedAt)).toBe(true);
      expect(completed.every((run) => completed.some((other) => other.id !== run.id &&
        new Date(run.startedAt!).getTime() < new Date(other.finishedAt!).getTime()
      ))).toBe(true);
    } finally {
      await isolated.close();
    }
  });

  it("keeps strict FIFO order when the limit is one", async () => {
    const isolated = await startFakeServer(1);
    try {
      const created = await Promise.all([10, 20, 30].map((delay) => isolated.createRun(`fake-delay=${delay}`)));
      await isolated.waitFor(() => isolated.getRuns().then((runs) => created.every((createdRun) => runs.find((run) => run.id === createdRun.id)?.status === "completed")));
      const finished = (await isolated.getRuns()).filter((run) => created.some((createdRun) => createdRun.id === run.id));
      expect(finished.map((run) => run.id).sort((left, right) => (finished.find((run) => run.id === left)?.startedAt ?? "").localeCompare(finished.find((run) => run.id === right)?.startedAt ?? ""))).toEqual(created.map((run) => run.id));
    } finally {
      await isolated.close();
    }
  });

  it("records the updated model on a run created after a switch", async () => {
    const first = await createRun("fake-delay=180");
    await waitFor(async () => (await getRuns()).some((run) => run.id === first.id && run.status === "running"));
    await app.locals.agentSettings.update({ provider: "deepseek", model: "new-fake-model", enabled: true });
    const second = await createRun("fake-delay=10");
    await waitFor(async () => (await getRuns()).filter((run) => [first.id, second.id].includes(run.id)).every((run) => run.status === "completed"));
    const runs = (await getRuns()).filter((run) => [first.id, second.id].includes(run.id));
    expect(runs.find((run) => run.id === second.id)?.model).toBe("new-fake-model");
  });

  it("releases workspace preparation before the team run finishes", async () => {
    await fs.rm(path.join(app.locals.runtimeManager.get("demo").project.workspacePath, ".git"), { recursive: true, force: true });
    const agent = await app.locals.agentRuns.createTeamAgent({ projectId: "demo", memberId, name: "Build helper" });
    const teamRun = await app.locals.agentRuns.createRun({ projectId: "demo", memberId, prompt: "fake-delay=250", sessionId: agent.id });
    const personalRun = await createRun("fake-delay=10");
    await waitFor(async () => (await getRuns()).some((run) => run.id === teamRun.id && run.status === "running"));
    await waitFor(async () => (await getRuns()).some((run) => run.id === personalRun.id && run.status === "running"));
    expect((await getRuns()).find((run) => run.id === personalRun.id)?.status).toBe("running");
    await waitFor(async () => (await getRuns()).filter((run) => [teamRun.id, personalRun.id].includes(run.id)).every((run) => run.status === "completed"));
  });

  it("runs another team Agent concurrently and completes both runs", async () => {
    const firstAgent = await app.locals.agentRuns.createTeamAgent({ projectId: "demo", memberId, name: "Build helper one" });
    const secondAgent = await app.locals.agentRuns.createTeamAgent({ projectId: "demo", memberId, name: "Build helper two" });
    const firstRun = await app.locals.agentRuns.createRun({ projectId: "demo", memberId, prompt: "fake-delay=220", sessionId: firstAgent.id });
    const secondRun = await app.locals.agentRuns.createRun({ projectId: "demo", memberId, prompt: "fake-delay=80", sessionId: secondAgent.id });
    await waitFor(async () => {
      const runs = await getRuns();
      return runs.some((run) => run.id === firstRun.id && run.status === "running") && runs.some((run) => run.id === secondRun.id && run.status === "running");
    });
    const running = (await getRuns()).filter((run) => [firstRun.id, secondRun.id].includes(run.id) && run.status === "running");
    expect(running).toHaveLength(2);
    await waitFor(async () => (await getRuns()).filter((run) => [firstRun.id, secondRun.id].includes(run.id)).every((run) => run.status === "completed"));
  });

  it("interrupts the previous team Agent task when the same handle is mentioned again", async () => {
    const firstResponse = await fetch(`${origin}/api/projects/demo/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ text: "@agent fake-delay=400 fake-write=team-one.ts" })
    });
    expect(firstResponse.status).toBe(200);
    await waitFor(async () => (await getRuns()).some((run) => run.status === "running"));
    const secondResponse = await fetch(`${origin}/api/projects/demo/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ text: "@agent fake-delay=10 fake-write=team-two.ts" })
    });
    expect(secondResponse.status).toBe(200);
    await waitFor(async () => {
      const runs = await getRuns();
      return runs.filter((run) => run.sessionId && run.source === "chat").some((run) => run.status === "cancelled") && runs.filter((run) => run.sessionId && run.source === "chat").some((run) => run.status === "completed");
    });
    const teamRuns = (await getRuns()).filter((run) => run.source === "chat");
    expect(teamRuns.some((run) => run.status === "cancelled" && run.interruptedByRunId)).toBe(true);
    expect(teamRuns.some((run) => run.status === "completed")).toBe(true);
  });

  async function createRun(prompt: string, sessionId?: string) {
    const response = await fetch(`${origin}/api/projects/demo/agent/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ prompt, sessionId })
    });
    expect(response.status).toBe(202);
    return (await response.json() as { run: { id: string } }).run;
  }

  async function getRuns() {
    const response = await fetch(`${origin}/api/projects/demo/agent/runs`, {
      headers: { "X-SimpleRCP-Member": memberId }
    });
    return (await response.json() as { runs: Array<{ id: string; status: string; source?: string; sessionId?: string; model?: string; startedAt?: string; finishedAt?: string; interruptedByRunId?: string; fileChanges?: Array<{ file?: string; attribution?: string }> }> }).runs;
  }

  async function getTrace(runId: string) {
    const response = await fetch(`${origin}/api/projects/demo/agent/runs/${runId}/trace`, { headers: { "X-SimpleRCP-Member": memberId } });
    return (await response.json() as { events: Array<{ type: string; data?: Record<string, unknown> }> }).events;
  }

  async function waitFor(predicate: () => Promise<boolean>) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Timed out waiting for Agent runs");
  }

  async function startFakeServer(maxConcurrentRuns: number) {
    const isolatedRoot = await createTestWorkspace(`agent-concurrency-limit-${maxConcurrentRuns}-`);
    const isolatedDemoRoot = path.join(isolatedRoot, "demo", "workspace");
    await fs.mkdir(isolatedDemoRoot, { recursive: true });
    const isolatedApp = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(isolatedRoot, "data"),
      demoProjectRoot: isolatedDemoRoot,
      fakeAgentRuntime: true,
      agent: { baseUrl: "https://api.deepseek.com/v1", model: "fake-agent", maxConcurrentRuns, runTimeoutMs: 10_000 }
    });
    const isolatedServer = http.createServer(isolatedApp);
    await new Promise<void>((resolve) => isolatedServer.listen(0, "127.0.0.1", resolve));
    const address = isolatedServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    const isolatedOrigin = `http://127.0.0.1:${address.port}`;
    const isolatedMember = await joinMember(isolatedOrigin, "demo", { name: "Limit tester" });
    const headers = { "content-type": "application/json", "X-SimpleRCP-Member": isolatedMember.member.id };
    return {
      async createRun(prompt: string) {
        const response = await fetch(`${isolatedOrigin}/api/projects/demo/agent/runs`, { method: "POST", headers, body: JSON.stringify({ prompt }) });
        expect(response.status).toBe(202);
        return (await response.json() as { run: { id: string } }).run;
      },
      async getRuns() {
        const response = await fetch(`${isolatedOrigin}/api/projects/demo/agent/runs`, { headers });
        return (await response.json() as { runs: Array<{ id: string; status: string; startedAt?: string; finishedAt?: string }> }).runs;
      },
      async waitFor(predicate: () => Promise<boolean>) {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("Timed out waiting for isolated Agent runs");
      },
      async close() {
        await isolatedApp.locals.agentRuns.dispose();
        await isolatedApp.locals.runtimeManager.dispose();
        await new Promise<void>((resolve, reject) => isolatedServer.close((error) => error ? reject(error) : resolve()));
        await fs.rm(isolatedRoot, { recursive: true, force: true });
      }
    };
  }
});
