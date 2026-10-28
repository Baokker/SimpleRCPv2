async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) await member.getByTestId("file-README.md").click();
  await alice.getByRole("searchbox", { name: "搜索知识" }).fill("README 面向外部成员");
  await bob.getByTestId("collab-tab-agent").click();
  await bob.getByTestId("agent-prompt").fill("完善这个项目的 README.md，补充运行 npm test 的步骤、请求重试模块和团队协作说明；遵守项目的 README 语言约束，保持英文。只修改 README.md，最后运行 npm test。");
  const preview = bob.getByTestId("agent-knowledge-preview");
  await preview.waitFor({ timeout: 30000 });
  await preview.getByText("README 面向外部成员，统一使用英文", { exact: true }).waitFor();
  const previewText = await preview.innerText();
  await alice.screenshot({ path: root + "21-agent-knowledge-preview-alice.png" });
  await bob.screenshot({ path: root + "21-agent-knowledge-preview-bob.png" });
  const started = bob.waitForResponse(r => r.url().includes("/agent/sessions/") && r.url().endsWith("/runs") && r.request().method() === "POST");
  await bob.getByTestId("agent-run-submit").click();
  const response = await started;
  if (!response.ok()) throw new Error(await response.text());
  return { preview: previewText, run: await response.json() };
}
