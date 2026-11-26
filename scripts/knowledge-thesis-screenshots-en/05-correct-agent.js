async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  await alice.locator(".run-status-completed").last().waitFor({ timeout: 240000 });
  const code = await bob.evaluate(() => window.__simplercpEditors["src/retryPolicy.js"].getModel().getValue());
  if (!code.includes("onAttempt") || !code.includes("setTimeout")) throw new Error("Initial Agent change is missing");
  await alice.getByTestId("agent-selected-run").last().scrollIntoViewIfNeeded();
  await alice.screenshot({ path: root + "10-agent-first-result-alice.png" });
  await bob.screenshot({ path: root + "10-agent-first-result-bob.png" });
  const prompt = "Don't reimplement the setTimeout wait inside retryNotification; reuse the existing waitForRetry(delayMs) instead. This corrects the previous task: keep onAttempt?.(), send, and the configurable delayMs compatible, and keep waitForRetry exported. Only change src/retryPolicy.js and run npm test.";
  await alice.getByTestId("agent-prompt").fill(prompt);
  await alice.screenshot({ path: root + "11-agent-correction-alice.png" });
  await bob.screenshot({ path: root + "11-agent-correction-bob.png" });
  const started = alice.waitForResponse(r => r.url().includes("/agent/sessions/") && r.url().endsWith("/runs") && r.request().method() === "POST");
  await alice.getByTestId("agent-run-submit").click();
  const response = await started;
  if (!response.ok()) throw new Error(await response.text());
  return { beforeCorrection: code, run: await response.json() };
}
