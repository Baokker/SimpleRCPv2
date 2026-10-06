import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "dotenv";
import { createOpenCodeRuntime } from "../src/agent/openCodeRuntime.js";
import { createAgentUsageCollector, estimateAgentUsageCost } from "../src/agent/agentUsage.js";
import { redactSensitive } from "../src/agent/traceStore.js";
import { buildRuntimePrompt } from "../src/agent/agentRunSupport.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const env = parse(await fs.readFile(path.join(repository, ".env"), "utf8"));
const provider = process.argv[2];
if (provider !== "minimax" && provider !== "deepseek") throw new Error("Choose minimax or deepseek");
const apiKey = provider === "minimax" ? env.MINIMAX_API_KEY : env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("Selected provider key is required");
const model = provider === "minimax" ? env.AGENT_MINIMAX_MODEL || env.MINIMAX_MODEL || "MiniMax-M2" : env.DEEPSEEK_MODEL || "deepseek-chat";
const runtime = createOpenCodeRuntime({ provider, apiKey, baseUrl: provider === "minimax" ? env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1" : env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", port: provider === "minimax" ? 4298 : 4299, getSettings: () => ({ provider, model, enabled: true, apiKeyConfigured: true }) });
const evidenceRoot = path.join(repository, "docs/knowledge/evidence/stage-6");
await fs.mkdir(evidenceRoot, { recursive: true });
const tasks = {
  money: "Fix money.js and cart.js so prices round to integer cents (1.005 becomes 101) and cart totals respect quantities.",
  immutable: "Fix sort.js and catalog.js so sorting never mutates input, frozen inputs work, and an empty catalog has cheapest result null.",
  escape: "Fix html.js and view.js so ampersand, angle brackets, double and single quotes are escaped exactly once, including attribute values.",
  cache: "Fix cache.js and service.js so user/locale tuple keys cannot collide and simultaneous requests for the same tuple share one load promise."
};
const execute = promisify(execFile);
try {
  for (const [task, request] of Object.entries(tasks)) for (let attempt = 1; attempt <= 2; attempt++) {
    const workspace = path.join(repository, "artifacts/stage6-model", `${provider}-${task}-${attempt}`);
    await fs.cp(path.join(repository, "demo/stage6-model-tasks", task), workspace, { recursive: true, errorOnExist: true });
    const tests = await fs.readFile(path.join(workspace, "rules.test.js"), "utf8");
    await runtime.prepareWorkspace?.(workspace);
    const session = await runtime.createSession({ workspacePath: workspace, title: `${task}-${attempt}` });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const collector = createAgentUsageCollector();
    const unsubscribe = await runtime.subscribe({ workspacePath: workspace, sessionId: session.id }, event => { collector.observe(event); events.push(event); });
    const startedAt = Date.now();
    let state = "completed"; let text = ""; let error: string | undefined;
    const timer = setTimeout(() => void runtime.cancel({ workspacePath: workspace, sessionId: session.id }), 240_000);
    try {
      const prompt = await buildRuntimePrompt(workspace, `${request} Read existing files, edit both source files, and run npm test. Do not modify rules.test.js.`, undefined, "Stage6 model smoke");
      const result = await runtime.run({ workspacePath: workspace, sessionId: session.id, prompt });
      text = result.text; collector.addResult(result.usage, result.messageId);
    } catch (caught) { state = "failed"; error = String(redactSensitive(String(caught), [apiKey])); }
    finally { clearTimeout(timer); await unsubscribe(); }
    const wallMs = Date.now() - startedAt;
    const parts = new Map<string, Record<string, unknown>>();
    for (const event of events) if (event.type === "message.part.updated" && event.data.part && typeof event.data.part === "object") {
      const part = event.data.part as Record<string, unknown>;
      if (part.type === "tool" && typeof part.id === "string") parts.set(part.id, part);
    }
    const tools = [...parts.values()].map(part => ({ tool: part.tool, state: part.state }));
    const toolErrors = tools.filter(tool => (tool.state as { status?: string })?.status === "error").length;
    const ranTests = tools.some(tool => tool.tool === "bash" && /npm test|node --test/.test(JSON.stringify((tool.state as { input?: unknown })?.input)));
    const code = (await Promise.all(["money.js", "cart.js", "sort.js", "catalog.js", "html.js", "view.js", "cache.js", "service.js"].map(async file => fs.readFile(path.join(workspace, file), "utf8").catch((caught: NodeJS.ErrnoException) => { if (caught.code === "ENOENT") return ""; throw caught; })))).join("\n");
    const reasoningLeaks = /<think>|<\/think>/.test(code + text) ? 1 : 0;
    const testsUnchanged = tests === await fs.readFile(path.join(workspace, "rules.test.js"), "utf8");
    const evaluation = await execute(process.execPath, ["--test", "rules.test.js"], { cwd: workspace }).then(() => ({ passed: true })).catch((caught: { stdout?: string; stderr?: string }) => ({ passed: false, output: String(redactSensitive((caught.stdout ?? "") + (caught.stderr ?? ""), [apiKey])).slice(0, 3000) }));
    const record = { provider, model, task, attempt, state, error, wallMs, usage: estimateAgentUsageCost(collector.total(), provider, model), toolErrors, toolCalls: tools.length, ranTests, reasoningLeaks, testsUnchanged, evaluation, reply: text };
    await fs.writeFile(path.join(evidenceRoot, `${provider}-${task}-${attempt}.json`), JSON.stringify(redactSensitive(record, [apiKey]), null, 2) + "\n");
    console.log(JSON.stringify({ provider, task, attempt, state, wallMs, passed: evaluation.passed, toolErrors, ranTests }));
  }
} finally { await runtime.dispose(); }
