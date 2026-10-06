import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const shopRoot = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidenceRoot = fileURLToPath(new URL("../../docs/conflict-guard/evidence/stage-2-manual/", import.meta.url));
const saveEvidence = process.env.SIMPLERCP_STAGE2_EVIDENCE === "true";

test("两个成员看到符号修改、关联路径和修改文本，off 时隐藏页签", async ({ browser }) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const contextB = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const alice = await contextA.newPage();
  const bob = await contextB.newPage();
  await alice.goto("/");
  await alice.getByTestId("import-directory").click();
  await alice.getByTestId("project-name").fill("conflict-shop");
  await alice.getByTestId("project-directory").fill(shopRoot);
  await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = decodeURIComponent(new URL(alice.url()).pathname.split("/").at(-1)!);
  await openAs(alice, "Alice", projectId);
  await openAs(bob, "Bob", projectId);
  const health = await (await alice.request.get("/api/health")).json();
  if (health.features.conflictGuard === "off") {
    await expect(alice.getByTestId("collab-tab-conflict")).toHaveCount(0);
    await expect(bob.getByTestId("collab-tab-conflict")).toHaveCount(0);
    await contextA.close();
    await contextB.close();
    return;
  }
  await expect(alice.getByTestId("collab-tab-conflict")).toBeVisible();
  await expect(bob.getByTestId("collab-tab-conflict")).toBeVisible();
  await alice.getByTestId("collab-tab-conflict").click();
  await bob.getByTestId("collab-tab-conflict").click();
  if (saveEvidence) await fs.mkdir(evidenceRoot, { recursive: true });
  await capture(alice, "01-alice-panel");
  await capture(bob, "01-bob-panel");
  await alice.getByTestId("dir-src").click();
  await bob.getByTestId("dir-src").click();

  await openFile(alice, "src/pricing.ts");
  await editText(alice, "src/pricing.ts", "price * (1 - rate)", "price - price * rate");
  await expect(alice.getByTestId("conflict-guard-panel")).toContainText("src/pricing.ts:3–5 applyDiscount");
  await expect(bob.getByTestId("conflict-guard-panel")).toContainText("src/pricing.ts:3–5 applyDiscount");
  await capture(alice, "02-active-symbol");

  await openFile(bob, "src/checkout.ts");
  await editText(bob, "src/checkout.ts", "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
  for (const page of [alice, bob]) {
    await expect(page.getByTestId("conflict-candidate")).toHaveCount(1);
    await expect(page.getByTestId("conflict-candidate")).toContainText("applyDiscount()");
    await expect(page.getByTestId("conflict-candidate")).toContainText("checkout()");
    await expect(page.getByTestId("conflict-candidate")).toContainText("checkout 调用 Cart.total");
    await expect(page.getByTestId("conflict-candidate")).toContainText("Cart.total 调用 applyDiscount");
    await page.getByTestId("conflict-candidate").getByRole("button").click();
    await expect(page.locator(".conflict-pair-texts")).toContainText("price * (1 - rate)");
    await expect(page.locator(".conflict-pair-texts")).toContainText("price - price * rate");
    await expect(page.locator(".conflict-pair-texts")).toContainText("formatMoney(cart.total())");
    await expect(page.locator(".conflict-pair-texts")).toContainText("formatMoney(cart.total() + 1)");
  }
  await expect.poll(async () => (await guardRequest(alice, projectId, "state")).statistics.total).toBe(2);
  const relatedState = await guardRequest(alice, projectId, "state");
  await capture(alice, "03-related-before-after");
  await capture(bob, "03-bob-related-before-after");

  await editText(bob, "src/checkout.ts", "formatMoney(cart.total() + 1)", "formatMoney(cart.total())");
  await expect(alice.getByTestId("conflict-candidate")).toHaveCount(0);
  const unrelatedBefore = (await guardRequest(alice, projectId, "state")).statistics.unrelated;
  await openFile(bob, "src/report.ts");
  await editText(bob, "src/report.ts", '"Shop report"', '"Daily report"');
  await expect(bob.getByTestId("conflict-guard-panel")).toContainText("reportTime");
  await expect.poll(async () => (await guardRequest(alice, projectId, "state")).statistics.unrelated).toBe(unrelatedBefore + 1);
  await expect(alice.getByTestId("conflict-candidate")).toHaveCount(0);
  await expect(bob.getByTestId("conflict-candidate")).toHaveCount(0);
  const unrelatedState = await guardRequest(alice, projectId, "state");
  await capture(bob, "04-unrelated-change");

  // 通过现有完成接口结束本轮活跃变更，开始同符号验收。
  await guardRequest(alice, projectId, "done", "POST");
  await guardRequest(bob, projectId, "done", "POST");
  await openFile(alice, "src/cart.ts");
  await openFile(bob, "src/cart.ts");
  await editText(alice, "src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
  await expect.poll(() => editorValue(bob, "src/cart.ts")).toContain("amount, 0.2");
  await editText(bob, "src/cart.ts", "let amount = 0", "let amount = 1");
  for (const page of [alice, bob]) {
    await expect(page.getByTestId("conflict-candidate")).toHaveCount(1);
    await expect(page.getByTestId("conflict-candidate")).toContainText("两人在改同一个函数");
    await expect(page.getByTestId("conflict-statistics")).toContainText("7 个文件");
    await expect(page.getByTestId("conflict-statistics")).toContainText("最近更新");
  }
  await expect.poll(async () => (await guardRequest(alice, projectId, "state")).statistics.total).toBe(unrelatedState.statistics.total + 2);
  const sameSymbolState = await guardRequest(alice, projectId, "state");
  await capture(alice, "05-same-symbol");
  await openFile(alice, "src/report.ts");
  await alice.getByTestId("conflict-guard-panel").getByRole("button", { name: "src/cart.ts:11–15 Cart.total()", exact: true }).first().click();
  await expect(alice.locator(".tab.active")).toContainText("src/cart.ts");
  await expect.poll(() => alice.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]?.getPosition()?.lineNumber)).toBe(11);
  await capture(alice, "06-navigation-statistics");
  await expect.poll(async () => (await guardRequest(alice, projectId, "state")).cursors.some((cursor: { symbol: string | null }) => cursor.symbol === "src/cart.ts#Cart.total")).toBe(true);
  if (saveEvidence) {
    const navigationState = await guardRequest(alice, projectId, "state");
    await fs.writeFile(path.join(evidenceRoot, "states.json"), JSON.stringify({ relatedState, unrelatedState, sameSymbolState, navigationState }, null, 2));
    await fs.writeFile(path.join(evidenceRoot, "trace.jsonl"), await guardRequest(alice, projectId, "trace"));
    await fs.writeFile(path.join(evidenceRoot, "acceptance.json"), JSON.stringify({ projectId, mode: health.features.conflictGuard, members: ["Alice", "Bob"], checklist: [true, true, true, true, true, true, true], method: "Playwright 操作真实浏览器、Monaco 与 Yjs，通过 DOM 和接口断言验收" }, null, 2));
  }
  await contextA.close();
  await contextB.close();
});

