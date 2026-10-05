import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const shopRoot = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidenceRoot = fileURLToPath(new URL("../../docs/conflict-guard/evidence/stage-3-manual/", import.meta.url));
const saveEvidence = process.env.SIMPLERCP_STAGE3_EVIDENCE === "true";
const modifierKey = process.platform === "darwin" ? "Meta" : "Control";

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

test("冻结区域阻止缩进、删除快捷键、跨区选区与多个光标修改", async ({ browser }) => {
  test.setTimeout(90_000);
  const collaboration = await openShopPair(browser);
  const { alice, bob, projectId } = collaboration;
  try {
    await createSameSymbolConflict(alice, bob, projectId);
    const before = await editorText(bob, "src/cart.ts");
    const region = (await guardState(bob, projectId)).frozenFiles.find((entry: { file: string }) => entry.file === "src/cart.ts").regions[0];
    await setSelections(bob, [{ startLineNumber: region.startLine + 1, startColumn: 5, endLineNumber: region.startLine + 1, endColumn: 5 }]);
    await bob.keyboard.press("Tab");
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await bob.keyboard.press(process.platform === "darwin" ? "Alt+Backspace" : "Control+Backspace");
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await setSelections(bob, [{ startLineNumber: region.startLine - 1, startColumn: 1, endLineNumber: region.endLine + 1, endColumn: 1 }]);
    await bob.keyboard.press("Backspace");
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await setSelections(bob, [
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      { startLineNumber: region.startLine + 1, startColumn: 5, endLineNumber: region.startLine + 1, endColumn: 5 }
    ]);
    await bob.keyboard.type("blocked");
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await expect(bob.getByTestId("workspace-notice")).toContainText("该区域已冻结");
    await setSelections(bob, [{ startLineNumber: region.startLine + 1, startColumn: 5, endLineNumber: region.startLine + 1, endColumn: 5 }]);
    await bob.keyboard.press(`${modifierKey}+z`);
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await setSelections(bob, [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }]);
    await bob.keyboard.type("// outside\n");
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(`// outside\n${before}`);
  } finally {
    await collaboration.close();
  }
});

test("rules 模式双方确认后解除冻结并写入当前修改", async ({ browser }) => {
  test.setTimeout(90_000);
  const collaboration = await openShopPair(browser);
  const { alice, bob, projectId } = collaboration;
  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();
  try {
    await openAs(observer, "Charlie", projectId);
    await observer.getByTestId("collab-tab-conflict").click();
    await createSameSymbolConflict(alice, bob, projectId);
    await expect(observer.getByTestId("conflict-card")).toBeVisible();
    await expect(observer.getByTestId("conflict-card").getByRole("button", { name: "双方确认后继续" })).toHaveCount(0);
    await alice.getByTestId("conflict-card").getByRole("button", { name: "双方确认后继续" }).click();
    await expect(alice.getByTestId("conflict-card")).toContainText("你已确认，等待对方确认");
    await expect(bob.getByTestId("conflict-card")).toContainText("对方已确认，等待你的确认");
    await expect.poll(async () => (await guardState(alice, projectId)).frozenFiles.length).toBeGreaterThan(0);
    await bob.getByTestId("conflict-card").getByRole("button", { name: "双方确认后继续" }).click();
    await expect.poll(async () => (await guardState(alice, projectId)).pairDecisions.some((record: { status: string; resolution?: string }) => record.status === "resolved" && record.resolution === "overridden")).toBe(true);
    await expect(alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(bob.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect.poll(async () => {
      const content = await alice.evaluate(async (id) => {
        const memberId = sessionStorage.getItem(`simplercp.memberId.${id}`)!;
        const response = await fetch(`/api/projects/${id}/workspace/file?path=src%2Fcart.ts`, { headers: { "X-SimpleRCP-Member": memberId } });
        return response.json();
      }, projectId);
      return content.content;
    }).toContain("applyDiscount(amount, 0.2)");
    await expect.poll(() => editorText(alice, "src/cart.ts")).toContain("let amount = 1");
  } finally {
    await observerContext.close();
    await collaboration.close();
  }
});

test("冻结按历史编辑区域拦截撤销与重做，区域外历史仍可执行", async ({ browser }) => {
  test.setTimeout(90_000);
  const collaboration = await openShopPair(browser);
  const { alice, bob, projectId } = collaboration;
  try {
    await createSameSymbolConflict(alice, bob, projectId);
    const before = await editorText(bob, "src/cart.ts");
    await setSelections(bob, [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }]);
    await bob.keyboard.press(`${modifierKey}+z`);
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await bob.evaluate(() => {
      const editor = window.__simplercpEditors?.["src/cart.ts"]!;
      editor.pushUndoStop();
      editor.executeEdits("outside", [{ range: new window.__simplercpMonaco!.Range(1, 1, 1, 1), text: "// outside\n" }]);
      editor.pushUndoStop();
    });
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(`// outside\n${before}`);
    await bob.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]!.trigger("menu", "undo", null));
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await bob.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]!.trigger("menu", "redo", null));
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(`// outside\n${before}`);
    await bob.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]!.trigger("menu", "undo", null));
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
    await bob.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]!.trigger("menu", "undo", null));
    await expect.poll(() => editorText(bob, "src/cart.ts")).toBe(before);
  } finally {
    await collaboration.close();
  }
});

