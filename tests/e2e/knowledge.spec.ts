import { test, expect } from "@playwright/test";
import { openAs } from "./helpers";

const screenshotDirectory = "docs/knowledge/screenshots";

test.describe("knowledge stage 6", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") !== "full", "Knowledge document flows use full mode");
  test("导入规范草稿，编辑后批量确认并导出团队知识", async ({ page }) => {
    test.setTimeout(90_000);
    await openAs(page, "Document reviewer");
    const headers = await memberHeaders(page);
    const document = await page.request.post("/api/projects/demo/workspace/file", { headers, data: { path: "README.md", content: "# 项目规范\n\n## Session\n\n修改代码后执行项目测试，并检查 Session 行为。\n" } });
    expect(document.status()).toBe(200);
    const configured = await page.request.put("/api/projects/demo/knowledge/config", { headers, data: { requireSecondConfirmForTeam: false } });
    expect(configured.status()).toBe(200);
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "导入规范文档", exact: true }).click();
    const panel = page.getByTestId("knowledge-import");
    await panel.getByLabel("规范文档路径").fill("README.md");
    const importedResponse = page.waitForResponse(response => response.url().endsWith("/knowledge/import") && response.request().method() === "POST", { timeout: 65_000 });
    await panel.getByRole("button", { name: "生成导入草稿" }).click();
    expect((await importedResponse).status()).toBe(201);
    await expect(panel.locator(".knowledge-suggestion").first()).toBeVisible();
    await expect(panel).toContainText("原文与行号");
    const drafts = panel.locator("textarea[aria-label^='导入草稿']");
    await drafts.first().fill("修改代码后执行项目测试，并检查 Session 行为。");
    await panel.getByRole("button", { name: "确认选中的草稿" }).click();
    await expect(panel.locator(".knowledge-suggestion")).toHaveCount(0);
    await page.getByRole("button", { name: "导出团队 AGENTS.md", exact: true }).click();
    await expect(page.getByTestId("knowledge-panel")).toContainText(/团队知识已写入 AGENTS(\.knowledge)?\.md/);
    await page.request.put("/api/projects/demo/knowledge/config", { headers, data: { requireSecondConfirmForTeam: true } });
  });
});

