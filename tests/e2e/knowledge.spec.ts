import { test, expect } from "@playwright/test";
import { openAs } from "./helpers";

const screenshotDirectory = process.env.SIMPLERCP_E2E_SCREENSHOT_DIR ?? "docs/knowledge/screenshots";

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
  await expect.poll(() => page.evaluate(id => sessionStorage.getItem(`simplercp.memberId.${id}`) ?? "", projectId)).not.toBe("");
  return page.evaluate((id) => ({ "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`) ?? "" }), projectId);
}

test.describe("knowledge stage 2", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") === "off", "Knowledge scenarios use test:e2e:knowledge");
  test("生成示例卡片并在本文件相关视图显示", async ({ page }) => {
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
    await expect(hover).toContainText("类型：决策");
    await expect(hover).toContainText("作用域：团队");
    await expect(hover).toContainText("状态：已确认");
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
    const headers = await memberHeaders(page);
    const existingResponse = await page.request.get("/api/projects/demo/knowledge/cards", { headers });
    const existing = (await existingResponse.json()).cards as Array<{ title: string }>;
    for (const title of ["Hello anchor", "Concurrent moving anchor"]) {
      if (existing.some(card => card.title === title)) continue;
      const created = await page.request.post("/api/projects/demo/knowledge/cards", { headers, data: { type: "decision", title, summary: "Anchor summary", content: "Anchor content", scope: "team", tags: [], anchors: [{ file: "src/hello.ts", selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 } }] } });
      expect(created.status()).toBe(201);
    }
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/projectStatus.js").click();
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "生成示例卡片" }).click();
    await page.getByRole("button", { name: "导览" }).click();
    const panel = page.getByTestId("knowledge-panel");
    const titles = ["阅读任务状态代码", "集中计算任务状态", "保持任务字段含义", "注意下一项任务的顺序", "保持状态计算与文本格式的职责", "任务状态模块的用途"];
    await expect(panel.locator(".knowledge-guide-entry:nth-child(-n+6) .knowledge-card-summary strong")).toHaveText(titles);
    await expect(panel.locator(".knowledge-guide-entry.first .knowledge-guide-reason")).toContainText("教程类优先");
    for (const title of ["Hello anchor", "Concurrent moving anchor"]) await expect(panel.locator(".knowledge-guide-entry:nth-child(n+7) .knowledge-card-summary").filter({ hasText: title })).toHaveCount(1);
    await panel.locator(".knowledge-card-tutorial .knowledge-card-summary").click();
    await expect(panel.locator(".knowledge-card-tutorial .knowledge-card-content")).toContainText("tasks.length");
    await expect(panel.locator(".knowledge-card-tutorial .knowledge-card-content")).toContainText("formatProjectStatus");
    await page.screenshot({ path: `${screenshotDirectory}/FV-8-guide.png` });
    await page.getByRole("button", { name: "时间线" }).click();
    for (const title of titles) {
      for (const action of ["创建了这张卡片", "修改了这张卡片", "完成了复核"]) await expect(panel.locator(".knowledge-timeline-item").filter({ hasText: title }).filter({ hasText: action })).toHaveCount(title === "任务状态模块的用途" && action === "修改了这张卡片" ? 0 : 1);
    }
    for (const title of ["Hello anchor", "Concurrent moving anchor"]) await expect(panel).not.toContainText(title);
    const timestamps = await panel.locator(".knowledge-timeline-item time").evaluateAll(times => times.map(time => Date.parse((time as HTMLTimeElement).dateTime)));
    expect(timestamps.every(Number.isFinite)).toBe(true);
    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
    await page.screenshot({ path: `${screenshotDirectory}/FV-9-timeline.png` });
    await panel.getByLabel("时间线卡片").selectOption({ label: titles[0]! });
    await expect(panel.locator(".knowledge-timeline-item button")).toHaveText([titles[0]!, titles[0]!, titles[0]!]);
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByTestId("theme-toggle").click();
      await page.screenshot({ path: `${screenshotDirectory}/S6-UI-5-timeline-${theme}.png` });
    }
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
    await first.getByRole("button", { name: "全部知识", exact: true }).click();
    await expect(first.getByTestId("knowledge-panel")).toContainText("Team rule");
    await expect(first.getByTestId("knowledge-panel")).toContainText("Private rule");
    await second.getByTestId("collab-tab-knowledge").click();
    await second.getByRole("button", { name: "全部知识", exact: true }).click();
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
    await expect(page.getByRole("dialog", { name: "知识卡片编辑器" }).getByPlaceholder("标题", { exact: true })).toBeFocused();
    const editorBox = await page.getByRole("dialog", { name: "知识卡片编辑器" }).boundingBox();
    const paneBox = await page.locator(".collab-tab-body").boundingBox();
    expect(editorBox).not.toBeNull();
    expect(paneBox).not.toBeNull();
    expect(editorBox!.y).toBeGreaterThanOrEqual(paneBox!.y);
    expect(editorBox!.y + editorBox!.height).toBeLessThanOrEqual(paneBox!.y + paneBox!.height);
    await expect(page.getByTestId("collab-tab-knowledge")).toHaveClass("active");
    await page.screenshot({ path: `${screenshotDirectory}/FV-11-pin-editor.png` });
    const body = page.locator(".knowledge-editor-body");
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(page.getByRole("dialog").getByText("这段知识关联到你刚才选中的代码")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "src/hello.ts:1–1", exact: true })).toBeVisible();
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByTestId("theme-toggle").click();
      await page.screenshot({ path: `${screenshotDirectory}/S6-UI-2-pin-editor-${theme}.png` });
    }
  });
});