test("灰区判定向双方显示可以关闭的通知", async ({ browser }) => {
  test.setTimeout(90_000);
  const collaboration = await openShopPair(browser);
  const { alice, bob, projectId } = collaboration;
  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();
  try {
    await openAs(observer, "Charlie", projectId);
    await alice.getByTestId("file-src/pricing.ts").click();
    await bob.getByTestId("file-src/checkout.ts").click();
    await waitEditor(alice, "src/pricing.ts");
    await waitEditor(bob, "src/checkout.ts");
    await editText(alice, "src/pricing.ts", "price * (1 - rate)", "price - rate");
    await editText(bob, "src/checkout.ts", "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    await expect.poll(async () => (await guardState(alice, projectId)).pairDecisions.some((record: { verdict?: { decision: string } }) => record.verdict?.decision === "warn")).toBe(true);
    await expect(alice.getByTestId("conflict-warning")).toContainText("修改可能互相影响");
    await expect(bob.getByTestId("conflict-warning")).toContainText("修改可能互相影响");
    await expect(observer.getByTestId("conflict-warning")).toHaveCount(0);
    await alice.getByTestId("conflict-warning").getByRole("button", { name: "关闭通知" }).click();
    await expect(alice.getByTestId("conflict-warning")).toHaveCount(0);
    await expect(bob.getByTestId("conflict-warning")).toBeVisible();
  } finally {
    await observerContext.close();
    await collaboration.close();
  }
});

test("冻结区域阻止光标位于区域外的历史重做", async ({ browser }) => {
  test.setTimeout(90_000);
  const collaboration = await openShopPair(browser);
  const { alice, bob, projectId } = collaboration;
  try {
    await alice.getByTestId("file-src/cart.ts").click();
    await bob.getByTestId("file-src/cart.ts").click();
    await waitEditor(alice, "src/cart.ts");
    await waitEditor(bob, "src/cart.ts");
    await editText(alice, "src/cart.ts", "let amount = 0", "let amount = 1");
    await editText(alice, "src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await alice.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]!.trigger("menu", "undo", null));
    await expect.poll(() => editorText(alice, "src/cart.ts")).toContain("applyDiscount(amount, 0.1)");
    await expect.poll(() => editorText(bob, "src/cart.ts")).toContain("let amount = 1");
    await editText(bob, "src/cart.ts", "let amount = 1", "let amount = 2");
    await expect.poll(async () => (await guardState(alice, projectId)).pairDecisions.some((record: { verdict?: { decision: string } }) => record.verdict?.decision === "lock")).toBe(true);
    await expect(alice.locator(".conflict-frozen-range").first()).toBeVisible();
    const before = await editorText(alice, "src/cart.ts");
    await setSelections(alice, [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }]);
    await alice.evaluate(() => window.__simplercpEditors?.["src/cart.ts"]!.trigger("menu", "redo", null));
    await expect.poll(() => editorText(alice, "src/cart.ts")).toBe(before);
  } finally {
    await collaboration.close();
  }
});

async function openShopPair(browser: Browser) {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  await alice.goto("/");
  const health = await (await alice.request.get("/api/health")).json();
  test.skip(health.features.conflictGuard !== "rules" && health.features.conflictGuard !== "full", "需要 rules 或 full 模式");
  await alice.getByTestId("import-directory").click();
  await alice.getByTestId("project-name").fill(`conflict-review-${Date.now()}`);
  await alice.getByTestId("project-directory").fill(shopRoot);
  await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = decodeURIComponent(new URL(alice.url()).pathname.split("/").at(-1)!);
  await openAs(alice, "Alice", projectId);
  await openAs(bob, "Bob", projectId);
  await alice.getByTestId("collab-tab-conflict").click();
  await bob.getByTestId("collab-tab-conflict").click();
  await alice.getByTestId("dir-src").click();
  await bob.getByTestId("dir-src").click();
  return { alice, bob, projectId, close: async () => { await aliceContext.close(); await bobContext.close(); } };
}

async function createSameSymbolConflict(alice: Page, bob: Page, projectId: string) {
  await alice.getByTestId("file-src/cart.ts").click();
  await bob.getByTestId("file-src/cart.ts").click();
  await waitEditor(alice, "src/cart.ts");
  await waitEditor(bob, "src/cart.ts");
  await editText(alice, "src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
  await editText(bob, "src/cart.ts", "let amount = 0", "let amount = 1");
  await expect.poll(async () => (await guardState(alice, projectId)).pairDecisions.some((record: { verdict?: { decision: string } }) => record.verdict?.decision === "lock")).toBe(true);
  await expect(alice.locator(".conflict-frozen-range").first()).toBeVisible();
  await expect(bob.locator(".conflict-frozen-range").first()).toBeVisible();
}

async function editorText(page: Page, file: string) {
  return page.evaluate((path) => window.__simplercpEditors?.[path]?.getModel()?.getValue(), file);
}

async function setSelections(page: Page, selections: Array<{ startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }>) {
  await page.evaluate((values) => {
    const editor = window.__simplercpEditors?.["src/cart.ts"]!;
    const monaco = window.__simplercpMonaco!;
    editor.setSelections(values.map((value) => new monaco.Selection(value.startLineNumber, value.startColumn, value.endLineNumber, value.endColumn)));
    editor.focus();
  }, selections);
}

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
    editor.pushUndoStop();
    editor.executeEdits("stage-3-intervention", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
    editor.pushUndoStop();
  }, { file, before, after });
}

async function guardState(page: Page, projectId: string) {
  return page.evaluate(async (id) => {
    const memberId = sessionStorage.getItem(`simplercp.memberId.${id}`)!;
    const response = await fetch(`/api/projects/${id}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": memberId } });
    return response.json();
  }, projectId);
}
