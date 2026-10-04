import { test, expect } from "@playwright/test";
import { openAs } from "./helpers";

const screenshotDirectory = "docs/knowledge/screenshots";

async function memberHeaders(page: Parameters<typeof openAs>[0], projectId = "demo") {
  return page.evaluate((id) => ({ "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`) ?? "" }), projectId);
}

test.describe("knowledge stage 2", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") === "off", "Knowledge scenarios use test:e2e:knowledge");
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

test.describe("knowledge stage 3", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") === "off", "Knowledge scenarios use test:e2e:knowledge");
  test("双方改写建议进入 Inbox，接受与确认生成团队知识", async ({ browser }) => {
    const first = await browser.newPage(); const second = await browser.newPage();
    await openAs(first, "Capture Ada"); await openAs(second, "Capture Bob");
    for (const page of [first, second]) {
      await page.getByTestId("dir-src").click(); await page.getByTestId("file-src/hello.ts").click();
      await page.getByTestId("collab-tab-knowledge").click();
      await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["src/hello.ts"]?.getModel()))).toBe(true);
    }
    const text = "\nexport const captureOne = 1;\nexport const captureTwo = 2;\nexport const captureThree = 3;\nexport const captureFour = 4;\n";
    await first.evaluate(value => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!; const model = editor.getModel()!;
      const line = model.getLineCount(); const column = model.getLineMaxColumn(line);
      editor.executeEdits("knowledge-session", [{ range: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column }, text: value }]);
    }, text);
    await expect.poll(() => second.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getModel()!.getValue())).toContain("captureFour");
    await second.evaluate(value => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!; const model = editor.getModel()!;
      const offset = model.getValue().indexOf(value); const start = model.getPositionAt(offset); const end = model.getPositionAt(offset + value.length);
      editor.executeEdits("knowledge-session", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: "\nexport const captureChosen = 2;\n" }]);
    }, text);
    for (const page of [first, second]) {
      await expect(page.getByTestId("knowledge-unread")).toBeVisible();
      await page.getByRole("button", { name: "Inbox", exact: true }).click();
      await expect(page.getByTestId("suggestion-edit.overwritten").first()).toBeVisible();
      await expect(page.getByTestId("knowledge-unread")).toHaveCount(0);
    }
    await first.screenshot({ path: `${screenshotDirectory}/S3-1-overwrite-inbox-ada.png` });
    const suggestion = second.getByTestId("suggestion-edit.overwritten").first();
    await suggestion.getByRole("button", { name: "接受", exact: true }).click();
    const editor = second.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(editor).toBeVisible(); await expect(editor).toContainText("原始证据");
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await second.getByRole("button", { name: "全部卡片", exact: true }).click();
    await second.locator(".knowledge-card-summary").filter({ hasText: "成员改写了协作者的内容" }).first().click();
    await second.getByRole("button", { name: "确认", exact: true }).click();
    await expect(editor).toContainText("原始证据");
    await editor.getByPlaceholder("标题", { exact: true }).fill("S3 confirmed collaboration decision");
    await editor.getByPlaceholder("摘要", { exact: true }).fill("Use captureChosen as the agreed shared result.");
    await editor.getByRole("button", { name: "确认并保存" }).click();
    await expect(editor).not.toBeVisible();
    await first.getByRole("button", { name: "全部卡片", exact: true }).click();
    await expect(first.getByTestId("knowledge-panel")).toContainText("S3 confirmed collaboration decision");
    await second.getByRole("button", { name: "全部卡片", exact: true }).click();
    await second.screenshot({ path: `${screenshotDirectory}/S3-2-confirmed-team-card.png` });
    await first.close(); await second.close();
  });

  test("配置检查点显示风险提醒并打开关联卡片", async ({ page }) => {
    await openAs(page, "Risk reviewer"); const headers = await memberHeaders(page);
    await page.evaluate(async requestHeaders => {
      await fetch("/api/projects/demo/workspace/file", { method: "POST", headers: { ...requestHeaders, "content-type": "application/json" }, body: JSON.stringify({ path: "package.json", content: '{"name":"risk-package","dependencies":{}}' }) });
      await fetch("/api/projects/demo/knowledge/cards", { method: "POST", headers: { ...requestHeaders, "content-type": "application/json" }, body: JSON.stringify({ type: "risk", title: "S3 dependency risk", summary: "package.json risk-package alpha dependencies require a compatibility check", content: "package.json risk-package alpha dependencies require a compatibility check before adding alpha.", scope: "team", tags: ["alpha", "dependencies"] }) });
    }, headers);
    await page.reload();
    if (await page.getByTestId("display-name").isVisible()) { await page.getByTestId("display-name").fill("Risk reviewer"); await page.getByTestId("join-project").click(); }
    await page.getByTestId("file-package.json").click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["package.json"]?.getModel()))).toBe(true);
    await page.evaluate(() => {
      const editor = window.__simplercpEditors!["package.json"]!; const model = editor.getModel()!;
      editor.executeEdits("knowledge-session", [{ range: model.getFullModelRange(), text: '{"name":"risk-package","dependencies":{"alpha":"1"}}' }]);
    });
    await expect(page.getByTestId("knowledge-risk-warning")).toBeVisible({ timeout: 40_000 });
    await page.screenshot({ path: `${screenshotDirectory}/S3-3-FV-11-risk-warning.png` });
    await page.getByTestId("knowledge-risk-warning").getByRole("button", { name: "打开卡片" }).click();
    await expect(page.getByTestId("knowledge-panel")).toContainText("S3 dependency risk");
  });

  test("选择聊天消息创建建议并显示共现候选", async ({ page }) => {
    await openAs(page, "Chat author");
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["src/hello.ts"]?.getModel()))).toBe(true);
    await page.evaluate(() => { const editor = window.__simplercpEditors!["src/hello.ts"]!; editor.setPosition({ lineNumber: 1, column: 2 }); editor.focus(); });
    await page.waitForTimeout(250);
    const headers = await memberHeaders(page);
    await page.evaluate(async requestHeaders => { await fetch("/api/projects/demo/chat", { method: "POST", headers: { ...requestHeaders, "content-type": "application/json" }, body: JSON.stringify({ text: "S3 chat choose the shared timeout in src/hello.ts" }) }); }, headers);
    await expect(page.getByTestId("chat-transcript")).toContainText("S3 chat choose the shared timeout");
    await page.getByRole("checkbox", { name: /选择消息 Chat author S3 chat/ }).check();
    await page.getByRole("button", { name: "从这些消息创建知识" }).click();
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(page.getByTestId("knowledge-inbox")).toContainText("S3 chat choose the shared timeout");
    await expect(page.getByTestId("suggestion-chat.dense").filter({ hasText: "S3 chat choose the shared timeout" }).getByRole("button", { name: /src\/hello.ts:/ })).toBeVisible();
    await page.screenshot({ path: `${screenshotDirectory}/S3-4-selected-chat.png` });
  });
});
