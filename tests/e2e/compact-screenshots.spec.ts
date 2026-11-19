import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../../docs/guard/compact/screenshots/", import.meta.url));

async function openAs(page: import("@playwright/test").Page, name: string, role: string) {
  await page.goto("/projects/demo");
  await page.getByTestId("display-name").fill(name);
  await page.getByTestId("member-role").selectOption(role);
  await page.getByTestId("join-project").click();
  await page.getByTestId("status-bar").waitFor();
  await page.getByTestId("dir-src").click();
  await page.getByTestId("file-src/hello.ts").click();
  await expect(page.locator(".tab.active")).toContainText("src/hello.ts");
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();
}

test("captures the ComPACT contributor and owner views", async ({ browser }) => {
  test.skip(process.env.SIMPLERCP_CAPTURE_COMPACT !== "1", "Requires the English locale and a configured model provider");
  await fs.mkdir(output, { recursive: true });
  const aliceContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const alicePage = await aliceContext.newPage();
  await openAs(alicePage, "Alice", "owner");
  const bobContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const bobPage = await bobContext.newPage();
  await openAs(bobPage, "Bob", "contributor");
  const command = bobPage.locator('.terminal-command-box input[placeholder="Submit a terminal command"]');
  await command.fill("sudo ls");
  await command.press("Enter");
  await expect(bobPage.locator(".terminal-guard-status")).toContainText("Blocked");
  const metadataCommand = "cat ../../projects/demo/project.json";
  await command.fill(metadataCommand);
  await command.press("Enter");
  await bobPage.getByTestId("collab-tab-team").click();
  const activity = bobPage.getByTestId("activity-feed");
  await expect(activity.getByRole("listitem").filter({ hasText: "sudo ls" })).toContainText("Blocked");
  await expect(activity.getByRole("listitem").filter({ hasText: metadataCommand })).toContainText("Blocked");
  await command.fill("curl https://example.com/");
  await command.press("Enter");
  await expect(activity).toContainText("Model is reviewing Bob's request");
  await bobPage.emulateMedia({ media: "screen" });
  await bobPage.pdf({ path: path.join(output, "bob-contributor.pdf"), width: 1600, height: 1000, printBackground: true });
  await bobPage.screenshot({ path: path.join(output, "bob-contributor.png") });

  await alicePage.getByTestId("collab-tab-team").click();
  await expect(alicePage.locator(".guard-approval-card")).toContainText("Bob (Contributor)");
  await expect(alicePage.locator(".guard-approval-card")).toContainText(/\d+% confidence/);
  await expect(alicePage.locator(".guard-approval-card").getByRole("button", { name: "Approve" })).toBeVisible();
  await alicePage.emulateMedia({ media: "screen" });
  await alicePage.screenshot({ path: path.join(output, "alice-owner-approval.png") });
  await alicePage.pdf({ path: path.join(output, "alice-owner-approval.pdf"), width: 1600, height: 1000, printBackground: true });
  await aliceContext.close();
  await bobContext.close();
});