async function memberHeaders(page: Parameters<typeof openAs>[0], projectId = "demo") {
  return page.evaluate((id) => ({ "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`) ?? "" }), projectId);
}

test.describe("knowledge stage 2", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") === "off", "Knowledge scenarios use test:e2e:knowledge");
  test("生成 Demo 卡片并在当前文件视图显示", async ({ page }) => {
    await openAs(page, "Ada");
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/projectStatus.js").click();
    await page.getByTestId("collab-tab-knowledge").click();
    const headers = await memberHeaders(page);
    const generated = await page.request.post("/api/projects/demo/knowledge/demo", { headers, data: {} });
    expect(generated.status()).toBe(201);
    const panel = page.getByTestId("knowledge-panel");
    for (const [type, title] of Object.entries({ decision: "集中计算任务状态", constraint: "保持任务字段含义", risk: "注意下一项任务的顺序", context: "任务状态模块的用途", negative: "保持状态计算与文本格式的职责", tutorial: "阅读任务状态代码" })) {
      await expect(panel.locator(`.knowledge-card-${type}`)).toHaveCount(1);
      await expect(panel.locator(`.knowledge-card-${type}`)).toContainText(title);
    }
    await expect(panel).toContainText("createProjectStatus");
    await expect(panel).toContainText("formatProjectStatus");
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
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await expect(page.getByTestId("collab-tab-chat")).toHaveClass("active");
    await page.getByTestId("toggle-collaboration").click();
    await expect(page.locator(".collab-pane")).toBeHidden();
    await expect(page.locator(".knowledge-glyph").first()).toBeVisible();
    await page.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.setPosition({ lineNumber: 1, column: 10 });
      editor.focus();
      editor.trigger("knowledge-review", "editor.action.showHover", {});
    });
    const hover = page.locator(".monaco-hover").filter({ hasText: "Anchor summary" });
    await expect(hover).toContainText("Hello anchor");
    await expect(hover).toContainText("Anchor summary");
    await page.screenshot({ path: `${screenshotDirectory}/FV-7-gutter-hover.png` });
    await hover.getByRole("link", { name: "打开卡片", exact: true }).click();
    await expect(page.locator(".collab-pane")).toBeVisible();
    await expect(page.getByTestId("collab-tab-knowledge")).toHaveClass("active");
    await expect(page.locator(".knowledge-card-content")).toContainText("Anchor content");
  });

  test("双浏览器修改代码后知识高亮范围继续跟随锚点", async ({ browser }) => {
    const first = await browser.newPage();
    const second = await browser.newPage();
    await openAs(first, "Anchor Ada");
    await openAs(second, "Anchor Bob");
    for (const page of [first, second]) {
      await page.getByTestId("dir-src").click();
      await page.getByTestId("file-src/hello.ts").click();
      await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["src/hello.ts"]?.getModel()))).toBe(true);
    }
    const headers = await memberHeaders(first);
    const created = await first.request.post("/api/projects/demo/knowledge/cards", {
      headers,
      data: { type: "decision", title: "Concurrent moving anchor", summary: "Both members retain the code anchor", content: "Follow the selected statement.", scope: "team", tags: [], anchors: [{ file: "src/hello.ts", selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 21 } }] }
    });
    expect(created.status()).toBe(201);
    const decorationRange = (page: typeof first) => page.evaluate(() => {
      const model = window.__simplercpEditors!["src/hello.ts"]!.getModel()!;
      const decoration = model.getAllDecorations().find(item => {
        const messages = item.options.hoverMessage;
        const descriptions = Array.isArray(messages) ? messages : messages ? [messages] : [];
        return item.options.className === "knowledge-anchor-highlight" && descriptions.some(message => message.value.includes("Concurrent moving anchor"));
      });
      if (!decoration) return null;
      const range = decoration.range;
      return { startLineNumber: range.startLineNumber, startColumn: range.startColumn, endLineNumber: range.endLineNumber, endColumn: range.endColumn };
    });
    for (const page of [first, second]) await expect.poll(() => decorationRange(page)).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 21 });
    await first.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.executeEdits("knowledge-prefix", [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: "// 协作前置内容\n" }]);
    });
    await expect.poll(() => second.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getModel()!.getValue())).toContain("// 协作前置内容\n");
    for (const page of [first, second]) await expect.poll(() => decorationRange(page)).toEqual({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 21 });
    await second.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.executeEdits("knowledge-inside-anchor", [{ range: { startLineNumber: 2, startColumn: 15, endLineNumber: 2, endColumn: 15 }, text: "X" }]);
    });
    await expect.poll(() => first.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getModel()!.getValue())).toContain("hXello");
    for (const page of [first, second]) await expect.poll(() => decorationRange(page)).toEqual({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 22 });
    await first.close();
    await second.close();
  });

  test("导览优先显示当前文件六类卡片，时间线显示当前文件事件", async ({ page }) => {
    await openAs(page, "Ada");
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/projectStatus.js").click();
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "生成 Demo" }).click();
    await page.getByRole("button", { name: "导览" }).click();
    const panel = page.getByTestId("knowledge-panel");
    const titles = ["阅读任务状态代码", "集中计算任务状态", "保持任务字段含义", "注意下一项任务的顺序", "保持状态计算与文本格式的职责", "任务状态模块的用途"];
    await expect(panel.locator(".knowledge-list > .knowledge-card:nth-child(-n+6) .knowledge-card-summary strong")).toHaveText([
      "tutorial · 阅读任务状态代码",
      "decision · 集中计算任务状态",
      "constraint · 保持任务字段含义",
      "risk · 注意下一项任务的顺序",
      "negative · 保持状态计算与文本格式的职责",
      "context · 任务状态模块的用途"
    ]);
    for (const title of ["Hello anchor", "Concurrent moving anchor"]) await expect(panel.locator(".knowledge-list > .knowledge-card:nth-child(n+7) .knowledge-card-summary").filter({ hasText: title })).toHaveCount(1);
    await panel.locator(".knowledge-card-tutorial .knowledge-card-summary").click();
    await expect(panel.locator(".knowledge-card-tutorial .knowledge-card-content")).toContainText("tasks.length");
    await expect(panel.locator(".knowledge-card-tutorial .knowledge-card-content")).toContainText("formatProjectStatus");
    await page.screenshot({ path: `${screenshotDirectory}/FV-8-guide.png` });
    await page.getByRole("button", { name: "时间线" }).click();
    for (const title of titles) {
      for (const action of ["Created", "Updated", "reviewed"]) await expect(panel.getByText(`${action}: ${title}`, { exact: true })).toBeVisible();
    }
    for (const title of ["Hello anchor", "Concurrent moving anchor"]) await expect(panel).not.toContainText(title);
    const timestamps = await panel.locator(".knowledge-timeline-item time").evaluateAll(times => times.map(time => Date.parse((time as HTMLTimeElement).dateTime)));
    expect(timestamps.every(Number.isFinite)).toBe(true);
    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
    await page.screenshot({ path: `${screenshotDirectory}/FV-9-timeline.png` });
  });

  test("hover 使用当前选区重选失效锚点", async ({ page }) => {
    await openAs(page, "Anchor reviewer");
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["src/hello.ts"]?.getModel()))).toBe(true);
    const original = await page.evaluate(() => {
      const model = window.__simplercpEditors!["src/hello.ts"]!.getModel()!;
      return { text: model.getValue(), endColumn: model.getLineMaxColumn(1) };
    });
    const headers = await memberHeaders(page);
    const created = await page.request.post("/api/projects/demo/knowledge/cards", {
      headers,
      data: { type: "risk", title: "Review anchor selection", summary: "Reselect the replacement statement", content: "Use the current code selection.", scope: "team", tags: [], anchors: [{ file: "src/hello.ts", selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: original.endColumn } }] }
    });
    expect(created.status()).toBe(201);
    const card = (await created.json() as { card: { id: string; ownerMemberId: string } }).card;
    expect(card.ownerMemberId).toBe(headers["X-SimpleRCP-Member"]);
    const decoration = () => page.evaluate(() => {
      const model = window.__simplercpEditors!["src/hello.ts"]!.getModel()!;
      const item = model.getAllDecorations().find(candidate => {
        const messages = candidate.options.hoverMessage;
        const descriptions = Array.isArray(messages) ? messages : messages ? [messages] : [];
        return descriptions.some(message => message.value.includes("Review anchor selection"));
      });
      if (!item) return null;
      return { className: item.options.className, range: { startLineNumber: item.range.startLineNumber, startColumn: item.range.startColumn, endLineNumber: item.range.endLineNumber, endColumn: item.range.endColumn } };
    });
    await expect.poll(decoration).toMatchObject({ className: "knowledge-anchor-highlight" });
    await page.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.executeEdits("replace-anchor", [{ range: editor.getModel()!.getFullModelRange(), text: "export const replacement = 2;\n" }]);
    });
    await expect.poll(decoration).toMatchObject({ className: "knowledge-anchor-review" });
    await page.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 });
      editor.focus();
    });
    await page.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getAction("knowledge.reanchor")!.run());
    await page.locator(".knowledge-glyph-review").first().hover();
    const hover = page.locator(".monaco-hover").filter({ hasText: "Review anchor selection" });
    await expect(hover).toContainText("Reselect the replacement statement");
    expect(await page.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getSelection())).toMatchObject({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 });
    const reanchored = page.waitForResponse(response => response.url().includes(`/knowledge/cards/${card.id}/anchors/0`) && response.request().method() === "POST", { timeout: 10_000 });
    await hover.getByRole("link", { name: "用当前选区重新锚定", exact: true }).click();
    expect(await page.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getSelection())).toMatchObject({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 });
    expect((await reanchored).status()).toBe(200);
    await expect.poll(decoration).toEqual({ className: "knowledge-anchor-highlight", range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 } });
    await page.evaluate(text => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.executeEdits("restore-file", [{ range: editor.getModel()!.getFullModelRange(), text }]);
    }, original.text);
    await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
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
    await first.getByTestId("collab-tab-knowledge").click();
    await expect(first.getByTestId("knowledge-panel")).toContainText("Team rule");
    await expect(first.getByTestId("knowledge-panel")).toContainText("Private rule");
    await second.getByTestId("collab-tab-knowledge").click();
    await expect(second.getByTestId("knowledge-panel")).toContainText("Team rule");
    await expect(second.getByTestId("knowledge-panel")).not.toContainText("Private rule");
    await first.screenshot({ path: `${screenshotDirectory}/FV-10-team-card.png` });
    await second.screenshot({ path: `${screenshotDirectory}/FV-10-personal-visibility.png` });
    await first.close();
    await second.close();
  });

  test("默认 Chat 页面通过选区 Pin 快捷键打开卡片编辑器", async ({ page }) => {
    await openAs(page, "Ada");
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await expect(page.getByTestId("collab-tab-chat")).toHaveClass("active");
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await page.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 });
      editor.focus();
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await expect(page.getByRole("dialog", { name: "知识卡片编辑器" })).toBeVisible();
    await expect(page.getByTestId("collab-tab-knowledge")).toHaveClass("active");
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
    await first.getByRole("button", { name: "全部卡片", exact: true }).click();
    await first.locator(".knowledge-card-summary").filter({ hasText: "成员改写了协作者的内容" }).first().click();
    await first.getByRole("button", { name: "确认", exact: true }).click();
    const reviewer = first.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(reviewer).toContainText("原始证据");
    await reviewer.getByPlaceholder("标题", { exact: true }).fill("S3 confirmed collaboration decision");
    await reviewer.getByPlaceholder("摘要", { exact: true }).fill("Use captureChosen as the agreed shared result.");
    await reviewer.getByRole("button", { name: "确认并保存" }).click();
    await expect(reviewer).not.toBeVisible();
    await expect(first.getByTestId("knowledge-panel")).toContainText("S3 confirmed collaboration decision");
    await second.getByRole("button", { name: "全部卡片", exact: true }).click();
    await expect(second.getByTestId("knowledge-panel")).toContainText("S3 confirmed collaboration decision");
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
    await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpYjsSynced?.["package.json"]))).toBe(true);
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

