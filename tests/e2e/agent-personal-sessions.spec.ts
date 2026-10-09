import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

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
