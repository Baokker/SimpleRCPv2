async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) await member.getByTestId("file-README.md").click();
  await bob.getByTestId("collab-tab-agent").click();
  await bob.locator(".run-status-completed").last().waitFor({ timeout: 240000 });
  const run = bob.getByTestId("agent-selected-run").last();
  const reference = run.getByTestId("agent-knowledge-reference");
  await reference.getByText("The README is for external contributors and is written in English", { exact: true }).waitFor();
  await reference.scrollIntoViewIfNeeded();
  await alice.getByRole("searchbox", { name: "Search knowledge" }).fill("The README is for external contributors");
  await alice.getByLabel("Filter range").selectOption("all");
  await alice.screenshot({ path: root + "22-agent-references-alice.png" });
  await bob.screenshot({ path: root + "22-agent-references-bob.png" });
  const checked = run.getByTestId("agent-knowledge-post-check");
  await checked.waitFor();
  await checked.scrollIntoViewIfNeeded();
  await alice.screenshot({ path: root + "23-agent-post-check-alice.png" });
  await bob.screenshot({ path: root + "23-agent-post-check-bob.png" });
  const result = { reference: await reference.innerText(), postCheck: await checked.innerText() };
  await alice.getByRole("button", { name: "Activity", exact: true }).click();
  await alice.screenshot({ path: root + "24-knowledge-activity-alice.png" });
  await bob.screenshot({ path: root + "24-knowledge-activity-bob.png" });
  return result;
}
