import { expect, test } from "@playwright/test";

test("project home opens Demo and creates an empty project", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("project-list")).toContainText("Demo");

  await page.getByTestId("new-project").click();
  await page.getByTestId("project-name").fill("Browser Project");
  await page.getByTestId("create-project-submit").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByTestId("join-project-form")).toContainText(
    "Browser Project"
  );

  await page.getByTestId("display-name").fill("Ada");
  await page.getByTestId("member-role").fill("Developer");
  await page.getByTestId("join-project").click();
  await expect(page.getByTestId("status-bar")).toContainText("Browser Project");

  await page.goto("/");
  await page.getByTestId("open-project-demo").click();
  await expect(page.getByTestId("join-project-form")).toContainText("Demo");
});
