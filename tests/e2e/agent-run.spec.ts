import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test("project home displays and saves the OpenCode settings", async ({ page }) => {
  const settingsResponse = await page.request.get("/api/agent/settings");
  const settings = await settingsResponse.json() as {
    model: string;
    apiKeyConfigured: boolean;
  };

  await page.goto("/");
  await page.getByTestId("agent-settings-open").click();
  const dialog = page.getByTestId("agent-settings-dialog");
  await expect(dialog).toContainText("OpenCode Ready", { timeout: 20_000 });
  await expect(dialog).toContainText("DeepSeek");
  await expect(dialog).toContainText(
    settings.apiKeyConfigured ? "Configured" : "Missing"
  );
  await expect(page.getByTestId("agent-settings-model")).toHaveValue(
    settings.model
  );
  await page.getByTestId("agent-settings-save").click();
  await expect(dialog).toHaveCount(0);

  const savedResponse = await page.request.get("/api/agent/settings");
  await expect(savedResponse.json()).resolves.toMatchObject({
    provider: "deepseek",
    model: settings.model,
    enabled: true,
    apiKeyConfigured: settings.apiKeyConfigured
  });
});

test("member keeps multiple Agent sessions separate", async ({ page }) => {
  await openAs(page, "Session Member");
  await page.getByTestId("collab-tab-agent").click();

  await page.getByTestId("agent-new-session").click();
  await page.getByTestId("agent-session-title").fill("Login work");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("agent-message-list")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Login work/ })).toBeVisible();

  await page.getByTestId("agent-new-session").click();
  await page.getByTestId("agent-session-title").fill("Test work");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Login work/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Test work/ })).toBeVisible();
});

test("member adds and removes project files from the Agent prompt", async ({ page }) => {
  await openAs(page, "Context Member");
  await page.getByTestId("collab-tab-agent").click();

  await page.getByTestId("agent-add-context").click();
  await page.getByTestId("agent-context-option-src/hello.ts").click();
  await expect(page.getByTestId("agent-context-chip-src/hello.ts")).toBeVisible();
  await page.getByTestId("agent-context-remove-src/hello.ts").click();
  await expect(page.getByTestId("agent-context-chip-src/hello.ts")).toHaveCount(0);
});

test("member runs an OpenCode task and reads its trace", async ({ page }) => {
  const settingsResponse = await page.request.get("/api/agent/settings");
  const settings = await settingsResponse.json() as {
    apiKeyConfigured: boolean;
  };
  test.skip(!settings.apiKeyConfigured, "DEEPSEEK_API_KEY is not configured");

  await openAs(page, "Agent Member");
  await page.getByTestId("collab-tab-agent").click();
  await expect(page.getByTestId("agent-runtime-status")).toContainText("Ready", {
    timeout: 20_000
  });

  const prompt = page.getByTestId("agent-prompt");
  await page.getByTestId("agent-add-context").click();
  await page.getByTestId("agent-context-option-src/hello.ts").click();
  await prompt.fill(
    "Do not use tools. Reply with exactly: browser agent completed"
  );
  await page.getByTestId("agent-run-submit").click();

  const selectedRun = page.getByTestId("agent-message-list");
  await expect(selectedRun).toContainText("Completed", { timeout: 90_000 });
  await expect(selectedRun).toContainText("browser agent completed");
  await expect(selectedRun).toContainText("src/hello.ts");
  const traceDisclosure = page.getByTestId("agent-trace-disclosure");
  await expect(traceDisclosure).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("agent-trace")).toBeHidden();
  await traceDisclosure.getByTestId("agent-trace-summary").click();
  await expect(page.getByTestId("agent-trace")).toBeVisible();
  await expect(page.getByTestId("agent-trace")).toContainText("Run completed");
  await expect(page.getByTestId("agent-trace")).not.toContainText(
    "opencode.message.updated"
  );
  await expect(page.getByTestId("agent-trace-download")).toHaveAttribute(
    "href",
    /\/trace\?download=true$/
  );
});

test("member sees a concurrent change warning when editing an Agent file", async ({
  page
}) => {
  const settingsResponse = await page.request.get("/api/agent/settings");
  const settings = await settingsResponse.json() as {
    apiKeyConfigured: boolean;
  };
  test.skip(!settings.apiKeyConfigured, "DEEPSEEK_API_KEY is not configured");

  await openAs(page, "Concurrent Member");
  await page.getByTestId("dir-src").click();
  await page.getByTestId("file-src/hello.ts").click();
  await page.waitForFunction(() =>
    Boolean(window.__simplercpYjsSynced?.["src/hello.ts"])
  );
  await page.getByTestId("collab-tab-agent").click();
  await page.getByTestId("agent-prompt").fill(
    "Use the bash tool to run sleep 3. Then replace src/hello.ts with exactly: agent replaced this file"
  );
  await page.getByTestId("agent-run-submit").click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__simplercpEditors?.["src/hello.ts"]?.setValue(
      "member changed while agent ran"
    );
  });
  await page.waitForTimeout(700);

  await expect(page.getByTestId("agent-selected-run").last()).toContainText("Completed", {
    timeout: 90_000
  });
  await expect(page.getByTestId("agent-trace").last()).toContainText("Ran command");
  await expect(page.getByTestId("agent-trace").last()).toContainText(/Wrote file|Edited file/);
  await expect(page.getByTestId("agent-trace").last()).toContainText(
    "Concurrent edit detected"
  );
});
