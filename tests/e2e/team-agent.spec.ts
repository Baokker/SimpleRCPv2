import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test("team Agent bar and shared Chat controls are visible", async ({ page }) => {
  await openAs(page, "Team Member", "demo", "Developer");
  await expect(page.getByTestId("team-agent-bar")).toContainText("@agent");
  await expect(page.getByTestId("team-agent-bar")).toContainText("Idle");
  await expect(page.getByTestId("chat-input")).toHaveAttribute(
    "placeholder",
    "Message the team, or @agent to give the shared agent a task"
  );
  await expect(page.getByTestId("chat-command-hint")).toContainText("/agent new reviewer");
  await expect(page.getByTestId("collab-tab-agent")).toContainText("My Agent");
  await page.getByTestId("collab-tab-agent").click();
  await expect(page.getByTestId("my-agent-hint")).toContainText("mention @agent in Chat");
  await expect(page.getByTestId("agent-prompt")).toHaveAttribute(
    "placeholder",
    "Ask OpenCode about this project (only you can see this session)"
  );
});

test("members can create team Agents from the bar and slash command", async ({ page }) => {
  await openAs(page, "Creator", "demo", "Developer");
  await page.getByTestId("team-agent-create").click();
  await page.getByTestId("team-agent-name").fill("Reviewer");
  await page.getByTestId("team-agent-description").fill("reviews source changes");
  await page.locator(".team-agent-create").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("team-agent-bar")).toContainText("@reviewer");

  await page.getByTestId("chat-input").fill("/agent new planner plans release work");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("team-agent-bar")).toContainText("@planner");
  const agents = await page.evaluate(async () => {
    const response = await fetch("/api/projects/demo/team-agents", {
      headers: { "X-SimpleRCP-Member": localStorage.getItem("simplercp.memberId.demo") ?? "" }
    });
    return response.json();
  });
  expect(agents).toEqual(expect.objectContaining({
    agents: expect.arrayContaining([
      expect.objectContaining({ handle: "planner", description: "plans release work" }),
      expect.objectContaining({ handle: "reviewer", description: "reviews source changes" })
    ])
  }));
  await page.getByTestId("chat-input").fill("@");
  await expect(page.getByTestId("mention-candidates")).toContainText("@agent");
  await expect(page.getByTestId("mention-candidates")).toContainText("@reviewer");
  await expect(page.getByTestId("mention-candidates")).toContainText("@planner");
});

test("team Agent state and Chat history survive a reload", async ({ page }) => {
  await openAs(page, "Persistent Member");
  await page.getByTestId("chat-input").fill("Team discussion");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("chat-transcript")).toContainText("Team discussion");
  await page.reload();
  await page.getByTestId("status-bar").waitFor();
  await expect(page.getByTestId("team-agent-bar")).toContainText("@agent");
  await expect(page.getByTestId("chat-transcript")).toContainText("Team discussion");
});

test("Chat and My Agent share a live team trace and download", async ({ page }) => {
  const settingsResponse = await page.request.get("/api/agent/settings");
  const settings = await settingsResponse.json() as { apiKeyConfigured: boolean };
  test.skip(!settings.apiKeyConfigured, "DEEPSEEK_API_KEY is not configured");
  const runtimeResponse = await page.request.get("/api/agent/status");
  const runtime = await runtimeResponse.json() as { version?: string };
  test.skip(runtime.version === "fake", "DEEPSEEK_API_KEY is not configured");

  await openAs(page, "Chat Trace Member", "demo", "Developer");
  await page.getByTestId("chat-input").fill("@agent Reply with exactly: shared chat trace verified");
  await page.getByTestId("send-chat").click();

  const card = page.getByTestId("chat-agent-card").last();
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText("Agent is working");
  await expect(page.getByTestId("chat-agent-trace").last()).toContainText("Started working in the project", { timeout: 30_000 });
  await expect(card).toContainText("Run completed", { timeout: 90_000 });

  const downloadPromise = page.waitForEvent("download");
  await card.getByRole("button", { name: "Download complete trace" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^trace-.+\.jsonl$/);

  await page.getByTestId("collab-tab-agent").click();
  await expect(page.getByTestId("agent-team-traces")).toHaveCount(0);
  await expect(page.getByTestId("agent-prompt")).toBeVisible();
  await page.getByTestId("collab-tab-chat").click();
  await expect(page.getByTestId("chat-agent-card").last()).toContainText("Run completed");
});

test("team Agent replies are shared across member browser contexts", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await openAs(pageA, "Shared Alice", "demo", "Developer");
  await openAs(pageB, "Shared Bob", "demo", "Reviewer");

  await pageA.getByTestId("chat-input").fill("@agent fake-delay=250 fake-reply=shared response from team agent");
  await pageA.getByTestId("send-chat").click();

  await expect(pageB.getByTestId("chat-transcript")).toContainText("fake-delay=250", { timeout: 10_000 });
  await expect(pageB.getByTestId("chat-agent-card")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByTestId("chat-transcript")).toContainText("shared response from team agent", { timeout: 15_000 });
  await contextA.close();
  await contextB.close();
});

