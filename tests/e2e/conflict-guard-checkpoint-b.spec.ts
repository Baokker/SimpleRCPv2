import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openAs } from "./helpers";

const shop = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/checkpoint-b-manual/", import.meta.url));
test.skip(process.env.SIMPLERCP_CHECKPOINT_B_LIVE !== "1", "真实 Agent 验收通过显式命令运行");

test("canonical workspace permits a real Agent edit while preserving human priority", async ({ browser }) => {
  const pair = await openPair(browser);
  try {
    const project = await request(pair.alice, pair.id, "");
    expect(project.project.workspacePath.startsWith("/tmp/")).toBe(true);
    expect(await fs.realpath(project.project.workspacePath)).toContain("/private/tmp/");
    await openFile(pair.alice, "src/pricing.ts");
    await edit(pair.alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await pair.alice.waitForTimeout(2000);
    await pair.bob.getByTestId("collab-tab-agent").click();
    await pair.bob.getByTestId("agent-prompt").fill("Change only src/checkout.ts: prefix checkout's returned formatted string with 'Total: '. Use the edit tool, never bash or another tool to write files. Read related files if needed. If approval rejects the change, report the reason and stop; do not repeat the same edit. Do not change other files, inspect parent directories, or inspect environment/configuration files.");
    await pair.bob.getByTestId("agent-run-submit").click();
    const run = await latestRun(pair.bob, pair.id);
    const finished = await finish(pair.bob, pair.id, run.id);
    const trace = await request(pair.bob, pair.id, `/agent/runs/${run.id}/trace`);
    const replies = trace.events.filter((event: any) => event.type === "permission_reply");
    expect(replies.length).toBeGreaterThan(0);
    expect(trace.events.filter((event: any) => event.type === "permission_handler_error")).toEqual([]);
    expect(JSON.stringify(replies)).not.toContain("could not verify");
    expect(JSON.stringify(replies)).not.toContain("Path escapes workspace root");
    expect(replies.every((event: any) => ["once", "reject"].includes(event.data.reply))).toBe(true);
    await expect(pair.alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(pair.alice.getByTestId("conflict-card")).toHaveCount(0);
    await save(pair, "01-symbolic-agent", { run: finished, trace, replies, checks: { canonicalPath: true, explicitPermission: true, humanEditable: true } });
  } finally { await pair.close(); }
});

test("a real Agent rereads a proposal changed during model adjudication", async ({ browser }) => {
  const pair = await openPair(browser);
  try {
    await openFile(pair.alice, "src/pricing.ts");
    await edit(pair.alice, "src/pricing.ts", "return price * (1 - rate);", "return Math.max(0, price * (1 - rate));");
    await pair.alice.waitForTimeout(2000);
    await openFile(pair.alice, "src/cart.ts");
    await pair.bob.getByTestId("collab-tab-agent").click();
    await pair.bob.getByTestId("agent-prompt").fill("Change only src/cart.ts: at the beginning of Cart.total add 'if (this.items.length === 0) return 0;'. Preserve the existing discount calculation and every other line. Use edit, never bash to write. When approval rejects because the file changed, reread src/cart.ts and repeat your requested change while keeping every other line. If rejected because of a semantic conflict, report the reason and stop. Do not change other files, inspect parent directories, or inspect environment/configuration files.");
    await pair.bob.getByTestId("agent-run-submit").click();
    const run = await latestRun(pair.bob, pair.id);
    await expect.poll(async () => (await request(pair.bob, pair.id, `/agent/runs/${run.id}/trace`)).events.some((event: any) => event.type === "opencode.permission.asked"), { timeout: 90000, intervals: [100] }).toBe(true);
    await expect.poll(async () => (await request(pair.bob, pair.id, "/conflict-guard/state")).pairDecisions.some((record: any) => record.point === "T2" && record.status === "analyzing"), { timeout: 10000, intervals: [50] }).toBe(true);
    await edit(pair.alice, "src/cart.ts", "this.items = [...this.items, item];", "this.items = [item, ...this.items];");
    const finished = await finish(pair.bob, pair.id, run.id);
    const trace = await request(pair.bob, pair.id, `/agent/runs/${run.id}/trace`);
    const source = await disk(pair.alice, pair.id, "src/cart.ts");
    expect(source).toContain("this.items = [item, ...this.items];");
    const replies = trace.events.filter((event: any) => event.type === "permission_reply");
    const approved = replies.some((event: any) => event.data.reply === "once");
    const staleRejected = replies.some((event: any) => event.data.reply === "reject" && event.data.message?.includes("文件在你修改期间已被他人更新"));
    expect(approved).toBe(true);
    expect(staleRejected).toBe(true);
    expect(source).toContain("if (this.items.length === 0) return 0;");
    expect(JSON.stringify(trace.events)).not.toContain("could not verify");
    await expect(pair.alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await save(pair, "02-concurrent-human-agent", { run: finished, trace, source, checks: { humanPreserved: true, approvedAgentPreserved: approved, staleProposalRejected: staleRejected } });
  } finally { await pair.close(); }
});

test("two conflicts use one expandable banner and a successful undo has no JSON error", async ({ browser }) => {
  const pair = await openPair(browser);
  try {
    await openFile(pair.alice, "src/pricing.ts");
    await openFile(pair.bob, "src/cart.ts");
    await edit(pair.alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await edit(pair.bob, "src/cart.ts", "amount, 0.1", "amount, 0.2");
    await expect.poll(async () => (await request(pair.alice, pair.id, "/conflict-guard/state")).frozenFiles.length).toBe(2);
    await openFile(pair.bob, "src/checkout.ts");
    await edit(pair.alice, "src/pricing.ts", '): string {\n  return `${currency} ${amount.toFixed(2)}`;', "): number {\n  return amount;");
    await edit(pair.bob, "src/checkout.ts", "formatMoney(cart.total())", "formatMoney(cart.total()).toUpperCase()");
    await expect.poll(async () => (await request(pair.alice, pair.id, "/conflict-guard/state")).pairDecisions.filter((record: any) => record.status === "judged" && record.verdict?.decision === "lock").length).toBeGreaterThanOrEqual(2);
    await expect(pair.alice.getByTestId("editor-conflict-banner")).toHaveCount(1);
    await expect(pair.alice.getByTestId("editor-conflict-banner")).toContainText(/当前有 [2-9]\d* 个冲突/);
    await expect(pair.alice.locator(".editor-conflict-overlay")).toHaveCount(0);
    await save(pair, "03-two-conflicts", { checks: { oneBanner: true, multipleConflicts: true } });
    pair.alice.once("dialog", (dialog) => dialog.accept());
    await pair.alice.getByTestId("conflict-card").first().getByRole("button", { name: "我来改" }).click();
    await expect.poll(() => disk(pair.alice, pair.id, "src/pricing.ts")).not.toContain("currency: string)");
    await expect(pair.alice.getByTestId("workspace-notice").filter({ hasText: /Unexpected end of JSON|Failed to execute 'json'/ })).toHaveCount(0);
    await save(pair, "04-revert-json", { checks: { undoChangedText: true, noJsonError: true } });
  } finally { await pair.close(); }
});

test("a real full-mode grey judgement is reproduced from its provider cache", async ({ browser }) => {
  const pair = await openPair(browser);
  try {
    await openFile(pair.alice, "src/pricing.ts"); await openFile(pair.bob, "src/checkout.ts");
    await edit(pair.alice, "src/pricing.ts", "return price * (1 - rate);", "return price - rate;");
    await edit(pair.bob, "src/checkout.ts", "cart.total()", "cart.total() + 1");
    await expect.poll(async () => (await request(pair.alice, pair.id, "/conflict-guard/state")).pairDecisions.some((record: any) => record.status === "judged" && record.verdict?.adjudication?.status === "success"), { timeout: 20000 }).toBe(true);
    await pair.alice.waitForTimeout(500);
    const member = await pair.alice.evaluate((id) => sessionStorage.getItem(`simplercp.memberId.${id}`)!, pair.id);
    const response = await pair.alice.request.get(`/api/projects/${pair.id}/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": member } });
    const trace = await response.text();
    const events = trace.trim().split("\n").map((line) => JSON.parse(line));
    const repository = fileURLToPath(new URL("../../", import.meta.url));
    const cache = path.join(repository, "packages/conflict-guard/bench/model-cache/checkpoint-b-product");
    await fs.mkdir(cache, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
    for (const call of events.filter((event) => event.type === "provider_call" && event.status !== "cancelled")) await fs.copyFile(path.join(repository, "packages/conflict-guard/bench/model-cache", `${call.cacheKey}.json`), path.join(cache, `${call.cacheKey}.json`));
    const traceFile = path.join(evidence, "05-full.jsonl");
    await fs.writeFile(traceFile, trace);
    const sources = Object.fromEntries(await Promise.all((await fs.readdir(shop, { recursive: true })).filter((file) => /\.[cm]?[jt]sx?$/.test(file)).map(async (file) => [file, await fs.readFile(path.join(shop, file), "utf8")])));
    await fs.writeFile(path.join(evidence, "05-full-project.json"), JSON.stringify(sources, null, 2) + "\n");
    const checked = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/replay-check.ts", traceFile, "--cache", cache], { cwd: path.join(repository, "packages/conflict-guard"), timeout: 30000 });
    const check = JSON.parse(checked.stdout);
    expect(check.valid).toBe(true);
    await save(pair, "05-full-cache", { check, checks: { offlineFullReplay: true } });
  } finally { await pair.close(); }
});

async function openPair(browser: Browser) {
  const a = await browser.newContext(); const b = await browser.newContext();
  const alice = await a.newPage(); const bob = await b.newPage();
  await alice.goto("/");
  await alice.getByTestId("import-directory").click();
  await alice.getByTestId("project-name").fill(`checkpoint-b-${Date.now()}`);
  await alice.getByTestId("project-directory").fill(shop);
  await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
  const id = new URL(alice.url()).pathname.split("/").at(-1)!;
  await openAs(alice, "Alice", id); await openAs(bob, "Bob", id);
  for (const page of [alice, bob]) { await page.getByTestId("dir-src").click(); await page.getByTestId("collab-tab-conflict").click(); }
  return { alice, bob, id, close: async () => { await a.close(); await b.close(); } };
}
async function request(page: Page, id: string, suffix: string) {
  const member = await page.evaluate((id) => sessionStorage.getItem(`simplercp.memberId.${id}`)!, id);
  const response = await page.request.get(`/api/projects/${id}${suffix}`, { headers: { "X-SimpleRCP-Member": member } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function openFile(page: Page, file: string) {
  await page.getByTestId(`file-${file}`).click();
  await page.waitForFunction((file) => Boolean(window.__simplercpYjsSynced?.[file]), file);
}
async function edit(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors![file]; const model = editor.getModel()!;
    const startOffset = model.getValue().indexOf(before);
    if (startOffset < 0) throw new Error("未找到待修改内容");
    const start = model.getPositionAt(startOffset); const end = model.getPositionAt(startOffset + before.length);
    editor.executeEdits("checkpoint-b", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}
async function latestRun(page: Page, id: string) {
  await expect.poll(async () => (await request(page, id, "/agent/runs")).runs.length).toBeGreaterThan(0);
  return (await request(page, id, "/agent/runs")).runs[0];
}
async function finish(page: Page, id: string, runId: string) {
  await expect.poll(async () => (await request(page, id, `/agent/runs/${runId}`)).run.status, { timeout: 180000, intervals: [500] }).toMatch(/completed|failed|cancelled/);
  return (await request(page, id, `/agent/runs/${runId}`)).run;
}
async function disk(page: Page, id: string, file: string) { return (await request(page, id, `/workspace/file?path=${encodeURIComponent(file)}`)).content as string; }
async function save(pair: { alice: Page; bob: Page; id: string }, name: string, result: unknown) {
  await fs.mkdir(evidence, { recursive: true });
  const state = await request(pair.alice, pair.id, "/conflict-guard/state");
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ result, state }, null, 2) + "\n");
  await pair.alice.screenshot({ path: path.join(evidence, `${name}-alice.png`), fullPage: true });
  await pair.bob.screenshot({ path: path.join(evidence, `${name}-bob.png`), fullPage: true });
}
