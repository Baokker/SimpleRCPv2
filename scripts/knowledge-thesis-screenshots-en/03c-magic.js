async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  await bob.evaluate(async () => {
    const response = await fetch("/api/projects/demo/workspace/file", { method: "POST", headers: { "content-type": "application/json", "X-SimpleRCP-Member": sessionStorage.getItem("simplercp.memberId.demo") }, body: JSON.stringify({ path: "src/backoffPolicy.js", content: "export function backoffDelayMs() {\n  return 50;\n}\n" }) });
    if (!response.ok) throw new Error(await response.text());
  });
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/backoffPolicy.js").click();
    await member.waitForFunction(() => window.__simplercpYjsSynced?.["src/backoffPolicy.js"]);
  }
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/backoffPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: editor.getModel().getLineMaxColumn(2) }, text: "  return 1500;" }]);
    editor.focus();
  });
  await alice.waitForFunction(() => window.__simplercpEditors["src/backoffPolicy.js"].getModel().getValue().includes("1500"));
  return { member: "Bob", file: "src/backoffPolicy.js", before: 50, after: 1500, synced: true };
}
