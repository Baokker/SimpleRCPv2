import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test("个人会话分别保存尚未发送的提示，中文输入确认不会发送任务", async ({ page }) => {
  await openAs(page, "Draft Reader");
  await page.getByTestId("collab-tab-agent").click();
  for (const title of ["README 任务", "折扣任务"]) {
    await page.getByTestId("agent-new-session").click();
    await page.getByTestId("agent-session-title").fill(title);
    await page.getByTestId("agent-session-title").press("Enter");
    await expect(page.getByRole("tab", { name: title, exact: true })).toBeVisible();
  }
  const prompt = page.getByTestId("agent-prompt");
  await prompt.fill("把618折扣改成八折");
  await prompt.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(prompt).toHaveValue("把618折扣改成八折");
  await expect(page.locator(".agent-user-message")).toHaveCount(0);
  await page.getByRole("tab", { name: "README 任务", exact: true }).click();
  await expect(prompt).toHaveValue("");
  await prompt.fill("用中文编写README");
  await page.getByRole("tab", { name: "折扣任务", exact: true }).click();
  await expect(prompt).toHaveValue("把618折扣改成八折");
  await page.getByRole("tab", { name: "README 任务", exact: true }).click();
  await expect(prompt).toHaveValue("用中文编写README");
  await page.getByTestId("collab-tab-chat").click();
  await page.getByTestId("collab-tab-agent").click();
  await expect(page.getByRole("tab", { name: "README 任务", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(prompt).toHaveValue("用中文编写README");
  await expect(page.getByTestId("agent-selected-run")).toHaveCount(0);
});

test("个人会话按成员显示，关闭按钮删除会话并在刷新后保持", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage(), bob = await bobContext.newPage();
  try {
    await openAs(alice, "Session Alice");
    await openAs(bob, "Session Bob");
    for (const [page, title] of [[alice, "Alice 的个人会话"], [bob, "Bob 的个人会话"]] as const) {
      await page.getByTestId("collab-tab-agent").click();
      await page.getByTestId("agent-new-session").click();
      await page.getByTestId("agent-session-title").fill(title);
      await page.getByTestId("agent-session-title").press("Enter");
      await expect(page.getByRole("tab", { name: title, exact: true })).toBeVisible();
    }
    await expect(alice.getByRole("tab", { name: "Bob 的个人会话", exact: true })).toHaveCount(0);
    await expect(bob.getByRole("tab", { name: "Alice 的个人会话", exact: true })).toHaveCount(0);
    alice.once("dialog", (dialog) => dialog.accept());
    await alice.getByRole("button", { name: "删除会话 Alice 的个人会话", exact: true }).click();
    await expect(alice.getByRole("tab", { name: "Alice 的个人会话", exact: true })).toHaveCount(0);
    await alice.reload();
    await alice.getByTestId("collab-tab-agent").click();
    await expect(alice.getByRole("tab", { name: "Alice 的个人会话", exact: true })).toHaveCount(0);
    await expect(bob.getByRole("tab", { name: "Bob 的个人会话", exact: true })).toBeVisible();
  } finally { await aliceContext.close(); await bobContext.close(); }
});
