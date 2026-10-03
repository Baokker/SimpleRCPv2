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
  await page.locator(".team-agent-create").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("team-agent-bar")).toContainText("@reviewer");

  await page.getByTestId("chat-input").fill("/agent new planner");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("team-agent-bar")).toContainText("@planner");
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
