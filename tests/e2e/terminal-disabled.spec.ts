import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test.skip(
  process.env.SIMPLERCP_TERMINAL_ENABLED !== "false",
  "Run with SIMPLERCP_TERMINAL_ENABLED=false"
);

test("disabled shared terminal is absent from the workspace", async ({ page }) => {
  await openAs(page, "Terminal Disabled Member");

  await expect(page.getByTestId("toggle-terminal")).toHaveCount(0);
  await expect(page.locator(".terminal-pane")).toHaveCount(0);

  const health = await page.request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({
    features: { terminal: false }
  });
});
