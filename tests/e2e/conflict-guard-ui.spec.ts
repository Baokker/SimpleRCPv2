import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";
import type { ConflictGuardState } from "../../apps/client/src/conflictGuardTypes";

const shop = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/ui-round1/", import.meta.url));

test("两个冲突的卡片、关联列表、页签与编辑器横幅", async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const b = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const alice = await a.newPage();
  const bob = await b.newPage();
  try {
    await alice.goto("/");
    await alice.getByTestId("import-directory").click();
    await alice.getByTestId("project-name").fill(`ui-round1-${Date.now()}`);
    await alice.getByTestId("project-directory").fill(shop);
    await alice.getByTestId("create-project-submit").click();
    await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
    const id = new URL(alice.url()).pathname.split("/").at(-1)!;
    await openAs(alice, "Alice", id);
    await openAs(bob, "Bob", id);
    await expect(alice.getByTestId("conflict-tab-count")).toHaveCount(0);
    for (const page of [alice, bob]) {
      await page.getByTestId("collab-tab-conflict").click();
      await page.getByTestId("conflict-progress").locator(":scope > summary").click();
      await page.getByTestId("dir-src").click();
      await openFile(page, "src/cart.ts");
    }
    await edit(alice, "src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await expect.poll(() => value(bob, "src/cart.ts")).toContain("amount, 0.2");
    await edit(bob, "src/cart.ts", "let amount = 0", "let amount = 1");
    await expect(alice.getByTestId("conflict-card")).toHaveCount(1);
    for (const page of [alice, bob]) await openFile(page, "src/report.ts");
    await edit(alice, "src/report.ts", '"Shop report"', '"Daily report"');
    await expect.poll(() => value(bob, "src/report.ts")).toContain("Daily report");
    await edit(bob, "src/report.ts", '"Daily report"', '"Weekly report"');
    await expect(alice.getByTestId("conflict-card")).toHaveCount(2);
    await expect(alice.getByTestId("conflict-tab-count")).toHaveText("2");
    await expect(bob.getByTestId("conflict-tab-count")).toHaveText("2");
    await openFile(alice, "src/cart.ts");
    await expect(alice.getByTestId("editor-conflict-banner")).toHaveCount(1);
    await expect(alice.getByTestId("conflict-candidate")).toHaveCount(2);
    await expect(alice.locator(".editor-conflict-overlays, .editor-conflict-card")).toHaveCount(0);
    const card = alice.getByTestId("conflict-card").filter({ hasText: "Cart.total" });
    const actions = card.getByTestId("conflict-action-list");
    await expect(actions.locator(":scope > li")).toHaveCount(3);
    await expect(actions.getByRole("button")).toHaveText(["我来改", "双方确认后继续", "去聊天里商量"]);
    const layout = await actions.getByRole("button").evaluateAll((buttons) => buttons.map((button) => { const box = button.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }));
    expect(new Set(layout.map((box) => box.height)).size).toBe(1);
    expect(new Set(layout.map((box) => box.width)).size).toBe(1);
    expect(new Set(layout.map((box) => box.x)).size).toBe(1);
    expect(layout[1].y).toBeGreaterThanOrEqual(layout[0].y + layout[0].height);
    expect(layout[2].y).toBeGreaterThanOrEqual(layout[1].y + layout[1].height);
    await expect(card.getByTestId("conflict-tags").locator(":scope > span")).toHaveText(["黑区", "冻结", "同时修改同一处代码"]);
    const summary = await card.getByTestId("conflict-summary").textContent();
    expect(summary!.length).toBeLessThan(100);
    expect(summary).not.toMatch(/[·；]/);
    await card.locator(".conflict-code-detail summary").click();
    await expect(card.locator(".conflict-pair-texts")).toContainText("修改前");
    await expect(card.locator(".conflict-pair-texts")).toContainText("applyDiscount(amount, 0.2)");
    await card.locator(".conflict-code-detail summary").click();
    const banner = alice.getByTestId("editor-conflict-banner");
    await expect(banner.locator("summary")).toContainText("当前有 1 个冲突");
    expect(await banner.evaluate((element) => element.hasAttribute("open"))).toBe(false);
    const bannerBox = await banner.boundingBox();
    const editorBox = await alice.locator(".monaco-editor").first().boundingBox();
    expect(editorBox!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height);
    await banner.locator("summary").click();
    await expect(banner.locator("li")).toHaveCount(1);
    await banner.locator("summary").click();
    const panel = alice.getByTestId("conflict-guard-panel");
    expect(await panel.innerText()).not.toMatch(/[·•⟷]/);
    await expect(card.getByTestId("conflict-participants").locator(".conflict-participant")).toHaveCount(2);
    await expect(card.getByTestId("conflict-participants")).toContainText("Alice");
    await expect(card.getByTestId("conflict-participants")).toContainText("Bob");
    const state = await guardState(alice, id);
    await alice.getByTestId("conflict-history").locator(":scope > summary").click();
    await alice.getByTestId("conflict-detailed-statistics").locator(":scope > summary").click();
    const statistics = alice.getByTestId("conflict-statistics");
    await expect(statistics.locator('[data-metric="pairs"] dd')).toHaveText(`${state.intervention!.decisions} 个`);
    await expect(statistics.locator('[data-metric="black"] dd')).toHaveText(`${state.intervention!.black} 个`);
    await expect(statistics.locator('[data-metric="grey"] dd')).toHaveText(`${state.intervention!.grey} 个`);
    await expect(statistics.locator('[data-metric="white"] dd')).toHaveText(`${state.intervention!.white} 个`);
    const details = statistics.locator(".conflict-stat-details");
    expect(await details.evaluate((element) => element.hasAttribute("open"))).toBe(false);
    await details.locator("summary").click();
    await expect(statistics.locator('[data-metric="indexed-files"] dd')).toBeVisible();
    await expect(statistics.locator('[data-metric="indexed-files"] dd')).toHaveText(`${state.index.files} 个`);
    await details.locator("summary").click();
    const dark = await panelStyles(alice);
    expect(dark.cardFont).toBe(dark.systemFont);
    await alice.getByTestId("theme-toggle").click();
    await expect(alice.locator("html")).toHaveAttribute("data-theme", "light");
    const light = await panelStyles(alice);
    expect(light.cardFont).toBe(light.systemFont);
    expect(light.cardBackground).not.toBe(dark.cardBackground);
    expect(light.metricBackground).not.toBe(dark.metricBackground);
    expect(light.headingColor).not.toBe(dark.headingColor);
    await alice.getByTestId("theme-toggle").click();
    const handle = await alice.getByRole("separator", { name: "Resize collaboration panel" }).boundingBox();
    await alice.mouse.move(handle!.x + handle!.width / 2, handle!.y + 80);
    await alice.mouse.down();
    await alice.mouse.move(handle!.x + handle!.width / 2 + 100, handle!.y + 80, { steps: 5 });
    await alice.mouse.up();
    await expect.poll(() => alice.locator(".app-shell").evaluate((element) => getComputedStyle(element).getPropertyValue("--collaboration-pane-width"))).toBe("280px");
    await statistics.scrollIntoViewIfNeeded();
    const layoutChecks = await panel.locator(".conflict-metric, .conflict-participant, .conflict-candidate, .conflict-card").evaluateAll((elements) => elements.map((element) => ({ className: element.className, width: element.clientWidth, scrollWidth: element.scrollWidth })));
    for (const entry of layoutChecks) expect(entry.scrollWidth, entry.className).toBeLessThanOrEqual(entry.width + 1);
    if (process.env.SIMPLERCP_UI_LAYOUT_EVIDENCE === "1") {
      const layoutEvidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/ui-round2/", import.meta.url));
      await fs.mkdir(layoutEvidence, { recursive: true });
      await fs.writeFile(path.join(layoutEvidence, "layout.json"), JSON.stringify({ dark, light, panelWidth: 280, layoutChecks, displayedCounts: { pairs: state.intervention!.decisions, black: state.intervention!.black, grey: state.intervention!.grey, white: state.intervention!.white }, checks: { noJoinedLabels: true, themesFollowSystem: true, noHorizontalOverflow: true } }, null, 2) + "\n");
    }
    if (process.env.SIMPLERCP_UI_EVIDENCE) {
      await fs.mkdir(evidence, { recursive: true });
      const phase = process.env.SIMPLERCP_UI_EVIDENCE;
      await alice.screenshot({ path: path.join(evidence, `${phase}-overview.png`), fullPage: true });
      await alice.getByTestId("conflict-card").first().screenshot({ path: path.join(evidence, `${phase}-card.png`) });
      await alice.getByTestId("conflict-candidates").screenshot({ path: path.join(evidence, `${phase}-related.png`) });
      await alice.locator(".collab-tabs").screenshot({ path: path.join(evidence, `${phase}-tabs.png`) });
      await alice.getByTestId("editor-conflict-banner").screenshot({ path: path.join(evidence, `${phase}-banner.png`) });
    }
    await card.getByRole("button", { name: "双方确认后继续" }).click();
    await expect(card.getByRole("button", { name: "双方确认后继续（已确认）" })).toBeDisabled();
    await bob.getByTestId("conflict-card").filter({ hasText: "Cart.total" }).getByRole("button", { name: "双方确认后继续" }).click();
    await expect(alice.getByTestId("conflict-tab-count")).toHaveText("1");
    await expect(bob.getByTestId("conflict-tab-count")).toHaveText("1");
    await expect(alice.getByTestId("conflict-card")).toHaveCount(1);
    await expect(bob.getByTestId("conflict-card")).toHaveCount(1);
    await expect(alice.getByTestId("editor-conflict-banner")).toHaveCount(0);
    alice.once("dialog", (dialog) => void dialog.accept());
    await alice.getByTestId("conflict-card").getByRole("button", { name: "我来改" }).click();
    await expect(alice.getByTestId("conflict-action-error")).toHaveText("撤回会与他人的修改交叠，请在聊天中协商");
    await expect(alice.getByTestId("conflict-tab-count")).toHaveText("1");
    bob.once("dialog", (dialog) => void dialog.accept());
    await bob.getByTestId("conflict-card").getByRole("button", { name: "我来改" }).click();
    await expect(alice.getByTestId("conflict-card")).toHaveCount(0);
    await expect(alice.getByTestId("conflict-tab-count")).toHaveCount(0);
    await expect(alice.getByTestId("workspace-notice").filter({ hasText: /Unexpected end of JSON|Failed to execute 'json'|JSON/ })).toHaveCount(0);
    await expect(bob.getByTestId("workspace-notice").filter({ hasText: /Unexpected end of JSON|Failed to execute 'json'|JSON/ })).toHaveCount(0);
  } finally {
    await a.close();
    await b.close();
  }
});

