import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WebSocket from "ws";
import { createApp } from "../src/createApp.js";
import { attachRealtimeServer } from "../src/realtime.js";
import { loadConfig } from "../src/config.js";
import type { ProjectRuntime } from "../src/projectRuntime.js";

const config = loadConfig();
if (!config.agent?.apiKey) throw new Error("DeepSeek credentials are required for this verification");
const root = path.resolve("../../artifacts/knowledge-stage3-model", String(Date.now()));
await fs.mkdir(root, { recursive: true });
const source = path.join(root, "source");
await fs.mkdir(source, { recursive: true });
await fs.writeFile(path.join(source, "retry.ts"), "export const attempts = 5;\n");
const app = await createApp({ ...config, port: 0, dataDir: path.join(root, "data"), workspacesDir: path.join(root, "workspaces"), demoProjectRoot: source, terminalEnabled: false, fakeAgentRuntime: false, knowledge: "capture", captureConfig: { checkpointIdleMs: 500, chatAfterMs: 200 } });
const server = http.createServer(app);
const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const origin = `http://127.0.0.1:${port}`;
const providers: WebsocketProvider[] = [];
const docs: Y.Doc[] = [];
const clientPort = 5185;
const clientEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.includes("API_KEY")));
const client = spawn("pnpm", ["--filter", "@simplercp/client", "exec", "vite", "--host", "127.0.0.1", "--port", String(clientPort), "--strictPort"], {
  cwd: path.resolve("../.."), env: { ...clientEnvironment, VITE_SIMPLERCP_API_ORIGIN: origin, VITE_SIMPLERCP_CLIENT_PORT: String(clientPort) }, stdio: "ignore"
});
client.on("error", error => { throw error; });
const browser = await chromium.launch();

async function request(endpoint: string, body: unknown, memberId?: string) {
  const response = await fetch(`${origin}/api/projects/demo/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", ...(memberId ? { "X-SimpleRCP-Member": memberId } : {}) }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Knowledge verification request failed: ${response.status}`);
  return response.json();
}
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) { if (Date.now() > deadline) throw new Error("Knowledge capture verification timed out"); await new Promise(resolve => setTimeout(resolve, 20)); }
}
try {
  await until(async () => {
    if (client.exitCode !== null) throw new Error("Knowledge browser verification client exited");
    try { return (await fetch(`http://127.0.0.1:${clientPort}`)).ok; }
    catch (error) { if (error instanceof TypeError) return false; throw error; }
  });
  const ada = (await request("members", { name: "Ada" })).member.id as string;
  const bob = (await request("members", { name: "Bob" })).member.id as string;
  const runtime = app.locals.runtimeManager.get("demo") as ProjectRuntime;
  for (const memberId of [ada, bob]) {
    const doc = new Y.Doc(); docs.push(doc);
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/yjs/demo`, `${runtime.room.id}:retry.ts`, doc, { params: { memberId }, disableBc: true, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    providers.push(provider); await until(() => provider.synced);
  }
  const first = docs[0]!.getText("content"); const second = docs[1]!.getText("content");
  const original = "export function delay(attempt: number) {\n  const base = 100;\n  const wait = base;\n  return wait;\n}\n";
  first.insert(first.length, original); await until(() => second.toString().includes(original));
  const offset = second.toString().indexOf(original);
  const replacement = "export function delay(attempt: number) {\n  const base = 100;\n  const limit = 2000;\n  return Math.min(base * 2 ** attempt, limit);\n}\n";
  docs[1]!.transact(() => { second.delete(offset, original.length); second.insert(offset, replacement); });
  await until(async () => (await runtime.capture!.list(bob)).some(item => item.triggerType === "edit.overwritten"));
  const discussion = [
    "retry.ts 的 delay 当前是固定等待，连续失败会反复请求。", "同意，delay 应当使用指数等待。", "base 保留 100 毫秒。", "每次失败把等待翻倍。", "最大等待用 2000 毫秒。", "Math.min 可以限制最大等待。", "attempt 从零开始，第一次等待是 base。", "重试次数仍然由 attempts 控制。", "保持 attempts 为 5，不要让 delay 修改次数。", "确认使用 Math.min(base * 2 ** attempt, limit)。", "确认，这条规则记录到知识卡片，方便以后修改 retry.ts。"
  ];
  for (let i = 0; i < discussion.length; i++) await request("chat", { text: discussion[i] }, i % 2 ? bob : ada);
  await until(async () => (await runtime.capture!.list(bob)).some(item => item.triggerType === "chat.dense"));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(memberId => sessionStorage.setItem("simplercp.memberId.demo", memberId), bob);
  await page.goto(`http://127.0.0.1:${clientPort}/projects/demo`);
  await page.getByTestId("status-bar").waitFor();
  await page.getByTestId("file-retry.ts").click();
  await page.getByTestId("collab-tab-knowledge").click();
  const results: unknown[] = [];
  for (const trigger of ["edit.overwritten", "chat.dense"]) {
    const suggestion = (await runtime.capture!.list(bob)).find(item => item.triggerType === trigger)!;
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await page.getByTestId(`suggestion-${trigger}`).first().getByRole("button", { name: "AI 草稿", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(editor).toBeVisible({ timeout: 180_000 });
    await expect(editor).toContainText("原始证据");
    const generated = (await runtime.capture!.get(suggestion.id))!;
    const card = (await runtime.knowledge!.get({ memberId: bob, displayName: "Bob" }, generated.draftCardId!))!;
    const screenshot = trigger === "edit.overwritten" ? "S3-5-AI-overwritten.png" : "S3-6-AI-chat.png";
    await page.screenshot({ path: path.resolve("../../docs/knowledge/screenshots", screenshot) });
    await editor.getByRole("button", { name: "确认并保存" }).click();
    await expect(editor).not.toBeVisible();
    const confirmed = (await runtime.knowledge!.get({ memberId: bob, displayName: "Bob" }, card.id))!;
    if (confirmed.status !== "reviewed") throw new Error("Browser knowledge draft was not confirmed");
    results.push({ trigger, title: card.title, summary: card.summary, content: card.content, type: card.type, source: card.source, confirmedStatus: confirmed.status, ai: generated.ai });
  }
  await fs.writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2));
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} finally {
  await browser.close();
  client.kill("SIGTERM");
  for (const provider of providers) provider.destroy();
  for (const doc of docs) doc.destroy();
  await new Promise(resolve => setTimeout(resolve, 100));
  realtime.dispose(); await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
