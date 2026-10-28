async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) await member.getByTestId("file-README.md").click();
  await bob.getByTestId("collab-tab-agent").click();
  await bob.locator(".run-status-completed").last().waitFor({ timeout: 240000 });
  const run = bob.getByTestId("agent-selected-run").last();
  const reference = run.getByTestId("agent-knowledge-reference");
  await reference.getByText("README 面向外部成员，统一使用英文", { exact: true }).waitFor();
  await reference.scrollIntoViewIfNeeded();
  await alice.getByRole("searchbox", { name: "搜索知识" }).fill("README 面向外部成员");
  await alice.getByLabel("筛选范围").selectOption("all");
  await alice.screenshot({ path: root + "22-agent-references-alice.png" });
  await bob.screenshot({ path: root + "22-agent-references-bob.png" });
  const checked = run.getByTestId("agent-knowledge-post-check");
  await checked.waitFor();
  await checked.scrollIntoViewIfNeeded();
  await alice.screenshot({ path: root + "23-agent-post-check-alice.png" });
  await bob.screenshot({ path: root + "23-agent-post-check-bob.png" });
  const result = { reference: await reference.innerText(), postCheck: await checked.innerText() };
  await alice.getByRole("button", { name: "知识动态", exact: true }).click();
  await alice.screenshot({ path: root + "24-knowledge-activity-alice.png" });
  await bob.screenshot({ path: root + "24-knowledge-activity-bob.png" });
  return result;
}
