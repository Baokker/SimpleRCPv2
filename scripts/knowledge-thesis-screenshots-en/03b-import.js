async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: editor.getModel().getLineMaxColumn(6) }, text: "  return attempt < 4;" }]);
    editor.focus();
  });
  await alice.waitForFunction(() => window.__simplercpEditors["src/requestPolicy.js"].getModel().getValue().includes("attempt < 4"));
  await alice.screenshot({ path: root + "03-discussion-alice.png" });
  await bob.screenshot({ path: root + "03-discussion-bob.png" });
  await alice.getByTestId("file-AGENTS.md").click();
  await alice.getByTestId("collab-tab-knowledge").click();
  await alice.getByRole("button", { name: "More knowledge actions" }).click();
  await alice.getByRole("button", { name: "Import guidelines", exact: true }).click();
  const panel = alice.getByTestId("knowledge-import");
  await panel.getByLabel("Guideline document paths").fill("AGENTS.md");
  const imported = alice.waitForResponse(r => r.url().endsWith("/knowledge/import") && r.request().method() === "POST", { timeout: 180000 });
  await panel.getByRole("button", { name: "Generate import drafts", exact: true }).click();
  await alice.screenshot({ path: root + "04-import-loading-alice.png" });
  await bob.screenshot({ path: root + "04-import-loading-bob.png" });
  const response = await imported;
  if (response.status() !== 201) throw new Error(await response.text());
  const result = await response.json();
  await panel.locator("textarea[aria-label^='Import draft']").first().waitFor();
  await alice.screenshot({ path: root + "05-import-drafts-alice.png" });
  await bob.getByTestId("file-AGENTS.md").click();
  await bob.getByTestId("collab-tab-knowledge").click();
  await bob.getByRole("button", { name: "Pending", exact: true }).click();
  await bob.getByRole("checkbox", { name: "Show suggestions of all members" }).check();
  await bob.screenshot({ path: root + "05-import-drafts-bob.png" });
  return { synced: true, imported: result, draftCount: await panel.locator("textarea[aria-label^='Import draft']").count() };
}
