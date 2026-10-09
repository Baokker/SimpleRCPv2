import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { AgentRun } from "@simplercp/shared";
import { openAs } from "./helpers";

const evidence = new URL("../../docs/foundation/evidence/agent-paid-check/", import.meta.url);

async function showRecordedProgress(page: Page, run: AgentRun, memberId: string) {
  await openAs(page, "Recorded Progress Reader");
  await page.evaluate(async ({ run, memberId }) => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const rendererPath = "/node_modules/.vite/deps/react-dom_client.js";
    const componentPath = "/src/components/AgentRunProgress.tsx";
    const responsePath = "/src/components/AgentResponse.tsx";
    const { default: React } = await import(reactPath);
    const { default: { createRoot } } = await import(rendererPath);
    const { AgentRunProgress, AgentRunStatus } = await import(componentPath);
    const { AgentResponse } = await import(responsePath);
    const container = document.createElement("section");
    container.dataset.testid = "recorded-progress";
    document.body.append(container);
    createRoot(container).render(React.createElement(React.Fragment, null,
      React.createElement(AgentRunProgress, { run, memberId }),
      React.createElement(AgentRunStatus, { run, memberId }),
      React.createElement(AgentResponse, { run })
    ));
  }, { run, memberId });
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
