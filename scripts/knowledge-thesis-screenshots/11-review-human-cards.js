async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  await bob.getByTestId("file-src/requestPolicy.js").click();
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: editor.getModel().getLineMaxColumn(6) }, text: "  return attempt < 3;" }]);
  });
  const scenarios = [
    { query: "requestPolicy.js 请求超时", title: "请求超时使用毫秒并集中配置", file: "src/requestPolicy.js", image: "12-discussion-draft", content: "requestTimeoutMs 返回 5000 毫秒；调用处通过该函数读取超时配置。canRetry 最多允许三次重试。时间字段使用 Ms 后缀。新增发送功能复用 waitForRetry(delayMs)，保留已有导出与可配置参数。" },
    { query: "backoffDelayMs() now", title: "调整 backoffDelayMs 时记录数值单位与原因", file: "src/backoffPolicy.js", image: "13-magic-number-draft", content: "src/backoffPolicy.js 的 backoffDelayMs 从 50 调整为 1500。该函数使用毫秒单位。后续调整时记录适用场景与调整原因，并核对调用方的等待时间。当前证据未说明选择 1500 的业务原因，确认具体数值前应补充说明。" }
  ];
  for (const scenario of scenarios) {
    for (const member of [alice, bob]) await member.getByTestId(`file-${scenario.file}`).click();
    await alice.getByTestId("collab-tab-knowledge").click();
    await alice.getByRole("button", { name: "知识卡片", exact: true }).click();
    await alice.getByLabel("筛选范围").selectOption("all");
    await alice.getByRole("searchbox", { name: "搜索知识" }).fill(scenario.query);
    const card = alice.locator(".knowledge-card").filter({ hasText: scenario.query }).first();
    await card.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = alice.getByRole("dialog", { name: "知识卡片编辑器" });
    await editor.getByPlaceholder("标题", { exact: true }).fill(scenario.title);
    await editor.getByPlaceholder("正文 Markdown").fill(scenario.content);
    await editor.getByLabel("适用范围", { exact: true }).selectOption("file");
    await editor.getByLabel("适用文件").fill(scenario.file);
    await editor.getByText("更多字段", { exact: true }).click();
    await editor.getByPlaceholder("留空使用内容第一句", { exact: true }).fill(scenario.content.split("。")[0] + "。");
    await editor.getByText("更多字段", { exact: true }).click();
    await bob.getByTestId("collab-tab-chat").click();
    await alice.screenshot({ path: root + scenario.image + "-alice.png" });
    await bob.screenshot({ path: root + scenario.image + "-bob.png" });
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  }
  return scenarios.map(({ title, file }) => ({ title, file }));
}
