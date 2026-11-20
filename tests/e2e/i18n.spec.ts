import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

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

test("项目校验失败后可以切换错误提示的语言", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("project-list")).toContainText("Demo");
  await page.getByTestId("new-project").click();
  await page.getByTestId("project-name").fill("Demo");
  await page.getByTestId("create-project-submit").click();

  const error = page.locator(".project-form-error");
  await expect(error).toHaveText("已存在同名项目");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(error).toHaveText("A project with this name already exists");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(error).toHaveText("已存在同名项目");
});

test("聊天中的团队 Agent 启动失败通知在切换语言和刷新后可读", async ({ page, request }) => {
  const settingsResponse = await request.get("/api/agent/settings");
  expect(settingsResponse.ok()).toBe(true);
  const { provider, model, enabled } = await settingsResponse.json();
  const disabledResponse = await request.put("/api/agent/settings", {
    data: { provider, model, enabled: false }
  });
  expect(disabledResponse.ok()).toBe(true);

  try {
    await openAs(page, "Team Notification Reader");
    await expect(page.getByTestId("connection-state")).toHaveText("已连接");
    const prompt = "@agent 检查项目";
    await page.getByTestId("chat-input").fill(prompt);
    await page.getByTestId("send-chat").click();

    const systemMessage = page.locator(".chat-system-message").last();
    await expect(systemMessage).toHaveText("无法启动团队 Agent：Agent 已停用");
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(systemMessage).toHaveText("Unable to start the team Agent: Agent is disabled");
    await page.reload();
    await expect(systemMessage).toHaveText("Unable to start the team Agent: Agent is disabled");
    await page.getByRole("button", { name: "中文", exact: true }).click();
    await expect(systemMessage).toHaveText("无法启动团队 Agent：Agent 已停用");
    await expect(page.getByTestId("chat-transcript")).toContainText(prompt);
  } finally {
    const restoredResponse = await request.put("/api/agent/settings", { data: { provider, model, enabled } });
    expect(restoredResponse.ok()).toBe(true);
  }
});
