async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/requestPolicy.js").click();
    await member.getByTestId("collab-tab-chat").click();
    await member.getByText("今天确认的规则是：请求超时 5000 毫秒，最多三次重试，复用现有 helper。", { exact: true }).scrollIntoViewIfNeeded();
  }
  await alice.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 });
    editor.focus();
  });
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.setSelection({ startLineNumber: 5, startColumn: 1, endLineNumber: 7, endColumn: 2 });
    editor.focus();
  });
  await alice.screenshot({ path: root + "00-collaboration-alice.png" });
  await bob.screenshot({ path: root + "00-collaboration-bob.png" });
  await alice.screenshot({ path: root + "03-discussion-alice.png" });
  await bob.screenshot({ path: root + "03-discussion-bob.png" });
  const checks = await Promise.all([alice, bob].map(member => member.evaluate(() => ({ memberId: sessionStorage.getItem("simplercp.memberId.demo"), theme: document.documentElement.dataset.theme, code: window.__simplercpEditors["src/requestPolicy.js"].getModel().getValue() }))));
  if (checks[0].memberId === checks[1].memberId || checks[0].code !== checks[1].code || checks[0].theme !== "dark" || checks[1].theme !== "light") throw new Error("Collaboration verification failed");
  return checks;
}