test.describe("knowledge stage 4", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") !== "full", "Agent knowledge scenarios use test:e2e:knowledge");
  test("个人 Agent 预览并显示注入与任务后核对", async ({ page }) => {
    await openAs(page, "Agent knowledge reviewer");
    const headers = await memberHeaders(page);
    const created = await page.request.post("/api/projects/demo/knowledge/cards", {
      headers,
      data: { type: "constraint", title: "Agent project rule", summary: "Keep the project rule", content: "Keep the project rule in the final change.", scope: "team", tags: [] }
    });
    expect(created.status()).toBe(201);
    await page.getByTestId("collab-tab-agent").click();
    await page.getByTestId("agent-prompt").fill("Follow the project rule fake-reply=done");
    await expect(page.getByTestId("agent-knowledge-preview")).toContainText("Agent project rule");
    await page.getByTestId("agent-run-submit").click();
    await expect(page.getByTestId("agent-selected-run")).toContainText("done", { timeout: 20_000 });
    await expect(page.getByTestId("agent-knowledge-reference")).toContainText("Agent project rule");
    await expect(page.getByTestId("agent-knowledge-post-check")).toContainText("未发现已知问题");
    await page.screenshot({ path: `${screenshotDirectory}/S4-1-agent-injection.png` });
  });
});

