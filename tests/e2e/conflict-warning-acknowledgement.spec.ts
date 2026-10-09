import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("提醒可以分别确认，确认后历史保留，刷新后无需重复了解", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage(), bob = await bobContext.newPage();
  try {
    await alice.goto("/");
    await alice.getByTestId("import-directory").click();
    await alice.getByTestId("project-name").fill("提醒确认验收");
    await alice.getByTestId("project-directory").fill(path.join(root, "demo/conflict-shop"));
    await alice.getByTestId("create-project-submit").click();
    await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = new URL(alice.url()).pathname.split("/").at(-1)!;
    await openAs(alice, "Warning Alice", projectId);
    await openAs(bob, "Warning Bob", projectId);
    for (const [page, file] of [[alice, "src/pricing.ts"], [bob, "src/checkout.ts"]] as const) {
      await page.getByTestId("collab-tab-conflict").click();
      await page.getByTestId("dir-src").click();
      await page.getByTestId(`file-${file}`).click();
      await page.waitForFunction((file) => window.__simplercpYjsSynced?.[file], file);
    }
    await expect(alice.getByTestId("conflict-guide").locator("summary")).toHaveText("面板功能");
    await expect(alice.getByTestId("conflict-guide")).toContainText("将协作者之间的冲突分为三种等级");
    await edit(alice, "src/pricing.ts", "price * (1 - rate)", "price * (1 - rate * 2)");
    await edit(bob, "src/checkout.ts", "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    await expect(alice.getByTestId("conflict-warnings")).toBeVisible();
    await expect(bob.getByTestId("conflict-warnings")).toBeVisible();
    await expect(alice.locator(".conflict-warning-list").getByRole("button", { name: "我已了解", exact: true })).toBeVisible();
    await alice.getByTestId("conflict-warnings").getByRole("button", { name: "我已了解", exact: true }).click();
    await expect(alice.getByTestId("conflict-warnings")).toHaveCount(0);
    await expect(alice.locator(".conflict-warning-list").getByRole("button", { name: "我已了解", exact: true })).toHaveCount(0);
    await expect(bob.getByTestId("conflict-warnings")).toBeVisible();
    await alice.getByTestId("conflict-history").locator(":scope > summary").click();
    await alice.getByTestId("human-conflict-record").locator(":scope > summary").click();
    await expect(alice.getByRole("button", { name: "已经了解", exact: true })).toBeDisabled();
    await alice.reload();
    await alice.getByTestId("collab-tab-conflict").click();
    await expect(alice.getByTestId("conflict-warnings")).toHaveCount(0);
    await expect(alice.locator(".conflict-warning-list").getByRole("button", { name: "我已了解", exact: true })).toHaveCount(0);
    await expect(alice.getByTestId("conflict-overview").locator('[data-metric="grey"] dd')).toHaveText("1");
  } finally { await aliceContext.close(); await bobContext.close(); }
});

async function edit(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors?.[file];
    const model = editor?.getModel();
    if (!editor || !model) throw new Error("编辑器尚未准备完成");
    const offset = model.getValue().indexOf(before);
    if (offset < 0) throw new Error("没有找到待修改的内容");
    const start = model.getPositionAt(offset), end = model.getPositionAt(offset + before.length);
    editor.executeEdits("warning-acceptance", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}
