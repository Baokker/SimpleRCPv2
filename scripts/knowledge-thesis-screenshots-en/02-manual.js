async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) {
    await member.getByTestId("file-README.md").click();
    await member.getByTestId("collab-tab-knowledge").click();
  }
  await alice.getByRole("button", { name: "New", exact: true }).click();
  const editor = alice.getByRole("dialog", { name: "Knowledge card editor" });
  await editor.getByLabel("Card type").selectOption("constraint");
  await editor.getByPlaceholder("Title", { exact: true }).fill("The README is for external contributors and is written in English");
  await editor.getByPlaceholder("Body (Markdown)").fill("Titles, descriptions, and instructions in the README are written in English. Code identifiers stay unchanged so that external contributors can read and run them directly.");
  await editor.getByLabel("Applicability", { exact: true }).selectOption("file");
  await editor.getByLabel("Applicable file").fill("README.md");
  await alice.screenshot({ path: root + "01-manual-form-alice.png" });
  await bob.screenshot({ path: root + "01-manual-form-bob.png" });
  const saved = alice.waitForResponse(response => response.url().endsWith("/knowledge/cards") && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  const response = await saved;
  if (response.status() !== 201) throw new Error(await response.text());
  const { card } = await response.json();
  for (const member of [alice, bob]) {
    await member.getByRole("button", { name: "Cards", exact: true }).click();
    await member.getByLabel("Filter range").selectOption("all");
    const entry = member.locator(`[data-card-id="${card.id}"]`);
    await entry.waitFor();
    await entry.locator(".knowledge-card-summary").click();
    await entry.getByText("Source", { exact: true }).click();
  }
  await alice.screenshot({ path: root + "02-manual-saved-alice.png" });
  await bob.screenshot({ path: root + "02-manual-saved-bob.png" });
  return { cardId: card.id, status: card.status, scope: card.scope, origin: card.provenance.origin, anchors: card.anchors };
}