test.describe("knowledge UI review", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") === "off", "Knowledge UI uses enabled mode");
  test("搜索筛选、编辑清理、复制链接与归档保留完整信息", async ({ page, context }) => {
    await openAs(page, "知识验收成员");
    const headers = await memberHeaders(page);
    const inputs = [
      { type: "constraint", title: "验收保留 helper", summary: "摘要查找词", content: "## 规则\n保留 sharedHelper。\n\n## Evidence\n```json\n{\"chatMessages\":[\"旧证据\"]}\n```", scope: "team", tags: ["验收标签"] },
      { type: "tutorial", title: "验收运行测试", summary: "使用项目命令", content: "正文查找词", scope: "personal", tags: ["验收标签"] },
      { type: "context", title: "验收模块用途", summary: "背景介绍", content: "模块背景", scope: "team", tags: ["验收标签"] }
    ];
    const created: Array<{ id: string }> = [];
    for (const input of inputs) {
      const response = await page.request.post("/api/projects/demo/knowledge/cards", { headers, data: input });
      expect(response.status()).toBe(201);
      created.push((await response.json()).card);
    }
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "全部知识", exact: true }).click();
    const panel = page.getByTestId("knowledge-panel");
    const search = panel.getByRole("searchbox", { name: "搜索知识" });
    await search.fill("验收标签");
    await expect(panel.locator(".knowledge-card")).toHaveCount(3);
    await expect(panel.getByRole("status").filter({ hasText: "符合筛选" })).toContainText("符合筛选 3 条");
    for (const term of ["验收保留 helper", "摘要查找词", "sharedHelper", "正文查找词"]) {
      await search.fill(term);
      await expect(panel.locator(".knowledge-card")).toHaveCount(1);
    }
    await search.fill("验收标签");
    await panel.getByText("筛选与排序", { exact: true }).click();
    await panel.getByRole("checkbox", { name: "约束", exact: true }).check();
    await panel.getByRole("checkbox", { name: "教程", exact: true }).check();
    await expect(panel.locator(".knowledge-card")).toHaveCount(2);
    await panel.getByLabel("筛选作用域").selectOption("personal");
    await expect(panel.locator(".knowledge-card")).toHaveCount(1);
    await expect(panel.locator(".knowledge-card-title")).toHaveText("验收运行测试");
    await panel.getByLabel("筛选作用域").selectOption("team");
    await panel.getByLabel("筛选状态").selectOption("reviewed");
    await panel.getByLabel("筛选作者").selectOption(headers["X-SimpleRCP-Member"]);
    await expect(panel.locator(".knowledge-card")).toHaveCount(1);
    await panel.getByRole("checkbox", { name: "约束", exact: true }).uncheck();
    await panel.getByRole("checkbox", { name: "教程", exact: true }).uncheck();
    await panel.getByLabel("知识排序").selectOption("type");
    await expect(panel.locator(".knowledge-card-title strong")).toHaveText(["验收保留 helper", "验收模块用途"]);
    await panel.getByLabel("筛选作用域").selectOption("");
    await panel.getByLabel("知识排序").selectOption("createdAt");
    await expect(panel.locator(".knowledge-card-title strong")).toHaveText(["验收模块用途", "验收运行测试", "验收保留 helper"]);
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByTestId("theme-toggle").click();
      await page.screenshot({ path: `${screenshotDirectory}/S6-UI-1-all-knowledge-${theme}.png` });
    }
    const target = panel.locator(`[data-card-id="${created[0]!.id}"]`);
    await target.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(editor.getByPlaceholder("标题", { exact: true })).toBeFocused();
    await editor.getByRole("button", { name: "清理正文中的证据块" }).click();
    await expect(editor.getByPlaceholder("正文 Markdown")).toHaveValue("## 规则\n保留 sharedHelper。");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const stored = await page.request.get(`/api/projects/demo/knowledge/cards/${created[0]!.id}`, { headers });
    expect((await stored.json()).card.content).toBe("## 规则\n保留 sharedHelper。");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await target.getByRole("button", { name: "复制链接", exact: true }).click();
    await expect(panel).toContainText("知识链接已复制");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`?knowledge=${created[0]!.id}`);
    await target.getByRole("button", { name: "查看锚点", exact: true }).click();
    await expect(target).toContainText("确认人：知识验收成员");
    await target.getByRole("button", { name: "归档", exact: true }).click();
    await panel.getByLabel("筛选状态").selectOption("archived");
    await expect(target).toContainText("已归档");
    await expect(target.getByRole("button", { name: "归档", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(panel.getByRole("searchbox")).toHaveValue("");
    await page.goto(copied);
    await expect(page.getByTestId("status-bar").or(page.getByTestId("join-project"))).toBeVisible();
    if (await page.getByTestId("join-project").isVisible()) await page.getByTestId("join-project").click();
    await expect(page.getByTestId("collab-tab-knowledge")).toHaveClass("active");
    await expect(page.locator(`[data-card-id="${created[0]!.id}"] .knowledge-card-content`)).toContainText("保留 sharedHelper。");
  });

  test("聊天选择模式没有改变消息位置，取消与创建后清除选择", async ({ page }) => {
    await openAs(page, "聊天验收成员");
    const headers = await memberHeaders(page);
    const response = await page.request.post("/api/projects/demo/chat", { headers, data: { text: "验收聊天 保留 sharedHelper，并运行测试。" } });
    expect(response.status()).toBe(200);
    const message = page.locator(".chat-message-member").filter({ hasText: "验收聊天 保留 sharedHelper" });
    await expect(message).toBeVisible();
    await expect(page.locator(".chat-knowledge-checkbox")).toHaveCount(0);
    const before = await message.locator("p").first().boundingBox();
    await page.getByRole("button", { name: "从中创建知识", exact: true }).click();
    await message.getByRole("checkbox").check();
    await expect(page.locator(".chat-knowledge-toolbar")).toContainText("已选 1 条");
    const after = await message.locator("p").first().boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.width).toBe(before?.width);
    await page.locator(".chat-knowledge-toolbar").getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator(".chat-knowledge-checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "从中创建知识", exact: true }).click();
    await message.getByRole("checkbox").check();
    await page.getByRole("button", { name: "从这些消息创建", exact: true }).click();
    await expect(page.getByTestId("knowledge-inbox")).toContainText("验收聊天 保留 sharedHelper");
    await page.getByTestId("collab-tab-chat").click();
    await expect(page.locator(".chat-knowledge-checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "从中创建知识", exact: true }).click();
    await expect(page.locator(".chat-knowledge-toolbar")).toContainText("已选 0 条");
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByTestId("theme-toggle").click();
      await page.screenshot({ path: `${screenshotDirectory}/S6-UI-4-chat-selection-${theme}.png` });
    }
  });

  test("重新确认草稿保留成员已经关联的锚点", async ({ page }) => {
    await openAs(page, "锚点确认成员");
    const headers = await memberHeaders(page);
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__simplercpEditors?.["src/hello.ts"]?.getModel() && window.__simplercpYjsSynced?.["src/hello.ts"]))).toBe(true);
    await page.evaluate(() => {
      const editor = window.__simplercpEditors!["src/hello.ts"]!;
      const model = editor.getModel()!;
      editor.executeEdits("knowledge-anchor-acceptance", [{ range: model.getFullModelRange(), text: `${model.getValue()}\n// 知识关联验收\n` }]);
    });
    await expect.poll(async () => {
      const response = await page.request.get("/api/projects/demo/workspace/file?path=src%2Fhello.ts", { headers });
      return String((await response.json()).content).includes("知识关联验收");
    }).toBe(true);
    for (const addSuggestion of [false, true]) {
      const message = await page.request.post("/api/projects/demo/chat", { headers, data: { text: `锚点确认验收 ${addSuggestion}：src/hello.ts 中保留共享 helper。` } });
      expect(message.status()).toBe(200);
      const captured = await page.request.post("/api/projects/demo/knowledge/from-chat", { headers, data: { messageIds: [(await message.json()).message.id] } });
      expect(captured.status()).toBe(201);
      const suggestionId = (await captured.json()).suggestion.id as string;
      const accepted = await page.request.post(`/api/projects/demo/knowledge/inbox/${suggestionId}/accept`, { headers, data: {} });
      expect(accepted.status()).toBe(200);
      const cardId = (await accepted.json()).card.id as string;
      const associated = await page.request.patch(`/api/projects/demo/knowledge/cards/${cardId}`, { headers, data: { title: "重新确认锚点验收", anchors: [{ file: "src/projectStatus.js", selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } }] } });
      expect(associated.status()).toBe(200);
      const existingAnchors = (await associated.json()).card.anchors;
      expect(existingAnchors).toHaveLength(1);
      for (const data of [{ anchors: [], retainAnchorIds: ["unknown-anchor"] }, { retainAnchorIds: [existingAnchors[0].anchorId] }]) {
        const invalid = await page.request.patch(`/api/projects/demo/knowledge/cards/${cardId}`, { headers, data });
        expect(invalid.status()).toBe(400);
      }
      await page.getByTestId("collab-tab-knowledge").click();
      await page.getByRole("button", { name: "全部知识", exact: true }).click();
      const card = page.locator(`[data-card-id="${cardId}"]`);
      await card.getByRole("button", { name: "编辑", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "知识卡片编辑器" });
      await expect(editor.locator(".knowledge-draft-evidence")).toBeVisible();
      await editor.getByRole("button", { name: "取消", exact: true }).click();
      await card.getByRole("button", { name: "编辑", exact: true }).click();
      await expect(editor.locator(".knowledge-draft-evidence")).toBeVisible();
      if (addSuggestion) await editor.locator(".knowledge-draft-evidence").getByRole("checkbox", { name: /src\/hello.ts:/ }).first().check();
      await editor.getByRole("button", { name: "确认并保存", exact: true }).click();
      await expect(editor).toBeHidden();
      const stored = await page.request.get(`/api/projects/demo/knowledge/cards/${cardId}`, { headers });
      expect(stored.status()).toBe(200);
      const saved = (await stored.json()).card;
      expect(saved.status).toBe("reviewed");
      expect(saved.anchors).toEqual(addSuggestion ? expect.arrayContaining(existingAnchors) : existingAnchors);
      if (addSuggestion) expect(saved.anchors).toEqual(expect.arrayContaining([expect.objectContaining({ file: { workspaceRelativePath: "src/hello.ts" } })]));
    }
  });

  test("建议失败后的重试保留原动作和合并目标", async ({ page }) => {
    await openAs(page, "重试验收成员");
    const headers = await memberHeaders(page);
    const targets: string[] = [];
    for (const title of ["重试原目标", "重试其他目标"]) {
      const created = await page.request.post("/api/projects/demo/knowledge/cards", { headers, data: { type: "context", title, summary: title, content: "保留共享 helper。", scope: "team", tags: [] } });
      expect(created.status()).toBe(201);
      targets.push((await created.json()).card.id);
    }
    const message = await page.request.post("/api/projects/demo/chat", { headers, data: { text: "重试验收：保留共享 helper。" } });
    expect(message.status()).toBe(200);
    const captured = await page.request.post("/api/projects/demo/knowledge/from-chat", { headers, data: { messageIds: [(await message.json()).message.id] } });
    expect(captured.status()).toBe(201);
    const suggestionId = (await captured.json()).suggestion.id as string;
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "待处理", exact: true }).click();
    const selector = page.getByLabel("合并到已有卡片");
    await selector.selectOption(targets[0]!);
    const archived = await page.request.post(`/api/projects/demo/knowledge/cards/${targets[0]}/archive`, { headers, data: {} });
    expect(archived.status()).toBe(200);
    await expect(selector.locator(`option[value="${targets[0]}"]`)).toHaveCount(0);
    const suggestion = page.getByTestId("suggestion-chat.dense").filter({ hasText: "重试验收：" });
    await suggestion.getByRole("button", { name: "合并到已有卡片", exact: true }).click();
    await expect(suggestion.getByRole("alert")).toContainText("Reviewed knowledge card not found");
    await selector.selectOption(targets[1]!);
    const retried = page.waitForResponse(response => response.url().endsWith(`/knowledge/inbox/${suggestionId}/merge`) && response.request().method() === "POST");
    await suggestion.getByRole("button", { name: "重试", exact: true }).click();
    const response = await retried;
    expect(response.request().postDataJSON()).toEqual({ cardId: targets[0] });
    expect(response.status()).toBe(404);
    await expect(suggestion.getByRole("alert")).toContainText("Reviewed knowledge card not found");
    await expect(page.getByRole("dialog", { name: "知识卡片编辑器" })).toHaveCount(0);
    const stored = await page.request.get(`/api/projects/demo/knowledge/cards/${targets[1]}`, { headers });
    expect((await stored.json()).card.usage?.recurrenceCount ?? 0).toBe(0);
  });

  test("切换标签保留编辑内容，卡片详情显示已建立的关系", async ({ page }) => {
    await openAs(page, "关系验收成员");
    const headers = await memberHeaders(page);
    const ids: string[] = [];
    for (const title of ["关系验收甲", "关系验收乙"]) {
      const response = await page.request.post("/api/projects/demo/knowledge/cards", { headers, data: { type: "constraint", title, summary: "核对共享 helper", content: "保留共享 helper。", scope: "team", tags: [] } });
      expect(response.status()).toBe(201);
      ids.push((await response.json()).card.id);
    }
    const related = await page.request.post(`/api/projects/demo/knowledge/cards/${ids[0]}/relations`, { headers, data: { kind: "contradicts", cardId: ids[1] } });
    expect(related.status()).toBe(200);
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "全部知识", exact: true }).click();
    const card = page.locator(`[data-card-id="${ids[0]}"]`);
    await card.getByRole("button", { name: "查看锚点", exact: true }).click();
    const relations = card.getByRole("region", { name: "已建立的知识关系" });
    await expect(relations).toContainText("存在矛盾，尚未裁决");
    await expect(relations).toContainText("关系验收乙");
    await card.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "知识卡片编辑器" });
    await editor.getByPlaceholder("标题", { exact: true }).fill("关系验收修改标题");
    await editor.getByPlaceholder("正文 Markdown").fill("使用共享 helper，执行项目测试。");
    await page.getByTestId("collab-tab-chat").click();
    await expect(editor).toBeHidden();
    await page.getByTestId("collab-tab-knowledge").click();
    await expect(editor.getByPlaceholder("标题", { exact: true })).toHaveValue("关系验收修改标题");
    await expect(editor.getByPlaceholder("正文 Markdown")).toHaveValue("使用共享 helper，执行项目测试。");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    await relations.getByRole("button", { name: "关系验收乙", exact: true }).click();
    await expect(page.locator(`[data-card-id="${ids[1]}"] .knowledge-card-content`)).toBeVisible();
    const stored = await page.request.get(`/api/projects/demo/knowledge/cards/${ids[0]}`, { headers });
    expect((await stored.json()).card).toMatchObject({ title: "关系验收修改标题", content: "使用共享 helper，执行项目测试。" });
  });

  test("时间线在切换文件时清除单张卡片筛选", async ({ page }) => {
    await openAs(page, "时间线切换成员");
    const headers = await memberHeaders(page);
    const ids: string[] = [];
    for (const [file, title] of [["src/hello.ts", "时间线文件甲"], ["src/projectStatus.js", "时间线文件乙"]]) {
      const response = await page.request.post("/api/projects/demo/knowledge/cards", { headers, data: { type: "context", title, summary: title, content: "说明模块用途。", scope: "team", tags: [], anchors: [{ file, selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } }] } });
      expect(response.status()).toBe(201);
      ids.push((await response.json()).card.id);
    }
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/hello.ts").click();
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "时间线", exact: true }).click();
    const selector = page.getByLabel("时间线卡片");
    await selector.selectOption(ids[0]!);
    await expect(page.getByTestId("knowledge-content-timeline")).toContainText("时间线文件甲");
    await page.getByTestId("file-src/projectStatus.js").click();
    await expect(selector).toHaveValue("");
    await expect(page.getByTestId("knowledge-content-timeline")).toContainText("时间线文件乙");
  });

  test("待处理合计建议和升级未读，暂不确认后可重新查看并确认", async ({ browser }) => {
    const owner = await browser.newPage(); const reviewer = await browser.newPage();
    await openAs(owner, "升级申请成员"); await openAs(reviewer, "升级审核成员");
    const ownerHeaders = await memberHeaders(owner); const reviewerHeaders = await memberHeaders(reviewer);
    const response = await owner.request.post("/api/projects/demo/knowledge/cards", { headers: ownerHeaders, data: { type: "constraint", title: "验收团队升级", summary: "保留共享 helper", content: "保留 sharedHelper。", scope: "personal", tags: [] } });
    expect(response.status()).toBe(201);
    const id = (await response.json()).card.id as string;
    const requested = await owner.request.post(`/api/projects/demo/knowledge/cards/${id}/scope/request-team`, { headers: ownerHeaders, data: {} });
    expect(requested.status()).toBe(200);
    const message = await reviewer.request.post("/api/projects/demo/chat", { headers: reviewerHeaders, data: { text: "验收未读建议 请保留 sharedHelper。" } });
    const captured = await reviewer.request.post("/api/projects/demo/knowledge/from-chat", { headers: reviewerHeaders, data: { messageIds: [(await message.json()).message.id] } });
    expect(captured.status()).toBe(201);
    await expect(reviewer.getByTestId("knowledge-unread")).toHaveText("2");
    await reviewer.getByTestId("collab-tab-knowledge").click();
    await reviewer.getByRole("button", { name: "待处理", exact: true }).click();
    await expect(reviewer.getByTestId("knowledge-inbox")).toContainText("知识建议");
    await expect(reviewer.getByTestId("knowledge-inbox")).toContainText("待确认升级");
    await expect(reviewer.getByTestId("knowledge-unread")).toHaveCount(0);
    const card = reviewer.locator(`[data-card-id="${id}"]`);
    await card.getByRole("button", { name: "查看锚点", exact: true }).click();
    await card.getByRole("button", { name: "暂不确认", exact: true }).click();
    await expect(card).toHaveCount(0);
    await reviewer.getByTestId("collab-tab-chat").click();
    await reviewer.getByTestId("collab-tab-knowledge").click();
    await reviewer.getByRole("button", { name: "待处理", exact: true }).click();
    await expect(card).toHaveCount(0);
    await reviewer.getByRole("checkbox", { name: "显示暂不确认的申请", exact: true }).check();
    await expect(card.locator(".knowledge-card-content")).toBeVisible();
    await card.getByRole("button", { name: "确认升级为团队卡片", exact: true }).click();
    await expect(card).toHaveCount(0);
    await reviewer.getByRole("button", { name: "全部知识", exact: true }).click();
    await expect(card).toContainText("团队");
    await expect(card).toContainText("升级审核成员");
    await reviewer.getByRole("button", { name: "待处理", exact: true }).click();
    await reviewer.getByRole("button", { name: "新建卡片", exact: true }).click();
    const editor = reviewer.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(editor).toBeVisible();
    const additionalMessage = await reviewer.request.post("/api/projects/demo/chat", { headers: reviewerHeaders, data: { text: "编辑器期间的新建议：使用 sharedHelper。" } });
    expect(additionalMessage.status()).toBe(200);
    const additional = await reviewer.request.post("/api/projects/demo/knowledge/from-chat", { headers: reviewerHeaders, data: { messageIds: [(await additionalMessage.json()).message.id] } });
    expect(additional.status()).toBe(201);
    await expect(reviewer.getByTestId("knowledge-unread")).toHaveText("1");
    await reviewer.getByTestId("collab-tab-chat").click();
    await expect(reviewer.getByTestId("knowledge-unread")).toHaveText("1");
    await reviewer.getByTestId("collab-tab-knowledge").click();
    await expect(editor).toBeVisible();
    await expect(reviewer.getByTestId("knowledge-unread")).toHaveText("1");
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await expect(reviewer.getByTestId("knowledge-inbox")).toContainText("编辑器期间的新建议");
    await expect(reviewer.getByTestId("knowledge-unread")).toHaveCount(0);
    await owner.close(); await reviewer.close();
  });

  test("AI 草稿实际请求期间显示加载状态并禁用同条建议操作", async ({ page }) => {
    test.setTimeout(180_000);
    await openAs(page, "草稿验收成员");
    const headers = await memberHeaders(page);
    const messageResponse = await page.request.post("/api/projects/demo/chat", { headers, data: { text: "验收草稿 src/hello.ts 应保留 sharedHelper，完成修改后运行测试。" } });
    expect(messageResponse.status()).toBe(200);
    const captured = await page.request.post("/api/projects/demo/knowledge/from-chat", { headers, data: { messageIds: [(await messageResponse.json()).message.id] } });
    expect(captured.status()).toBe(201);
    const id = (await captured.json()).suggestion.id as string;
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "待处理", exact: true }).click();
    const suggestion = page.getByTestId("suggestion-chat.dense").filter({ hasText: "验收草稿 src/hello.ts" });
    await expect(suggestion).toBeVisible();
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByTestId("theme-toggle").click();
      await page.screenshot({ path: `${screenshotDirectory}/S6-UI-6-pending-${theme}.png` });
    }
    const observed = page.evaluate(suggestionId => new Promise<{ loading: boolean; disabled: boolean; progress: string }>(resolve => {
      const element = [...document.querySelectorAll<HTMLElement>('[data-testid="suggestion-chat.dense"]')].find(item => item.querySelector("pre")?.textContent?.includes("验收草稿 src/hello.ts"));
      if (!element) throw new Error(`Suggestion ${suggestionId} is missing`);
      const observer = new MutationObserver(() => {
        if (element.getAttribute("aria-busy") !== "true") return;
        observer.disconnect();
        const controls = [...element.querySelectorAll<HTMLButtonElement>(".knowledge-actions button")];
        resolve({ loading: controls.some(button => button.textContent?.includes("生成中")), disabled: controls.every(button => button.disabled), progress: element.querySelector('[role="status"]')?.textContent ?? "" });
      });
      observer.observe(element, { attributes: true, childList: true, subtree: true });
    }), id);
    const generated = page.waitForResponse(response => response.url().endsWith(`/knowledge/inbox/${id}/ai-draft`) && response.request().method() === "POST", { timeout: 160_000 });
    await suggestion.getByRole("button", { name: "AI 草稿", exact: true }).click();
    expect(await observed).toEqual({ loading: true, disabled: true, progress: "正在根据证据生成草稿…" });
    await page.getByTestId("collab-tab-chat").click();
    await expect(page.getByTestId("knowledge-panel")).toBeHidden();
    expect((await generated).status()).toBe(200);
    await page.getByTestId("collab-tab-knowledge").click();
    const editor = page.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(editor).toBeVisible({ timeout: 160_000 });
    await expect(editor).toContainText("草案已生成，请核对后确认");
    await expect(editor.getByPlaceholder("标题", { exact: true })).toBeFocused();
    await expect(editor.getByPlaceholder("正文 Markdown")).not.toHaveValue(/## Evidence|"chatMessages"/);
    await editor.getByRole("button", { name: "取消", exact: true }).click();
  });

  test("导览内容区独立滚动且外层保持位置", async ({ page }) => {
    await openAs(page, "Guide reviewer");
    const headers = await memberHeaders(page);
    for (let index = 0; index < 18; index++) {
      const response = await page.request.post("/api/projects/demo/knowledge/cards", { headers, data: {
        type: "tutorial", title: `阅读示例 ${index}`, summary: "了解当前模块的处理过程", content: "阅读代码并核对测试。", scope: "team", tags: ["阅读"]
      } });
      expect(response.status()).toBe(201);
    }
    await page.getByTestId("collab-tab-knowledge").click();
    await page.getByRole("button", { name: "导览", exact: true }).click();
    const list = page.getByTestId("knowledge-content-guide");
    await expect(list.locator(".knowledge-card").filter({ hasText: "阅读示例" })).toHaveCount(18);
    const geometry = await list.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
    expect(geometry.content).toBeGreaterThan(geometry.height);
    await list.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator(".collab-tab-body").evaluate(element => element.scrollTop)).toBe(0);
    await list.evaluate(element => { element.scrollTop = 0; });
    for (const theme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByTestId("theme-toggle").click();
      await page.screenshot({ path: `${screenshotDirectory}/S6-UI-3-guide-${theme}.png` });
    }
  });
});

