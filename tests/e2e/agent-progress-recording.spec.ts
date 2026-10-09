import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { AgentRun, AgentTraceEvent } from "@simplercp/shared";
import { openAs } from "./helpers";

const evidence = new URL("../../docs/foundation/evidence/agent-paid-check/", import.meta.url);

async function showRecordedProgress(page: Page, run: AgentRun, memberId: string, variant: "personal" | "team" = "personal") {
  const record: { trace: { events: AgentTraceEvent[] } } = JSON.parse(await fs.readFile(new URL(`run-${run.id}-completed.json`, evidence), "utf8"));
  const trace = record.trace.events.filter((event) => Date.parse(event.timestamp) <= Date.parse(run.activity!.updatedAt));
  await openAs(page, "Recorded Progress Reader");
  await page.evaluate(async ({ run, memberId, trace, variant }) => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const rendererPath = "/node_modules/.vite/deps/react-dom_client.js";
    const componentPath = "/src/components/AgentRunProgress.tsx";
    const responsePath = "/src/components/AgentResponse.tsx";
    const detailsPath = "/src/components/AgentWorkDetails.tsx";
    const { default: React } = await import(reactPath);
    const { default: { createRoot } } = await import(rendererPath);
    const { AgentRunProgress, AgentRunStatus } = await import(componentPath);
    const { AgentResponse } = await import(responsePath);
    const { AgentWorkDetails } = await import(detailsPath);
    const container = document.createElement("section");
    container.dataset.testid = "recorded-progress";
    document.body.append(container);
    const root = createRoot(container);
    const render = (nextRun: AgentRun, nextTrace: AgentTraceEvent[]) => root.render(React.createElement(React.Fragment, null,
      React.createElement(AgentRunProgress, { run: nextRun, memberId }),
      React.createElement(AgentRunStatus, { run: nextRun, memberId }),
      React.createElement(AgentResponse, { run: nextRun }),
      React.createElement(AgentWorkDetails, { run: nextRun, trace: nextTrace, variant })
    ));
    render(run, trace);
    Object.assign(window, { updateRecordedWorkDetails: render });
  }, { run, memberId, trace, variant });
  return page.getByTestId("recorded-progress");
}

test("真实团队问题记录按照查看者身份显示回答者，等待回答期间不提示模型停顿", async ({ page }) => {
  const { run }: { run: AgentRun } = JSON.parse(await fs.readFile(new URL("question-progress.json", evidence), "utf8"));
  const recordedRuns: AgentRun[] = JSON.parse(await fs.readFile(new URL("runs.json", evidence), "utf8"));
  const viewer = recordedRuns.find((candidate) => candidate.memberName === "Alice")!;
  expect(run.questions).toHaveLength(1);
  const container = await showRecordedProgress(page, run, viewer.memberId);
  await expect(container.getByTestId("agent-run-progress")).toContainText("等待 Bob 回答");
  await expect(container.locator(".agent-run-live-status")).toContainText("等待 Bob 回答");
  await expect(container).not.toContainText("等待你的回答");
  await expect(container.getByTestId("agent-response-wait")).toHaveCount(0);
  await expect(container.getByTestId("agent-tool-wait")).toHaveCount(0);
});

test("真实问题记录向任务发起者显示等待回答", async ({ page }) => {
  const { run }: { run: AgentRun } = JSON.parse(await fs.readFile(new URL("question-progress.json", evidence), "utf8"));
  const container = await showRecordedProgress(page, run, run.memberId);
  await expect(container.getByTestId("agent-run-progress")).toContainText("等待你的回答");
  await expect(container.locator(".agent-run-live-status")).toContainText("等待你的回答");
});

test("真实工具记录显示执行提示和已经收到的正文，工具等待与模型等待分别显示", async ({ page }) => {
  const { run }: { run: AgentRun } = JSON.parse(await fs.readFile(new URL("tool-progress.json", evidence), "utf8"));
  const container = await showRecordedProgress(page, run, run.memberId);
  await expect(container.getByTestId("agent-current-tools")).toContainText("bash");
  await expect(container.getByTestId("agent-current-tools")).toContainText("sleep 30");
  await expect(container.getByTestId("agent-current-tools")).toContainText("已持续");
  await expect(container.getByTestId("agent-tool-wait")).toContainText("工具仍在执行");
  await expect(container.getByTestId("agent-response-wait")).toHaveCount(0);
  await expect(container).not.toContainText("已等待模型响应");
  await expect(container.getByTestId("agent-response")).toHaveText("开始检查实时正文 STREAMING_20261009");
  await expect(container.getByTestId("agent-reasoning")).toContainText("sleep 30");
});

for (const variant of ["personal", "team"] as const) {
  test(`真实 ${variant} 工具记录的推理与操作共用一个工作详情，收起后更新并在完成后保留`, async ({ page }) => {
    const { run }: { run: AgentRun } = JSON.parse(await fs.readFile(new URL("tool-progress.json", evidence), "utf8"));
    const complete: { run: AgentRun; trace: { events: AgentTraceEvent[] } } = JSON.parse(await fs.readFile(new URL(`run-${run.id}-completed.json`, evidence), "utf8"));
    const container = await showRecordedProgress(page, run, run.memberId, variant);
    const details = container.getByTestId("agent-trace-disclosure");
    const trace = details.getByTestId(variant === "team" ? "chat-agent-trace" : "agent-trace");
    await expect(details).toHaveCount(1);
    await expect(details).toHaveAttribute("open", "");
    await expect(details.getByTestId("agent-trace-summary")).toContainText("工作详情");
    await expect(details.getByTestId("agent-work-details-status")).toHaveText("实时更新");
    await expect(details.getByTestId("agent-reasoning")).toContainText("sleep 30");
    await expect(trace).toContainText("Started working in the project");
    await expect(details.locator("details")).toHaveCount(0);
    await expect(container.getByTestId("agent-run-progress").getByTestId("agent-reasoning")).toHaveCount(0);
    await details.getByTestId("agent-trace-summary").click();
    await expect(details.getByTestId("agent-reasoning").locator("pre")).toBeHidden();
    await expect(details.locator(".agent-reasoning-preview")).toBeVisible();
    await expect(container.getByTestId("agent-current-tools")).toBeVisible();

    await page.evaluate(({ run, trace }) => {
      (window as typeof window & { updateRecordedWorkDetails(run: AgentRun, trace: AgentTraceEvent[]): void }).updateRecordedWorkDetails(run, trace);
    }, { run: complete.run, trace: complete.trace.events });
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.getByTestId("agent-work-details-status")).toHaveText("已结束");
    await details.getByTestId("agent-trace-summary").click();
    await expect(details.getByTestId("agent-reasoning").locator("pre")).toHaveText(complete.run.activity!.reasoning.filter((part) => part.text.trim()).map((part) => part.text).join("\n\n"));
    await expect(trace).toContainText("Ran command");
    await expect(trace).toContainText("sleep 30");
    await expect(trace).toContainText("Run completed");
    await expect(container.getByTestId("agent-reasoning")).toHaveCount(1);
    await expect(container.getByTestId("agent-response")).toContainText("STREAMING_DONE_20261009");
  });
}
