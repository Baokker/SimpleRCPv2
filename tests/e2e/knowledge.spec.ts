import { test, expect } from "@playwright/test";
import { openAs } from "./helpers";

const screenshotDirectory = "docs/knowledge/screenshots";

async function memberHeaders(page: Parameters<typeof openAs>[0], projectId = "demo") {
  return page.evaluate((id) => ({ "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`) ?? "" }), projectId);
}

test.describe("knowledge stage 2", () => {
  test("生成 Demo 卡片并在当前文件视图显示", async ({ page }) => {
    await openAs(page, "Ada");
    await page.getByTestId("collab-tab-knowledge").click();
    const headers = await memberHeaders(page);
    await page.evaluate(async (requestHeaders) => {
      await fetch("/api/projects/demo/knowledge/demo", { method: "POST", headers: { ...requestHeaders, "content-type": "application/json" }, body: "{}" });
    }, headers);
    await expect(page.getByTestId("knowledge-panel")).toContainText("Use an explicit timeout around this code path");
    await page.screenshot({ path: `${screenshotDirectory}/FV-6-demo-cards.png` });
  });

  test("打开锚定文件后显示编辑器与知识面板", async ({ page }) => {
    await openAs(page, "Ada");
    const headers = await memberHeaders(page);
    await page.evaluate(async (requestHeaders) => {
      await fetch("/api/projects/demo/knowledge/cards", {
        method: "POST",
        headers: { ...requestHeaders, "content-type": "application/json" },
        body: JSON.stringify({ type: "decision", title: "Hello anchor", summary: "Anchor summary", content: "Anchor content", scope: "team", tags: [], anchors: [{ file: "src/hello.ts", selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 21 } }] })
      });
    }, headers);
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await page.getByTestId("collab-tab-knowledge").click();
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await expect(page.getByTestId("knowledge-panel")).toContainText("Hello anchor");
    await page.screenshot({ path: `${screenshotDirectory}/FV-7-gutter-hover.png` });
  });

  test("导览与时间线视图可以切换", async ({ page }) => {
    await openAs(page, "Ada");
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "生成 Demo" }).click();
    await page.getByRole("button", { name: "导览" }).click();
    await expect(page.getByTestId("knowledge-panel")).toContainText("Newcomer reading note for this file");
    await page.screenshot({ path: `${screenshotDirectory}/FV-8-guide.png` });
    await page.getByRole("button", { name: "时间线" }).click();
    await expect(page.locator(".knowledge-timeline-item").first()).toBeVisible();
    await page.screenshot({ path: `${screenshotDirectory}/FV-9-timeline.png` });
  });

  test("团队卡片可见且个人卡片受作用域限制", async ({ browser }) => {
    const first = await browser.newPage();
    const second = await browser.newPage();
    await openAs(first, "Ada");
    await openAs(second, "Bob");
    const firstHeaders = await memberHeaders(first);
    await first.evaluate(async (headers) => {
      await fetch("/api/projects/demo/knowledge/cards", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "decision", title: "Team rule", summary: "Shared", content: "Shared content", scope: "team", tags: [] }) });
      await fetch("/api/projects/demo/knowledge/cards", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "context", title: "Private rule", summary: "Private", content: "Private content", scope: "personal", tags: [] }) });
    }, firstHeaders);
    await second.getByTestId("collab-tab-knowledge").click();
    await expect(second.getByTestId("knowledge-panel")).toContainText("Team rule");
    await expect(second.getByTestId("knowledge-panel")).not.toContainText("Private rule");
    await first.screenshot({ path: `${screenshotDirectory}/FV-10-team-card.png` });
    await second.screenshot({ path: `${screenshotDirectory}/FV-10-personal-visibility.png` });
    await first.close();
    await second.close();
  });

  test("选区 Pin 打开卡片编辑器", async ({ page }) => {
    await openAs(page, "Ada");
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await page.getByTestId("collab-tab-knowledge").click();
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await page.evaluate(() => {
      const editor = (window as Window & { __simplercpEditors?: Record<string, { setSelection(selection: unknown): void; focus(): void; trigger(source: string, handlerId: string, payload: unknown): void }> }).__simplercpEditors?.["src/hello.ts"];
      editor?.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 });
      editor?.focus();
      editor?.trigger("keyboard", "knowledge.pin", {});
    });
    await page.keyboard.press("Control+Shift+K");
    await expect(page.getByRole("dialog", { name: "知识卡片编辑器" })).toBeVisible();
    await page.screenshot({ path: `${screenshotDirectory}/FV-11-pin-editor.png` });
  });
});
