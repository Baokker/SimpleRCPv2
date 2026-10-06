import { expect, test, type Page, type Browser } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const enabled = process.env.SIMPLERCP_STAGE5_LIVE === "1";
const failure = process.env.SIMPLERCP_STAGE5_FAILURE === "1";
const failureStrategy = process.env.CONFLICT_GUARD_STRATEGY ?? "G3";
const shop = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/stage-5-manual/", import.meta.url));
test.skip(!enabled, "真实模型验收由显式命令执行");

test("灰区分析向双方显示黄色区域、模型解释与统计", async ({ browser }) => {
  test.skip(failure, "正常端点验收");
  const pair = await openPair(browser);
  try {
    await grey(pair.alice, pair.bob);
    await expect(pair.alice.locator(".conflict-analyzing-range").first()).toBeVisible();
    await expect(pair.bob.locator(".conflict-analyzing-range").first()).toBeVisible();
    await fs.mkdir(evidence, { recursive: true });
    await pair.alice.screenshot({ path: path.join(evidence, "01-analyzing.png"), fullPage: true });
    await expect(pair.alice.getByTestId("adjudication-result").first()).toContainText("建议：", { timeout: 15000 });
    await expect(pair.bob.getByTestId("adjudication-result").first()).toContainText("建议：");
    await expect(pair.alice.getByTestId("adjudication-statistics")).toContainText("模型调用");
    await expect(pair.alice.getByTestId("adjudication-statistics")).toContainText("升级比例");
    await expect(pair.alice.locator(".conflict-analyzing-range")).toHaveCount(0);
    const state = await guard(pair.alice, pair.id);
    expect(state.pairDecisions.some((record: { verdict?: { adjudication?: { source: string } } }) => ["fast", "deep"].includes(record.verdict?.adjudication?.source ?? ""))).toBe(true);
    await pair.alice.screenshot({ path: path.join(evidence, "02-model-result.png"), fullPage: true });
    await fs.writeFile(path.join(evidence, "normal.json"), JSON.stringify({ mode: "full", state, checks: { analyzing: true, explanation: true, suggestion: true, statistics: true } }, null, 2) + "\n");
  } finally { await pair.close(); }
});

test("分析期间继续编辑取消旧请求并判定新修订", async ({ browser }) => {
  test.skip(failure, "正常端点验收");
  const pair = await openPair(browser);
  try {
    await grey(pair.alice, pair.bob);
    await expect.poll(async () => (await guard(pair.alice, pair.id)).pairDecisions.some((record: { status: string }) => record.status === "analyzing")).toBe(true);
    await edit(pair.alice, "src/pricing.ts", "price - rate", "price - rate * 2");
    await expect.poll(async () => (await guard(pair.alice, pair.id)).pairDecisions.some((record: { revision: number; status: string }) => record.revision > 0 && record.status === "judged"), { timeout: 20000 }).toBe(true);
    const trace = await pair.alice.evaluate(async (id) => {
      const response = await fetch(`/api/projects/${id}/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! } }); return response.text();
    }, pair.id);
    const events = trace.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "provider_call" && event.status === "cancelled")).toBe(true);
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, "cancel.json"), JSON.stringify({ cancelled: true, state: await guard(pair.alice, pair.id) }, null, 2) + "\n");
    await pair.alice.screenshot({ path: path.join(evidence, "03-new-revision.png"), fullPage: true });
  } finally { await pair.close(); }
});

test("端点鉴权失败时显示警告并保持编辑可用", async ({ browser }) => {
  test.skip(!failure, "需要无效凭据环境");
  const pair = await openPair(browser);
  try {
    await grey(pair.alice, pair.bob);
    await expect(pair.alice.getByTestId("adjudication-result").first()).toContainText("研判失败，已降级为警告", { timeout: 15000 });
    await expect(pair.bob.getByTestId("conflict-warning")).toContainText("研判失败，已降级为警告");
    expect((await guard(pair.alice, pair.id)).frozenFiles).toEqual([]);
    await edit(pair.alice, "src/pricing.ts", "price - rate", "price - rate * 2");
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, `failure-${failureStrategy}.json`), JSON.stringify({ authenticationFailure: true, strategy: failureStrategy, state: await guard(pair.alice, pair.id), editable: true }, null, 2) + "\n");
    await pair.alice.screenshot({ path: path.join(evidence, `04-provider-failure-${failureStrategy}.png`), fullPage: true });
  } finally { await pair.close(); }
});

async function openPair(browser: Browser) {
  const a = await browser.newContext(); const b = await browser.newContext(); const alice = await a.newPage(); const bob = await b.newPage();
  await alice.goto("/"); await alice.getByTestId("import-directory").click(); await alice.getByTestId("project-name").fill(`stage5-${Date.now()}`); await alice.getByTestId("project-directory").fill(shop); await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/); const id = new URL(alice.url()).pathname.split("/").at(-1)!;
  await openAs(alice, "Alice", id); await openAs(bob, "Bob", id);
  for (const page of [alice, bob]) { await page.getByTestId("collab-tab-conflict").click(); await page.getByTestId("dir-src").click(); }
  await alice.getByTestId("file-src/pricing.ts").click(); await bob.getByTestId("file-src/checkout.ts").click();
  await alice.waitForFunction(() => window.__simplercpYjsSynced?.["src/pricing.ts"]); await bob.waitForFunction(() => window.__simplercpYjsSynced?.["src/checkout.ts"]);
  return { alice, bob, id, close: async () => { await a.close(); await b.close(); } };
}
async function grey(alice: Page, bob: Page) { await edit(alice, "src/pricing.ts", "price * (1 - rate)", "price - rate"); await edit(bob, "src/checkout.ts", "formatMoney(cart.total())", "formatMoney(cart.total() + 1)"); }
async function edit(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => { const editor = window.__simplercpEditors?.[file]!; const model = editor.getModel()!; const offset = model.getValue().indexOf(before); if (offset < 0) throw new Error("未找到待修改内容"); const start = model.getPositionAt(offset); const end = model.getPositionAt(offset + before.length); editor.executeEdits("stage5", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]); }, { file, before, after });
}
async function guard(page: Page, id: string) { return page.evaluate(async (id) => { const response = await fetch(`/api/projects/${id}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! } }); return response.json(); }, id); }