test.describe("knowledge stage 3", () => {
  test.skip((process.env.KNOWLEDGE ?? "off") === "off", "Knowledge scenarios use test:e2e:knowledge");
  test("双方改写建议进入待处理，接受与确认生成团队知识", async ({ browser }) => {
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
      await page.getByRole("button", { name: "待处理", exact: true }).click();
      await expect(page.getByTestId("suggestion-edit.overwritten").first()).toBeVisible();
      await expect(page.getByTestId("knowledge-unread")).toHaveCount(0);
    }
    await first.screenshot({ path: `${screenshotDirectory}/S3-1-overwrite-inbox-ada.png` });
    const suggestion = second.getByTestId("suggestion-edit.overwritten").first();
    await suggestion.getByRole("button", { name: "接受", exact: true }).click();
    const editor = second.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(editor).toBeVisible(); await expect(editor).toContainText("原始证据");
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await first.getByRole("button", { name: "全部知识", exact: true }).click();
    await first.locator(".knowledge-card-summary").filter({ hasText: "成员改写了协作者的内容" }).first().click();
    await first.getByRole("button", { name: "确认", exact: true }).click();
    const reviewer = first.getByRole("dialog", { name: "知识卡片编辑器" });
    await expect(reviewer).toContainText("原始证据");
    await reviewer.getByPlaceholder("标题", { exact: true }).fill("S3 confirmed collaboration decision");
    await reviewer.getByPlaceholder("摘要", { exact: true }).fill("Use captureChosen as the agreed shared result.");
    await reviewer.getByRole("button", { name: "确认并保存" }).click();
    await expect(reviewer).not.toBeVisible();
    await expect(first.getByTestId("knowledge-panel")).toContainText("S3 confirmed collaboration decision");
    await second.getByRole("button", { name: "全部知识", exact: true }).click();
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
    await expect(page.getByRole("checkbox", { name: /选择消息/ })).toHaveCount(0);
    await page.getByRole("button", { name: "从中创建知识", exact: true }).click();
    await page.getByRole("checkbox", { name: /选择消息 Chat author S3 chat/ }).check();
    await page.getByRole("button", { name: "从这些消息创建", exact: true }).click();
    await page.getByRole("button", { name: "待处理", exact: true }).click();
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
    await first.getByRole("button", { name: "待处理", exact: true }).click();
    await second.getByRole("button", { name: "待处理", exact: true }).click();
    await expect(first.getByTestId("knowledge-inbox")).toContainText("成员在 src/hello.ts 上改写了 Agent 的内容");
    await expect(second.getByTestId("knowledge-inbox")).toContainText("成员在 src/hello.ts 上改写了 Agent 的内容");
    await first.screenshot({ path: `${screenshotDirectory}/S5-1-agent-revised-inbox-ada.png` });
    await second.screenshot({ path: `${screenshotDirectory}/S5-1-agent-revised-inbox-bob.png` });
    await first.close();
    await second.close();
  });
});
