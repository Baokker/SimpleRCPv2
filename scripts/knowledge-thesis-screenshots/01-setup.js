async (page) => {
  const alice = page;
  for (const extra of page.context().pages().slice(1)) await extra.close();
  await alice.evaluate(() => {
    localStorage.setItem("simplercp.theme", "dark");
    localStorage.setItem("simplercp.layout.workspaceWidth", "180");
    localStorage.setItem("simplercp.layout.collaborationWidth", "480");
    localStorage.removeItem("simplercp.memberId.demo");
    localStorage.removeItem("simplercp.activeMemberId");
    sessionStorage.clear();
  });
  await alice.reload();
  // Wait until the page shows either the join form or the workspace before deciding whether to join.
  await alice.getByTestId("display-name").or(alice.getByTestId("status-bar")).first().waitFor();
  if (await alice.getByTestId("display-name").isVisible()) {
    await alice.getByTestId("display-name").fill("Alice");
    await alice.getByTestId("member-role").fill("Developer");
    await alice.getByTestId("join-project").click();
  }
  await alice.getByTestId("status-bar").waitFor();
  const bobContext = await alice.context().browser().newContext(globalThis.CAPTURE_CONTEXT);
  const bob = await bobContext.newPage();
  await bob.goto(globalThis.CAPTURE_ORIGIN + "/projects/demo");
  // Wait until the page shows either the join form or the workspace before deciding whether to join.
  await bob.getByTestId("display-name").or(bob.getByTestId("status-bar")).first().waitFor();
  if (await bob.getByTestId("display-name").isVisible()) {
    await bob.getByTestId("display-name").fill("Bob");
    await bob.getByTestId("member-role").fill("Reviewer");
    await bob.getByTestId("join-project").click();
  }
  await bob.getByTestId("status-bar").waitFor();
  if (await bob.locator("html").getAttribute("data-theme") !== "light") await bob.getByTestId("theme-toggle").click();
  const files = [
    ["src/retryPolicy.js", "export async function waitForRetry(delayMs) {\n  await new Promise(resolve => setTimeout(resolve, delayMs));\n}\n\nexport async function retryNotification(send, delayMs = 1000) {\n  await waitForRetry(delayMs);\n  return send();\n}\n"],
    ["src/requestPolicy.js", "export function requestTimeoutMs() {\n  return 3000;\n}\n\nexport function canRetry(attempt) {\n  return attempt < 3;\n}\n"],
    ["AGENTS.md", "# Team coding guidelines\n\n## Documentation\n\nAll README prose must be written in English because external contributors use this project. Keep code identifiers unchanged.\n\n## Compatibility\n\nKeep existing exported functions and their public parameters compatible when adding a feature.\n\n## Validation\n\nAfter modifying JavaScript source files, run npm test from the workspace root.\n\n## Time units\n\nName durations with an Ms suffix and use milliseconds throughout request policy code.\n"],
    ["README.md", "# Collaborative notification service\n\nThis demo explores shared request policies and retry behavior.\n\n## Development\n\nRun npm test before sharing a change.\n"]
  ];
  const prepared = await alice.evaluate(async entries => {
    const headers = { "content-type": "application/json", "X-SimpleRCP-Member": sessionStorage.getItem("simplercp.memberId.demo") };
    const results = [];
    for (const [path, content] of entries) {
      const response = await fetch("/api/projects/demo/workspace/file", { method: "PUT", headers, body: JSON.stringify({ path, content }) });
      if (!response.ok) throw new Error(await response.text());
      results.push({ path, status: response.status });
    }
    return results;
  }, files);
  for (const member of [alice, bob]) {
    await member.getByTestId("dir-src").click();
    await member.getByTestId("file-src/requestPolicy.js").click();
    await member.waitForFunction(() => window.__simplercpYjsSynced?.["src/requestPolicy.js"]);
  }
  const identities = await Promise.all([alice, bob].map(member => member.evaluate(() => sessionStorage.getItem("simplercp.memberId.demo"))));
  if (identities[0] === identities[1]) throw new Error("Members must have different identities");
  await alice.getByTestId("chat-input").fill("我正在整理 requestPolicy.js 的请求超时约定，你可以同时检查重试逻辑。");
  await alice.getByTestId("send-chat").click();
  await bob.getByTestId("chat-input").fill("好的，我正在查看同一份代码。超时单位统一使用毫秒，字段名保留 Ms 后缀。");
  await bob.getByTestId("send-chat").click();
  await alice.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.setPosition({ lineNumber: 2, column: 10 });
    editor.focus();
  });
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.setPosition({ lineNumber: 6, column: 10 });
    editor.focus();
  });
  await alice.screenshot({ path: globalThis.CAPTURE_OUTPUT + "00-collaboration-alice.png" });
  await bob.screenshot({ path: globalThis.CAPTURE_OUTPUT + "00-collaboration-bob.png" });
  return { prepared, identities, themes: [await alice.locator("html").getAttribute("data-theme"), await bob.locator("html").getAttribute("data-theme")] };
}
