async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  await bob.getByTestId("file-src/requestPolicy.js").click();
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: editor.getModel().getLineMaxColumn(6) }, text: "  return attempt < 3;" }]);
  });
  const scenarios = [
    { query: "requestPolicy.js request timeout", title: "Request timeouts use milliseconds and one shared setting", file: "src/requestPolicy.js", image: "12-discussion-draft", content: "requestTimeoutMs returns 5000 ms, and callers read the timeout through this function. canRetry allows at most three retries. Time fields use the Ms suffix. New send features reuse waitForRetry(delayMs) and keep the existing exports and configurable parameters." },
    { query: "backoffDelayMs() now", title: "Record the unit and reason when adjusting backoffDelayMs", file: "src/backoffPolicy.js", image: "13-magic-number-draft", content: "backoffDelayMs in src/backoffPolicy.js changed from 50 to 1500. The function uses milliseconds. Record the scenario and the reason for later adjustments, and check the wait time of callers. The evidence does not state the business reason for 1500, so add it before confirming the value." }
  ];
  for (const scenario of scenarios) {
    for (const member of [alice, bob]) await member.getByTestId(`file-${scenario.file}`).click();
    await alice.getByTestId("collab-tab-knowledge").click();
    await alice.getByRole("button", { name: "Cards", exact: true }).click();
    await alice.getByLabel("Filter range").selectOption("all");
    await alice.getByRole("searchbox", { name: "Search knowledge" }).fill(scenario.query);
    const card = alice.locator(".knowledge-card").filter({ hasText: scenario.query }).first();
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = alice.getByRole("dialog", { name: "Knowledge card editor" });
    await editor.getByPlaceholder("Title", { exact: true }).fill(scenario.title);
    await editor.getByPlaceholder("Body (Markdown)").fill(scenario.content);
    await editor.getByLabel("Applicability", { exact: true }).selectOption("file");
    await editor.getByLabel("Applicable file").fill(scenario.file);
    await editor.getByText("More fields", { exact: true }).click();
    await editor.getByPlaceholder("Leave empty to use the first sentence of the body", { exact: true }).fill(scenario.content.split(". ")[0] + ".");
    await editor.getByText("More fields", { exact: true }).click();
    await bob.getByTestId("collab-tab-chat").click();
    await alice.screenshot({ path: root + scenario.image + "-alice.png" });
    await bob.screenshot({ path: root + scenario.image + "-bob.png" });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  }
  return scenarios.map(({ title, file }) => ({ title, file }));
}
