async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) await member.getByTestId("file-README.md").click();
  await alice.getByRole("searchbox", { name: "Search knowledge" }).fill("The README is for external contributors");
  await bob.getByTestId("collab-tab-agent").click();
  await bob.getByTestId("agent-prompt").fill("Improve README.md of this project: add the steps for running npm test, the request retry module, and notes on team collaboration. Follow the project's README language rule and keep it in English. Only change README.md, then run npm test.");
  const preview = bob.getByTestId("agent-knowledge-preview");
  await preview.waitFor({ timeout: 30000 });
  await preview.getByText("The README is for external contributors and is written in English", { exact: true }).waitFor();
  const previewText = await preview.innerText();
  await alice.screenshot({ path: root + "21-agent-knowledge-preview-alice.png" });
  await bob.screenshot({ path: root + "21-agent-knowledge-preview-bob.png" });
  const started = bob.waitForResponse(r => r.url().includes("/agent/sessions/") && r.url().endsWith("/runs") && r.request().method() === "POST");
  await bob.getByTestId("agent-run-submit").click();
  const response = await started;
  if (!response.ok()) throw new Error(await response.text());
  return { preview: previewText, run: await response.json() };
}
