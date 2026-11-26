async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) {
    await member.getByTestId("file-src/requestPolicy.js").click();
    await member.getByTestId("collab-tab-chat").click();
  }
  const messages = [
    "requestTimeoutMs in requestPolicy.js returns 3000 ms, and the external notification API often takes longer at peak times.",
    "The third-party API usually needs about four seconds, so I suggest a single request timeout of 5000 ms.",
    "5000 ms is fine. We should settle the number of retries too, to avoid long waits.",
    "canRetry keeps the limit of three attempts, and every call uses requestTimeoutMs instead of writing its own number.",
    "Callers keep one shared entry point, so changing the timeout later only touches this function.",
    "Agreed. Logs record milliseconds as well, so nobody reads 5000 as seconds.",
    "Function names use the Ms suffix, and the parameter delayMs follows the same convention.",
    "retryPolicy.js already has waitForRetry, which the send flows can reuse.",
    "That helper must stay. Don't remove existing exports when adding features.",
    "I'll check that existing calls can still pass delayMs, so the current parameters stay compatible.",
    "Today's rule: request timeout 5000 ms, at most three retries, reuse the existing helper.",
    "Confirmed. Let's record this background so other members and agents can find the reasons when they change the code."
  ];
  for (let i = 0; i < messages.length; i++) {
    const member = i % 2 ? bob : alice;
    await member.getByTestId("chat-input").fill(messages[i]);
    await member.getByTestId("send-chat").click();
  }
  await alice.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 2, startColumn: 10, endLineNumber: 2, endColumn: 14 }, text: "5000" }]);
    editor.focus();
  });
  await bob.waitForFunction(() => window.__simplercpEditors["src/requestPolicy.js"].getModel().getValue().includes("5000"));
  await bob.evaluate(() => {
    const editor = window.__simplercpEditors["src/requestPolicy.js"];
    editor.executeEdits("knowledge-demo", [{ range: { startLineNumber: 6, startColumn: 17, endLineNumber: 6, endColumn: 18 }, text: "4" }]);
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
  return { synced: true, messages: messages.length, imported: result, draftCount: await panel.locator("textarea[aria-label^='Import draft']").count() };
}
