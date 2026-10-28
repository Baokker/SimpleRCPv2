async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  const results = [];
  for (const scenario of [{ trigger: "chat.dense", file: "src/requestPolicy.js", image: "12-discussion-draft" }, { trigger: "magicNumber.added", file: "src/backoffPolicy.js", image: "13-magic-number-draft" }]) {
    for (const member of [alice, bob]) await member.getByTestId(`file-${scenario.file}`).click();
    await alice.getByTestId("collab-tab-knowledge").click();
    await alice.getByRole("button", { name: "待处理", exact: true }).click();
    await alice.getByRole("checkbox", { name: "查看所有成员的建议" }).check();
    const suggestion = alice.getByTestId(`suggestion-${scenario.trigger}`).filter(scenario.trigger === "magicNumber.added" ? { hasText: "backoffPolicy.js" } : {}).last();
    await suggestion.scrollIntoViewIfNeeded();
    const generated = alice.waitForResponse(r => r.url().includes("/knowledge/suggestions/") && r.request().method() === "POST", { timeout: 180000 });
    await suggestion.getByRole("button", { name: "AI 草稿", exact: true }).click();
    await bob.getByTestId("collab-tab-chat").click();
    const response = await generated;
    if (!response.ok()) throw new Error(await response.text());
    const result = await response.json();
    const editor = alice.getByRole("dialog", { name: "知识卡片编辑器" });
    await editor.waitFor();
    await alice.screenshot({ path: root + scenario.image + "-alice.png" });
    await bob.screenshot({ path: root + scenario.image + "-bob.png" });
    await editor.getByRole("button", { name: "确认并保存", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    results.push({ trigger: scenario.trigger, cardId: result.card.id, title: result.card.title, content: result.card.content, ai: result.suggestion.ai });
  }
  return results;
}
