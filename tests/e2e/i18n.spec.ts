import { expect, test } from "@playwright/test";

test("默认中文，项目列表、加入页和工作区可切换语言并在刷新后保留", async ({ page }) => {
  await page.goto("/");
  const document = page.locator("html");
  const chinese = page.getByRole("button", { name: "中文", exact: true });
  const english = page.getByRole("button", { name: "English", exact: true });
  await expect(document).toHaveAttribute("lang", "zh-CN");
  await expect(chinese).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("new-project")).toHaveText("新建项目");

  await english.click();
  await expect(document).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("new-project")).toHaveText("New project");
  await page.getByTestId("open-project-demo").click();
  const join = page.getByTestId("join-project");
  const name = page.getByTestId("display-name");
  await expect(join).toHaveText("Enter project");
  await name.fill("Locale Reader");
  await chinese.click();
  await expect(join).toHaveText("进入项目");
  await expect(name).toHaveValue("Locale Reader");
  await join.click();

  const collaboration = page.getByTestId("collab-tab-chat");
  const connection = page.getByTestId("connection-state");
  await expect(collaboration).toHaveText("聊天");
  await expect(connection).toHaveText("已连接");
  await page.getByTestId("collab-tab-team").click();
  const activity = page.getByTestId("activity-feed");
  await expect(activity).toContainText("Locale Reader 加入了会话");

  await english.click();
  await expect(collaboration).toHaveText("Chat");
  await expect(connection).toHaveText("Connected");
  await expect(activity).toContainText("Locale Reader joined the session");
  await page.reload();
  await expect(document).toHaveAttribute("lang", "en");
  await expect(english).toHaveAttribute("aria-pressed", "true");
  await expect(collaboration).toHaveText("Chat");

  await chinese.click();
  await page.reload();
  await expect(document).toHaveAttribute("lang", "zh-CN");
  await expect(chinese).toHaveAttribute("aria-pressed", "true");
  await expect(collaboration).toHaveText("聊天");
});
