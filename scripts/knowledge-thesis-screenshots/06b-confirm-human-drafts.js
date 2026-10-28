async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  const editor = alice.getByRole("dialog", { name: "知识卡片编辑器" });
  await editor.waitFor();
  const denseTitle = await editor.getByPlaceholder("标题", { exact: true }).inputValue();
  await alice.screenshot({ path: root + "12-discussion-draft-alice.png" });
  await bob.screenshot({ path: root + "12-discussion-draft-bob.png" });
  await editor.getByRole("button", { name: "确认并保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  for (const member of [alice, bob]) await member.getByTestId("file-src/backoffPolicy.js").click();
  await alice.getByRole("button", { name: "待处理", exact: true }).click();
  const suggestion = alice.getByTestId("suggestion-magicNumber.added").filter({ hasText: "backoffPolicy.js" }).last();
  await suggestion.scrollIntoViewIfNeeded();
  const generated = alice.waitForResponse(r => r.url().includes("/knowledge/inbox/") && r.url().endsWith("/ai-draft") && r.request().method() === "POST", { timeout: 180000 });
  await suggestion.getByRole("button", { name: "AI 草稿", exact: true }).click();
  const response = await generated;
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  await editor.waitFor();
  await alice.screenshot({ path: root + "13-magic-number-draft-alice.png" });
  await bob.screenshot({ path: root + "13-magic-number-draft-bob.png" });
  await editor.getByRole("button", { name: "确认并保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  return { denseTitle, magic: result };
}