test("interrupting a team run records changed files for the next run", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await openAs(pageA, "Interrupt Alice", "demo", "Developer");
  await openAs(pageB, "Interrupt Bob", "demo", "Reviewer");

  const firstNewCardIndex = await pageA.getByTestId("chat-agent-card").count();
  await pageA.getByTestId("chat-input").fill("@agent fake-write=interrupted-file.txt fake-delay=5000 fake-reply=old work");
  await pageA.getByTestId("send-chat").click();
  const oldCard = pageA.getByTestId("chat-agent-card").nth(firstNewCardIndex);
  await expect(oldCard).toContainText("running", { timeout: 10_000 });

  await pageB.getByTestId("chat-input").fill("@agent fake-delay=100 fake-reply=follow up complete");
  await pageB.getByTestId("send-chat").click();
  const newCard = pageA.getByTestId("chat-agent-card").nth(firstNewCardIndex + 1);

  await expect(oldCard).toContainText("Interrupted by Interrupt Bob", { timeout: 10_000 });
  await expect(pageA.getByTestId("chat-transcript")).toContainText("interrupted @agent's task", { timeout: 10_000 });
  await expect(newCard).toContainText("completed", { timeout: 20_000 });

  const runs = await pageA.evaluate(async () => {
    const response = await fetch("/api/projects/demo/agent/runs", {
      headers: { "X-SimpleRCP-Member": localStorage.getItem("simplercp.memberId.demo") ?? "" }
    });
    return response.json();
  }) as { runs: Array<{ id: string; prompt: string; status: string; fileChanges?: Array<{ file: string }> }> };
  expect(runs.runs.some((run) => run.status === "cancelled" && run.fileChanges?.some((change) => change.file === "interrupted-file.txt"))).toBe(true);
  const newRun = runs.runs.find((run) => run.prompt.includes("fake-delay=100"));
  expect(newRun).toBeDefined();
  const trace = await pageA.evaluate(async (runId) => {
    const response = await fetch(`/api/projects/demo/agent/runs/${runId}/trace`, {
      headers: { "X-SimpleRCP-Member": localStorage.getItem("simplercp.memberId.demo") ?? "" }
    });
    return response.json();
  }, newRun?.id) as { events: Array<{ type: string; data?: Record<string, unknown> }> };
  expect(trace.events.some((event) => event.type === "opencode.fake.started" && String(event.data?.prompt).includes("Files changed before interruption: interrupted-file.txt"))).toBe(true);
  await contextA.close();
  await contextB.close();
});

test("team Agent waits for a personal Agent run in the project queue", async ({ page }) => {
  await openAs(page, "Queue Member", "demo", "Developer");
  await page.getByTestId("collab-tab-agent").click();
  await page.getByTestId("agent-prompt").fill("fake-delay=5000 fake-reply=personal work complete");
  await page.getByTestId("agent-run-submit").click();
  await expect(page.getByTestId("agent-selected-run")).toContainText("Running", { timeout: 10_000 });

  await page.getByTestId("collab-tab-chat").click();
  await page.getByTestId("chat-input").fill("@agent fake-reply=team work complete");
  await page.getByTestId("send-chat").click();
  const teamCard = page.getByTestId("chat-agent-card").last();
  await expect(teamCard).toContainText("queued", { timeout: 10_000 });
  await expect(teamCard).toContainText("completed", { timeout: 30_000 });
  await page.getByTestId("collab-tab-agent").click();
  await expect(page.getByTestId("agent-selected-run")).toContainText("personal work complete");
});