async function openFile(page: Page, file: string) {
  await page.getByTestId(`file-${file}`).click();
  await page.waitForFunction((file) => window.__simplercpYjsSynced?.[file], file);
}
async function value(page: Page, file: string) { return page.evaluate((file) => window.__simplercpEditors?.[file]?.getValue(), file); }
async function guardState(page: Page, id: string): Promise<ConflictGuardState> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! } });
    if (!response.ok) throw new Error(`冲突预防请求失败：${response.status}`);
    return response.json();
  }, id);
}
async function panelStyles(page: Page) {
  return page.evaluate(() => {
    const card = getComputedStyle(document.querySelector('[data-testid="conflict-card"]')!);
    const metric = getComputedStyle(document.querySelector('[data-testid="conflict-statistics"] .conflict-metric')!);
    const heading = getComputedStyle(document.querySelector(".conflict-card-title")!);
    return { systemFont: getComputedStyle(document.body).fontFamily, cardFont: card.fontFamily, cardBackground: card.backgroundColor, metricBackground: metric.backgroundColor, headingColor: heading.color };
  });
}
async function edit(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors![file];
    const model = editor.getModel()!;
    const from = model.getValue().indexOf(before);
    if (from < 0) throw new Error("没有找到待修改文本");
    const start = model.getPositionAt(from);
    const end = model.getPositionAt(from + before.length);
    editor.executeEdits("ui-round1", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}
