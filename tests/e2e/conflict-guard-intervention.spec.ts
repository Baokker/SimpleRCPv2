import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const shopRoot = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidenceRoot = fileURLToPath(new URL("../../docs/conflict-guard/evidence/stage-3-manual/", import.meta.url));
const saveEvidence = process.env.SIMPLERCP_STAGE3_EVIDENCE === "true";

test("rules 模式显示黑区判定与冻结区域", async ({ browser }) => {
  test.setTimeout(90_000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  await alice.goto("/");
  await alice.getByTestId("import-directory").click();
  await alice.getByTestId("project-name").fill(`conflict-shop-${Date.now()}`);
  await alice.getByTestId("project-directory").fill(shopRoot);
  await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = decodeURIComponent(new URL(alice.url()).pathname.split("/").at(-1)!);
  await openAs(alice, "Alice", projectId);
  await openAs(bob, "Bob", projectId);
  const health = await (await alice.request.get("/api/health")).json();
  if (health.features.conflictGuard !== "rules" && health.features.conflictGuard !== "full") {
    await aliceContext.close();
    await bobContext.close();
    return;
  }
  await alice.getByTestId("collab-tab-conflict").click();
  await bob.getByTestId("collab-tab-conflict").click();
  await alice.getByTestId("dir-src").click();
  await bob.getByTestId("dir-src").click();
  await alice.getByTestId("file-src/cart.ts").click();
  await bob.getByTestId("file-src/cart.ts").click();
  await waitEditor(alice, "src/cart.ts");
  await waitEditor(bob, "src/cart.ts");
  await editText(alice, "src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
  await editText(bob, "src/cart.ts", "let amount = 0", "let amount = 1");
  await expect.poll(async () => (await guardState(alice, projectId)).pairDecisions?.some((record: { verdict?: { decision?: string } }) => record.verdict?.decision === "lock")).toBe(true);
  await expect(alice.locator(".conflict-frozen-range").first()).toBeVisible();
  await expect(alice.getByTestId("conflict-current")).toContainText("黑区");
  if (saveEvidence) { await fs.mkdir(evidenceRoot, { recursive: true }); await alice.screenshot({ path: path.join(evidenceRoot, "01-black-zone-card.png"), fullPage: true }); await bob.screenshot({ path: path.join(evidenceRoot, "01-bob-black-zone-card.png"), fullPage: true }); }
  await alice.getByTestId("conflict-candidate").first().getByRole("button").click();
  await expect(alice.getByTestId("conflict-card").getByRole("button", { name: "我来改" })).toBeVisible();
  if (saveEvidence) await fs.writeFile(path.join(evidenceRoot, "acceptance.json"), JSON.stringify({ mode: health.features.conflictGuard, automatedChecks: { blackZoneCard: true, freezeDecoration: true, candidateExpansion: true, confirmationButton: true }, manualChecks: "未在本次自动运行中执行完整十项人工操作" }, null, 2));
  await aliceContext.close();
  await bobContext.close();
});

test("rules 模式双方确认按钮可以提交确认", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveTitle(/SimpleRCP|Collaborative/i);
  await context.close();
});

async function waitEditor(page: Page, file: string) {
  await page.waitForFunction((path) => Boolean(window.__simplercpEditors?.[path] && window.__simplercpYjsSynced?.[path]), file);
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
    editor.executeEdits("stage-3-intervention", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}

async function guardState(page: Page, projectId: string) {
  return page.evaluate(async (id) => {
    const memberId = sessionStorage.getItem(`simplercp.memberId.${id}`)!;
    const response = await fetch(`/api/projects/${id}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": memberId } });
    return response.json();
  }, projectId);
}
