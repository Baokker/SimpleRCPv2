async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  await alice.getByTestId("collab-tab-knowledge").click();
  await alice.getByRole("button", { name: "知识更多操作" }).click();
  const generated = alice.waitForResponse(r => r.url().endsWith("/knowledge/demo") && r.request().method() === "POST");
  await alice.getByRole("button", { name: "生成示例卡片", exact: true }).click();
  const response = await generated;
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/projectStatus.js").click();
    await member.getByTestId("collab-tab-knowledge").click();
    await member.getByRole("button", { name: "知识卡片", exact: true }).click();
    await member.getByRole("searchbox", { name: "搜索知识" }).fill("");
    await member.getByLabel("筛选范围").selectOption("current");
    await member.getByLabel("知识排序").selectOption("reading");
    await member.locator(".knowledge-card").filter({ hasText: "阅读任务状态代码" }).waitFor();
  }
  await alice.screenshot({ path: root + "18-knowledge-reading-alice.png" });
  await bob.screenshot({ path: root + "18-knowledge-reading-bob.png" });
  const entry = alice.locator(".knowledge-card").filter({ hasText: "阅读任务状态代码" }).first();
  await entry.locator(".knowledge-card-summary").click();
  await entry.getByText("来源", { exact: true }).click();
  await alice.screenshot({ path: root + "19-knowledge-detail-alice.png" });
  await bob.screenshot({ path: root + "19-knowledge-detail-bob.png" });
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/projectStatus.js"];
    editor.setPosition({ lineNumber: 2, column: 5 });
    editor.focus();
    editor.trigger("knowledge-demo", "editor.action.showHover", {});
  });
  await bob.locator(".monaco-hover").filter({ hasText: "集中计算任务状态" }).waitFor();
  await alice.screenshot({ path: root + "20-inline-knowledge-alice.png" });
  await bob.screenshot({ path: root + "20-inline-knowledge-bob.png" });
  return { generated: result, hover: await bob.locator(".monaco-hover").filter({ hasText: "集中计算任务状态" }).innerText() };
}