async function openFile(page: Page, file: string) {
  await page.getByTestId(`file-${file}`).click();
  await page.waitForFunction((file) => Boolean(window.__simplercpEditors?.[file] && window.__simplercpYjsSynced?.[file]), file);
}

async function editText(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors?.[file];
    const model = editor?.getModel();
    if (!editor || !model) throw new Error("Monaco 尚未准备完成");
    const offset = model.getValue().indexOf(before);
    if (offset < 0) throw new Error("没有找到待修改文本");
    const start = model.getPositionAt(offset);
    const end = model.getPositionAt(offset + before.length);
    editor.executeEdits("stage-2-acceptance", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}

async function editorValue(page: Page, file: string) {
  return page.evaluate((file) => window.__simplercpEditors?.[file]?.getValue(), file);
}

async function guardRequest(page: Page, projectId: string, endpoint: string, method = "GET") {
  return page.evaluate(async ({ projectId, endpoint, method }) => {
    const response = await fetch(`/api/projects/${projectId}/conflict-guard/${endpoint}`, { method, headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${projectId}`)! } });
    if (!response.ok) throw new Error(`conflict-guard 请求失败：${response.status}`);
    if (response.status === 204) return null;
    return endpoint === "trace" ? response.text() : response.json();
  }, { projectId, endpoint, method });
}

async function capture(page: Page, name: string) {
  if (saveEvidence) await page.screenshot({ path: path.join(evidenceRoot, `${name}.png`), fullPage: true });
}
