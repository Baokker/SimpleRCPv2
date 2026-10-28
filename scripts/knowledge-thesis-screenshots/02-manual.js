async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) {
    await member.getByTestId("file-README.md").click();
    await member.getByTestId("collab-tab-knowledge").click();
  }
  await alice.getByRole("button", { name: "新建", exact: true }).click();
  const editor = alice.getByRole("dialog", { name: "知识卡片编辑器" });
  await editor.getByLabel("卡片类型").selectOption("constraint");
  await editor.getByPlaceholder("标题", { exact: true }).fill("README 面向外部成员，统一使用英文");
  await editor.getByPlaceholder("正文 Markdown").fill("README 的标题、说明和操作指引统一使用英文。代码标识符保持原样，便于外部贡献者直接阅读和执行。");
  await editor.getByLabel("适用范围", { exact: true }).selectOption("file");
  await editor.getByLabel("适用文件").fill("README.md");
  await alice.screenshot({ path: root + "01-manual-form-alice.png" });
  await bob.screenshot({ path: root + "01-manual-form-bob.png" });
  const saved = alice.waitForResponse(response => response.url().endsWith("/knowledge/cards") && response.request().method() === "POST");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  const response = await saved;
  if (response.status() !== 201) throw new Error(await response.text());
  const { card } = await response.json();
  for (const member of [alice, bob]) {
    await member.getByRole("button", { name: "知识卡片", exact: true }).click();
    await member.getByLabel("筛选范围").selectOption("all");
    const entry = member.locator(`[data-card-id="${card.id}"]`);
    await entry.waitFor();
    await entry.locator(".knowledge-card-summary").click();
    await entry.getByText("来源", { exact: true }).click();
  }
  await alice.screenshot({ path: root + "02-manual-saved-alice.png" });
  await bob.screenshot({ path: root + "02-manual-saved-bob.png" });
  return { cardId: card.id, status: card.status, scope: card.scope, origin: card.provenance.origin, anchors: card.anchors };
}
