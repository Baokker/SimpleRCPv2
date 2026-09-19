import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test("collaborator can keep editing after workspace state refreshes", async ({
  page
}) => {
  const projectId = await page.request
    .post("/api/projects", { data: { name: "Editor Permission Test" } })
    .then(async (response) => {
      const body = await response.json() as { project: { id: string } };
      return body.project.id;
    });
  await openAs(page, "Editor User", projectId);
  await page.getByTestId("new-file").click();
  await page.getByTestId("workspace-path-input").fill("editable.txt");
  await page.getByTestId("workspace-dialog-submit").click();
  await page.waitForFunction(() =>
    Boolean(window.__simplercpYjsSynced?.["editable.txt"])
  );

  await page.waitForTimeout(2_000);

  const readOnly = await page.evaluate(() =>
    window.__simplercpEditors?.["editable.txt"]?.getRawOptions().readOnly
  );
  expect(readOnly).toBe(false);

  await page.locator(".monaco-editor").click();
  await page.keyboard.insertText("editable");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__simplercpEditors?.["editable.txt"]?.getValue()
      )
    )
    .toContain("editable");
});

test("Monaco assigns C++ files to the built-in cpp language", async ({ page }) => {
  const projectId = await page.request
    .post("/api/projects", { data: { name: "C++ Language Test" } })
    .then(async (response) => {
      const body = await response.json() as { project: { id: string } };
      return body.project.id;
    });
  await openAs(page, "C++ Member", projectId);
  await page.getByTestId("new-file").click();
  await page.getByTestId("workspace-path-input").fill("example.cpp");
  await page.getByTestId("workspace-dialog-submit").click();

  await expect.poll(() => page.evaluate(() =>
    window.__simplercpEditors?.["example.cpp"]?.getModel()?.getLanguageId()
  )).toBe("cpp");
  await expect.poll(() => page.evaluate(() => {
    const tokenTypes = window.__simplercpMonaco
      ?.editor.tokenize("int main() { return 0; } // comment", "cpp")
      .flat()
      .map((token) => token.type) ?? [];
    return tokenTypes.some((type) => type.startsWith("keyword.")) &&
      tokenTypes.includes("comment.cpp");
  })).toBe(true);
});
