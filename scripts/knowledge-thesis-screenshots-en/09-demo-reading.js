async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  await alice.getByTestId("collab-tab-knowledge").click();
  await alice.getByRole("button", { name: "More knowledge actions" }).click();
  const generated = alice.waitForResponse(r => r.url().endsWith("/knowledge/demo") && r.request().method() === "POST");
  await alice.getByRole("button", { name: "Generate sample cards", exact: true }).click();
  const response = await generated;
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/projectStatus.js").click();
    await member.getByTestId("collab-tab-knowledge").click();
    await member.getByRole("button", { name: "Cards", exact: true }).click();
    await member.getByRole("searchbox", { name: "Search knowledge" }).fill("");
    await member.getByLabel("Filter range").selectOption("current");
    await member.getByLabel("Sort knowledge").selectOption("reading");
    await member.locator(".knowledge-card").filter({ hasText: "Reading the task status code" }).waitFor();
  }
  await alice.screenshot({ path: root + "18-knowledge-reading-alice.png" });
  await bob.screenshot({ path: root + "18-knowledge-reading-bob.png" });
  const entry = alice.locator(".knowledge-card").filter({ hasText: "Reading the task status code" }).first();
  await entry.locator(".knowledge-card-summary").click();
  await entry.getByText("Source", { exact: true }).click();
  await alice.screenshot({ path: root + "19-knowledge-detail-alice.png" });
  await bob.screenshot({ path: root + "19-knowledge-detail-bob.png" });
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/projectStatus.js"];
    editor.setPosition({ lineNumber: 2, column: 5 });
    editor.focus();
    editor.trigger("knowledge-demo", "editor.action.showHover", {});
  });
  await bob.locator(".monaco-hover").filter({ hasText: "Status computation is centralized" }).waitFor();
  await alice.screenshot({ path: root + "20-inline-knowledge-alice.png" });
  await bob.screenshot({ path: root + "20-inline-knowledge-bob.png" });
  return { generated: result, hover: await bob.locator(".monaco-hover").filter({ hasText: "Status computation is centralized" }).innerText() };
}
