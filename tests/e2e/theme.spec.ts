import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test("member can switch theme and keep the choice after refresh", async ({
  page
}) => {
  await openAs(page, "Theme User");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "Switch to light mode");

  await toggle.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-label", "Switch to dark mode");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("simplercp.theme")))
    .toBe("light");

  await page.reload();
  await page.getByTestId("status-bar").waitFor();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("editor and terminal follow the selected theme", async ({ page }) => {
  await openAs(page, "Theme Surface User");
  await page.getByTestId("dir-src").click();
  await page.getByTestId("file-src/hello.ts").click();

  const editor = page.locator(".monaco-editor").first();
  const terminal = page.locator(".xterm-viewport").first();
  await expect(editor).toBeVisible();
  await expect(terminal).toBeVisible();

  await page.getByTestId("theme-toggle").click();

  await expect
    .poll(() =>
      editor.evaluate((element) => getComputedStyle(element).backgroundColor)
    )
    .toBe("rgb(255, 255, 254)");
  await expect
    .poll(() =>
      terminal.evaluate((element) => getComputedStyle(element).backgroundColor)
    )
    .toBe("rgb(248, 250, 252)");
});
