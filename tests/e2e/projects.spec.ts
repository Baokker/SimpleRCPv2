import { expect, test } from "@playwright/test";

test("project home opens Demo and creates an empty project", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("project-list")).toContainText("Demo");

  await page.getByTestId("new-project").click();
  await page.getByTestId("project-name").fill("Browser Project");
  await page.getByTestId("create-project-submit").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const createdProjectId = decodeURIComponent(
    new URL(page.url()).pathname.split("/").at(-1) ?? ""
  );
  await expect(page.getByTestId("join-project-form")).toContainText(
    "Browser Project"
  );

  await page.getByTestId("display-name").fill("Ada");
  await page.getByTestId("member-role").fill("Developer");
  await page.getByTestId("join-project").click();
  await expect(page.getByTestId("status-bar")).toContainText("Browser Project");
  await expect(page.getByTestId("projects-link")).toBeVisible();

  await page.goto("/");
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain('Delete "Browser Project" and all stored code?');
    await dialog.accept();
  });
  await page.getByTestId(`delete-project-${createdProjectId}`).click();
  await expect(page.getByTestId(`open-project-${createdProjectId}`)).toHaveCount(0);
  await expect(page.getByTestId("delete-project-demo")).toHaveCount(0);

  await page.getByTestId("open-project-demo").click();
  await expect(page.getByTestId("join-project-form")).toContainText("Demo");
});

test("missing projects show a recoverable error", async ({ page }) => {
  await page.goto("/projects/missing-project");

  await expect(page.getByTestId("route-error")).toContainText(
    "Project not found"
  );
  await expect(page.getByTestId("route-error-projects")).toHaveAttribute(
    "href",
    "/"
  );
  await expect(page.getByTestId("route-error-retry")).toBeVisible();
});

test("an open project reports when another client deletes it", async ({
  browser,
  request
}) => {
  const createResponse = await request.post("/api/projects", {
    data: { name: "Active Delete Test" }
  });
  const created = await createResponse.json() as { project: { id: string } };
  const page = await browser.newPage();
  await page.goto(`/projects/${created.project.id}?name=ActiveUser`);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");

  const deleteResponse = await request.delete(
    `/api/projects/${created.project.id}`
  );
  expect(deleteResponse.ok()).toBe(true);

  await expect(page.getByTestId("workspace-error")).toContainText(
    "This project was deleted."
  );
  await expect(page.getByTestId("workspace-error").getByRole("link")).toHaveAttribute(
    "href",
    "/"
  );
  await page.close();
});
