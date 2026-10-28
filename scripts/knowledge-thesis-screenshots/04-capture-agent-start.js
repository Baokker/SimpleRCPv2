async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  const importPanel = alice.getByTestId("knowledge-import");
  if (await importPanel.isVisible()) {
    while (await importPanel.locator("details[open]").count()) await importPanel.locator("details[open]").first().locator("summary").click();
    await alice.screenshot({ path: root + "06-import-overview-alice.png" });
    await bob.screenshot({ path: root + "06-import-overview-bob.png" });
    await alice.getByRole("button", { name: "知识更多操作" }).click();
    await alice.getByRole("button", { name: "导入规范文档", exact: true }).click();
  }
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/requestPolicy.js").click();
    await member.getByTestId("collab-tab-knowledge").click();
    await member.getByRole("button", { name: "待处理", exact: true }).click();
  }
  const dense = alice.getByTestId("suggestion-chat.dense").last();
  await dense.waitFor({ timeout: 90000 });
  await dense.scrollIntoViewIfNeeded();
  await dense.locator("summary").filter({ hasText: "原始证据" }).click();
  await bob.getByTestId("collab-tab-chat").click();
  await alice.screenshot({ path: root + "07-discussion-capture-alice.png" });
  await bob.screenshot({ path: root + "07-discussion-capture-bob.png" });
  await dense.locator("summary").filter({ hasText: "原始证据" }).click();
  for (const member of [alice, bob]) await member.getByTestId("file-src/backoffPolicy.js").click();
  await alice.getByRole("checkbox", { name: "查看所有成员的建议" }).check();
  const magic = alice.getByTestId("suggestion-magicNumber.added").filter({ hasText: "backoffPolicy.js" }).first();
  await magic.waitFor({ timeout: 45000 });
  await magic.scrollIntoViewIfNeeded();
  await magic.locator("summary").filter({ hasText: "原始证据" }).click();
  await alice.screenshot({ path: root + "08-magic-number-alice.png" });
  await bob.getByTestId("collab-tab-knowledge").click();
  await bob.getByRole("button", { name: "待处理", exact: true }).click();
  await bob.getByTestId("suggestion-chat.dense").last().scrollIntoViewIfNeeded();
  await bob.screenshot({ path: root + "08-magic-number-bob.png" });
  const captures = await alice.evaluate(async () => {
    const response = await fetch("/api/projects/demo/knowledge/inbox", { headers: { "X-SimpleRCP-Member": sessionStorage.getItem("simplercp.memberId.demo") } });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  for (const member of [alice, bob]) await member.getByTestId("file-src/retryPolicy.js").click();
  await alice.getByTestId("collab-tab-agent").click();
  await bob.getByTestId("collab-tab-chat").click();
  const prompt = "请为 src/retryPolicy.js 的 retryNotification 增加可选的第三个参数 onAttempt，等待后调用 onAttempt?.()，然后调用 send。等待写在 retryNotification 内，直接使用 new Promise 和 setTimeout(resolve, delayMs)。保留导出的 waitForRetry，保留 delayMs 默认值，不修改其他业务文件。运行 npm test，并说明修改。";
  await alice.getByTestId("agent-prompt").fill(prompt);
  const started = alice.waitForResponse(r => r.url().endsWith("/agent/runs") && r.request().method() === "POST", { timeout: 30000 });
  await alice.getByTestId("agent-run-submit").click();
  const response = await started;
  if (!response.ok()) throw new Error(await response.text());
  const run = await response.json();
  await alice.screenshot({ path: root + "09-agent-start-alice.png" });
  await bob.screenshot({ path: root + "09-agent-start-bob.png" });
  return { captures, run };
}
