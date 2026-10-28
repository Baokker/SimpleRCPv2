async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/requestPolicy.js").click();
    await member.getByTestId("collab-tab-chat").click();
  }
  const messages = [
    "requestPolicy.js 的 requestTimeoutMs 目前返回 3000 毫秒，外部通知接口在高峰时经常超过这个时间。",
    "我看到第三方接口通常需要四秒，建议把请求超时统一设为 5000 毫秒。",
    "5000 毫秒可以接受。重试次数需要一起确认，避免长时间等待。",
    "canRetry 继续限制三次，单次超时统一使用 requestTimeoutMs，不在调用处另写数字。",
    "调用处保持一个共同入口，后续调整超时时间就只需要修改这个函数。",
    "同意。日志也记录毫秒，避免有人把 5000 当成秒。",
    "函数名使用 Ms 后缀，参数名 delayMs 也保留相同约定。",
    "retryPolicy.js 里已有 waitForRetry，可以让多个发送流程复用。",
    "这个 helper 要保留，新增功能时不要删除已有导出。",
    "我会检查现有调用是否仍然可以传入 delayMs，兼容当前参数。",
    "今天确认的规则是：请求超时 5000 毫秒，最多三次重试，复用现有 helper。",
    "确认。把这些背景记录下来，之后其他成员和 Agent 修改时都能查到原因。"
  ];
  for (let i = 0; i < messages.length; i++) {
    const member = i % 2 ? bob : alice;
    await member.getByTestId("chat-input").fill(messages[i]);
    await member.getByTestId("send-chat").click();
  }
  await alice.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 2, startColumn: 10, endLineNumber: 2, endColumn: 14 }, text: "5000" }]);
    editor.focus();
  });
  await bob.waitForFunction(() => window.__simplercpEditors["src/requestPolicy.js"].getModel().getValue().includes("5000"));
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 6, startColumn: 17, endLineNumber: 6, endColumn: 18 }, text: "4" }]);
    editor.focus();
  });
  await alice.waitForFunction(() => window.__simplercpEditors["src/requestPolicy.js"].getModel().getValue().includes("attempt < 4"));
  await alice.screenshot({ path: root + "03-discussion-alice.png" });
  await bob.screenshot({ path: root + "03-discussion-bob.png" });
  await alice.getByTestId("file-AGENTS.md").click();
  await alice.getByTestId("collab-tab-knowledge").click();
  await alice.getByRole("button", { name: "知识更多操作" }).click();
  await alice.getByRole("button", { name: "导入规范文档", exact: true }).click();
  const panel = alice.getByTestId("knowledge-import");
  await panel.getByLabel("规范文档路径").fill("AGENTS.md");
  const imported = alice.waitForResponse(r => r.url().endsWith("/knowledge/import") && r.request().method() === "POST", { timeout: 180000 });
  await panel.getByRole("button", { name: "生成导入草稿", exact: true }).click();
  await alice.screenshot({ path: root + "04-import-loading-alice.png" });
  await bob.screenshot({ path: root + "04-import-loading-bob.png" });
  const response = await imported;
  if (response.status() !== 201) throw new Error(await response.text());
  const result = await response.json();
  await panel.locator("textarea[aria-label^='导入草稿']").first().waitFor();
  await alice.screenshot({ path: root + "05-import-drafts-alice.png" });
  await bob.getByTestId("file-AGENTS.md").click();
  await bob.getByTestId("collab-tab-knowledge").click();
  await bob.getByRole("button", { name: "待处理", exact: true }).click();
  await bob.getByRole("checkbox", { name: "查看所有成员的建议" }).check();
  await bob.screenshot({ path: root + "05-import-drafts-bob.png" });
  return { synced: true, messages: messages.length, imported: result, draftCount: await panel.locator("textarea[aria-label^='导入草稿']").count() };
}
