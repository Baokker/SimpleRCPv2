import { test, expect, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openAs } from "./helpers";

const execute = promisify(execFile);
const shop = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/checkpoint-a-manual/", import.meta.url));
const checks: Array<{ scenario: string; checks: string[] }> = [];
test.beforeAll(async () => { await fs.mkdir(evidence, { recursive: true }); });
test.afterAll(async () => {
  if (checks.length === 0) return;
  await fs.writeFile(path.join(evidence, "acceptance.json"), JSON.stringify({ mode: "rules", idleMs: 1500, persistDelayMs: 300, scenarios: checks }, null, 2) + "\n");
});

test("阶段3第1至3、10项及先后编辑、关闭重开、切换撤回", async ({ browser }) => {
  test.setTimeout(90000);
  const pair = await openPair(browser);
  const { alice, bob, projectId } = pair;
  try {
    await openFile(alice, "src/pricing.ts"); await openFile(bob, "src/cart.ts");
    const baseline = await disk(alice, projectId, "src/cart.ts");
    await edit(alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await alice.waitForTimeout(3000);
    await edit(bob, "src/cart.ts", "amount, 0.1", "amount, 0.2");
    await bob.waitForTimeout(500);
    expect(await disk(alice, projectId, "src/cart.ts")).toBe(baseline);
    await locked(alice, bob, projectId, "call-signature-incompatible");
    expect(await disk(alice, projectId, "src/cart.ts")).toBe(baseline);
    await snapshot(alice, "01-sequential-black"); await snapshot(bob, "01-bob-black");
    const region = (await state(bob, projectId)).frozenFiles.find((file: { file: string }) => file.file === "src/cart.ts").regions[0];
    const before = await text(bob, "src/cart.ts");
    await bob.evaluate((line) => { const editor = window.__simplercpEditors!["src/cart.ts"]; editor.setPosition({ lineNumber: line, column: 5 }); editor.focus(); }, region.startLine + 1);
    await bob.keyboard.type("blocked");
    expect(await text(bob, "src/cart.ts")).toBe(before);
    await expect(bob.getByTestId("workspace-notice")).toContainText("该区域已冻结");
    await snapshot(bob, "02-blocked-input");
    await bob.evaluate(() => { const editor = window.__simplercpEditors!["src/cart.ts"]; editor.setPosition({ lineNumber: 1, column: 1 }); editor.focus(); });
    await bob.keyboard.type("// outside\n");
    await expect.poll(() => text(bob, "src/cart.ts")).toBe(`// outside\n${before}`);
    const edited = await text(bob, "src/cart.ts");
    await bob.getByTestId("close-tab-src/cart.ts").click();
    await openFile(bob, "src/cart.ts");
    expect(await text(bob, "src/cart.ts")).toBe(edited);
    await snapshot(bob, "11-reopened-document");
    await openFile(alice, "src/cart.ts");
    alice.once("dialog", (dialog) => dialog.accept());
    await alice.getByTestId("conflict-card").getByRole("button", { name: "我来改" }).click();
    await expect(alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(bob.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect.poll(() => disk(alice, projectId, "src/pricing.ts")).not.toContain("currency: string");
    await expect.poll(() => disk(bob, projectId, "src/cart.ts")).toBe(edited);
    await expect(alice.getByTestId("conflict-statistics")).toContainText("冻结总时长");
    await snapshot(alice, "03-switched-file-revert");
    checks.push({ scenario: "sequential-retention-revert", checks: ["01", "02", "03", "10", "sequential-disk", "reopen-retention", "switched-file-revert"] });
  } finally { await pair.close(); }
});

test("阶段3第1、4项同时编辑与双方确认", async ({ browser }) => {
  const pair = await openPair(browser); const { alice, bob, projectId } = pair;
  try {
    await openFile(alice, "src/pricing.ts"); await openFile(bob, "src/cart.ts");
    const pricing = await disk(alice, projectId, "src/pricing.ts"); const cart = await disk(alice, projectId, "src/cart.ts");
    await Promise.all([edit(alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)"), edit(bob, "src/cart.ts", "amount, 0.1", "amount, 0.2")]);
    await locked(alice, bob, projectId, "call-signature-incompatible");
    expect(await disk(alice, projectId, "src/pricing.ts")).toBe(pricing); expect(await disk(alice, projectId, "src/cart.ts")).toBe(cart);
    await alice.getByTestId("conflict-card").getByRole("button", { name: "双方确认后继续" }).click();
    await expect(bob.getByTestId("conflict-card")).toContainText("对方已确认");
    await bob.getByTestId("conflict-card").getByRole("button", { name: "双方确认后继续" }).click();
    await expect(alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect.poll(() => disk(alice, projectId, "src/pricing.ts")).toContain("currency: string");
    await expect.poll(() => disk(alice, projectId, "src/cart.ts")).toContain("amount, 0.2");
    await snapshot(alice, "04-confirmed"); checks.push({ scenario: "confirmed", checks: ["01", "04"] });
  } finally { await pair.close(); }
});

for (const kind of ["white", "grey"] as const) test(`阶段3第${kind === "white" ? 5 : 6}项${kind}`, async ({ browser }) => {
  const pair = await openPair(browser); const { alice, bob, projectId } = pair;
  try {
    await openFile(alice, "src/pricing.ts"); await openFile(bob, "src/checkout.ts");
    await edit(alice, "src/pricing.ts", "return price * (1 - rate);", kind === "white" ? "console.log('audit'); return price * (1 - rate);" : "return price - rate;");
    await edit(bob, "src/checkout.ts", "cart.total()", "cart.total() + 1");
    await expect.poll(async () => (await state(alice, projectId)).pairDecisions.some((record: { verdict?: { zone: string } }) => record.verdict?.zone === kind)).toBe(true);
    await expect(alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(bob.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(alice.getByTestId("conflict-card")).toHaveCount(0);
    if (kind === "grey") { await expect(alice.getByTestId("conflict-warning")).toBeVisible(); await expect(bob.getByTestId("conflict-warning")).toBeVisible(); }
    else await expect(alice.getByTestId("conflict-candidates")).toContainText("白区 · 放行 · 只改日志");
    await expect.poll(() => disk(bob, projectId, "src/checkout.ts")).toContain("cart.total() + 1");
    await snapshot(alice, kind === "white" ? "05-white" : "06-grey");
    checks.push({ scenario: kind, checks: [kind === "white" ? "05" : "06"] });
  } finally { await pair.close(); }
});

test("阶段3第7项合并类型错误", async ({ browser }) => {
  const pair = await openPair(browser); const { alice, bob, projectId } = pair;
  try {
    await openFile(alice, "src/pricing.ts"); await openFile(bob, "src/checkout.ts");
    await edit(alice, "src/pricing.ts", '): string {\n  return `${currency} ${amount.toFixed(2)}`;', "): number {\n  return amount;");
    await edit(bob, "src/checkout.ts", "formatMoney(cart.total())", "formatMoney(cart.total()).toUpperCase()");
    await locked(alice, bob, projectId, "merge-only-type-error");
    await expect(alice.getByTestId("conflict-card")).toContainText("合并后才出现类型错误");
    await snapshot(alice, "07-merge-type-error"); checks.push({ scenario: "merge-type-error", checks: ["07"] });
  } finally { await pair.close(); }
});

test("阶段3第8项同一函数", async ({ browser }) => {
  const pair = await openPair(browser); const { alice, bob, projectId } = pair;
  try {
    await openFile(alice, "src/cart.ts"); await openFile(bob, "src/cart.ts");
    await edit(alice, "src/cart.ts", "amount, 0.1", "amount, 0.2");
    await expect.poll(() => text(bob, "src/cart.ts")).toContain("amount, 0.2");
    await edit(bob, "src/cart.ts", "let amount = 0", "let amount = 1");
    await locked(alice, bob, projectId, "same-symbol-concurrent-write");
    await expect(alice.getByTestId("conflict-candidates")).toContainText("两人在改同一个函数");
    await snapshot(alice, "08-same-function"); checks.push({ scenario: "same-function", checks: ["08"] });
  } finally { await pair.close(); }
});

test("阶段3第9项依赖编辑开始提示", async ({ browser }) => {
  const pair = await openPair(browser); const { alice, bob, projectId } = pair;
  try {
    await openFile(alice, "src/pricing.ts"); await openFile(bob, "src/checkout.ts");
    await edit(alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await alice.waitForTimeout(3000);
    await edit(bob, "src/checkout.ts", "cart.total()", "cart.total() + 1");
    await expect(bob.getByTestId("workspace-notice")).toContainText("正在修改你依赖的 applyDiscount");
    await expect(alice.getByTestId("workspace-notice").filter({ hasText: "正在修改你依赖的" })).toHaveCount(0);
    await snapshot(bob, "09-t0"); checks.push({ scenario: "t0", checks: ["09"] });
  } finally { await pair.close(); }
});

async function openPair(browser: Browser) {
  const aliceContext = await browser.newContext(); const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage(); const bob = await bobContext.newPage();
  await alice.goto("/"); const health = await (await alice.request.get("/api/health")).json();
  test.skip(health.features.conflictGuard !== "rules", "验收需要 rules 模式");
  await alice.getByTestId("import-directory").click(); await alice.getByTestId("project-name").fill(`checkpoint-${Date.now()}`);
  await alice.getByTestId("project-directory").fill(shop); await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/); const projectId = new URL(alice.url()).pathname.split("/").at(-1)!;
  await openAs(alice, "Alice", projectId); await openAs(bob, "Bob", projectId);
  for (const page of [alice, bob]) { await page.getByTestId("collab-tab-conflict").click(); await page.getByTestId("dir-src").click(); }
  return { alice, bob, projectId, close: async () => { await aliceContext.close(); await bobContext.close(); } };
}
async function openFile(page: Page, file: string) { await page.getByTestId(`file-${file}`).click(); await page.waitForFunction((file) => Boolean(window.__simplercpEditors?.[file] && window.__simplercpYjsSynced?.[file]), file); }
async function text(page: Page, file: string) { return page.evaluate((file) => window.__simplercpEditors![file].getModel()!.getValue(), file); }
async function edit(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors![file]; const model = editor.getModel()!; const offset = model.getValue().indexOf(before);
    if (offset < 0) throw new Error("找不到待修改文本"); const start = model.getPositionAt(offset); const end = model.getPositionAt(offset + before.length);
    editor.pushUndoStop(); editor.executeEdits("checkpoint-acceptance", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]); editor.pushUndoStop();
  }, { file, before, after });
}
async function state(page: Page, projectId: string) {
  return page.evaluate(async (projectId) => { const member = sessionStorage.getItem(`simplercp.memberId.${projectId}`)!; return (await fetch(`/api/projects/${projectId}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": member } })).json(); }, projectId);
}
async function disk(page: Page, projectId: string, file: string) {
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  return (await execute("cat", [path.join(project.workspacePath, file)])).stdout;
}
async function locked(alice: Page, bob: Page, projectId: string, ruleId: string) {
  await expect.poll(async () => (await state(alice, projectId)).pairDecisions.some((record: { status: string; verdict?: { ruleId: string } }) => record.status === "judged" && record.verdict?.ruleId === ruleId)).toBe(true);
  await expect(alice.locator(".conflict-frozen-range").first()).toBeVisible(); await expect(bob.locator(".conflict-frozen-range").first()).toBeVisible();
  await expect(alice.getByTestId("conflict-card")).toBeVisible(); await expect(bob.getByTestId("conflict-card")).toBeVisible();
}
async function snapshot(page: Page, name: string) { await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true }); }
