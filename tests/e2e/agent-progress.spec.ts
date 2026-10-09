import { expect, test } from "@playwright/test";
import { openAs } from "./helpers";

test("普通任务持续无输出时显示等待时间、停滞说明与可用的取消按钮", async ({ page }) => {
  test.setTimeout(95_000);
  await openAs(page, "Activity Member");
  await page.getByTestId("collab-tab-agent").click();
  await page.getByTestId("agent-prompt").fill("fake-delay=80000 fake-reply=任务结束");
  await page.getByTestId("agent-run-submit").click();
  const activity = page.getByTestId("agent-run-progress").first();
  await expect(activity).toContainText("实时活动");
  await expect(page.getByTestId("agent-trace-disclosure").last()).toContainText("该模型未提供推理过程");
  const waiting = activity.getByTestId("agent-response-wait");
  await expect(waiting).toContainText("已等待模型响应", { timeout: 30_000 });
  await expect(waiting.getByRole("button", { name: "取消任务" })).toBeEnabled();
  await expect(waiting).toContainText("可能较慢或已卡住，可取消重试", { timeout: 50_000 });
  await waiting.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByTestId("agent-selected-run").last()).toContainText("Cancelled", { timeout: 15_000 });
});

test("普通任务的 reasoning 增量进入工作详情并可收起或展开阅读", async ({ page }) => {
  await openAs(page, "Reasoning Member");
  await page.getByTestId("collab-tab-agent").click();
  await page.getByTestId("agent-prompt").fill("fake-delay=6000 fake-reply=检查完成\nfake-reasoning=检查调用方。|保留原有接口。");
  await page.getByTestId("agent-run-submit").click();
  const reasoning = page.getByTestId("agent-reasoning").first();
  await expect(reasoning).toContainText("检查调用方。");
  await expect(reasoning).toContainText("保留原有接口。");
  const details = page.getByTestId("agent-trace-disclosure").last();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.getByTestId("agent-reasoning")).toHaveCount(1);
  await expect(details.getByTestId("agent-trace")).toContainText("Started working in the project");
  await details.locator("summary").click();
  await expect(reasoning.locator("pre")).toBeHidden();
  await details.locator("summary").click();
  await expect(reasoning.locator("pre")).toBeVisible();
  await expect(reasoning.locator("pre")).toHaveText("检查调用方。\n保留原有接口。\n");
  await expect(page.getByTestId("agent-message-list")).toContainText("Completed", { timeout: 15_000 });
});