test.describe("knowledge stage 5", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") !== "full", "Agent capture scenarios use test:e2e:knowledge");

  test("成员改写 Agent 修改后双方收到 Agent 纠正建议", async ({ browser }) => {
    const first = await browser.newPage();
    const second = await browser.newPage();
    await openAs(first, "Stage5 Ada");
    await openAs(second, "Stage5 Bob");
    for (const page of [first, second]) {
      await page.getByTestId("dir-src").click();
      await page.getByTestId("file-src/hello.ts").click();
      await page.getByTestId("collab-tab-knowledge").click();
      await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["src/hello.ts"]?.getModel()))).toBe(true);
    }
    const adaHeaders = await memberHeaders(first);
    const sessionResponse = await first.request.post("/api/projects/demo/agent/sessions", { headers: adaHeaders, data: { title: "Stage5 capture" } });
    expect(sessionResponse.status()).toBe(201);
    const session = (await sessionResponse.json() as { session: { id: string } }).session;
    const runResponse = await first.request.post(`/api/projects/demo/agent/sessions/${session.id}/runs`, {
      headers: adaHeaders,
      data: { prompt: "Write the corrected example fake-edit=src/hello.ts:1:export const agentStage5 = true; fake-delay=100 fake-reply=stage5" }
    });
    expect(runResponse.status()).toBe(202);
    const runId = (await runResponse.json() as { run: { id: string } }).run.id;
    await expect.poll(async () => {
      const response = await first.request.get(`/api/projects/demo/agent/runs/${runId}`, { headers: adaHeaders });
      return (await response.json() as { run: { status: string } }).run.status;
    }, { timeout: 30_000 }).toBe("completed");
    await expect.poll(() => second.evaluate(() => window.__simplercpEditors!["src/hello.ts"]!.getModel()!.getValue())).toContain("agentStage5");
    await second.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      editor.executeEdits("stage5-revision", [{ range: editor.getModel()!.getFullModelRange(), text: "export const humanStage5 = true;\n" }]);
    });
    await expect.poll(() => first.getByTestId("knowledge-unread").isVisible(), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => second.getByTestId("knowledge-unread").isVisible(), { timeout: 30_000 }).toBe(true);
    await first.getByRole("button", { name: "Inbox", exact: true }).click();
    await second.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(first.getByTestId("knowledge-inbox")).toContainText("成员在 src/hello.ts 上改写了 Agent 的内容");
    await expect(second.getByTestId("knowledge-inbox")).toContainText("成员在 src/hello.ts 上改写了 Agent 的内容");
    await first.screenshot({ path: `${screenshotDirectory}/S5-1-agent-revised-inbox-ada.png` });
    await second.screenshot({ path: `${screenshotDirectory}/S5-1-agent-revised-inbox-bob.png` });
    await first.close();
    await second.close();
  });
});
