import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { AgentRun } from "@simplercp/shared";
import { createAgentProgress } from "../../apps/server/src/agent/agentProgress";
import { createTraceStore } from "../../apps/server/src/agent/traceStore";
import { openAs } from "./helpers";

test("真实 OpenCode 记录回放显示部分正文，完成后保留全部说明且不重复正文", async ({ page }) => {
  const evidence = new URL("../../docs/conflict-guard/evidence/round2-dual-agent/", import.meta.url);
  const runs: AgentRun[] = JSON.parse(await fs.readFile(new URL("runs.json", evidence), "utf8"));
  const recorded = runs.find((run) => run.id === "UlCzhJhKE5Dl");
  if (!recorded) throw new Error("没有对应的真实任务记录");
  const events = await createTraceStore(fileURLToPath(new URL(`run-${recorded.id}.jsonl`, evidence))).list();
  const progress = createAgentProgress(recorded.startedAt!);
  let partial: AgentRun["activity"];
  for (const event of events) {
    if (!event.type.startsWith("opencode.") || !event.data) continue;
    progress.event({ type: event.type.slice("opencode.".length), data: event.data }, event.timestamp);
    if (!partial && event.type === "opencode.message.part.delta" && progress.snapshot().messages?.some((part) => part.text.length > 20)) partial = progress.snapshot();
  }
  if (!partial) throw new Error("真实记录没有部分正文");
  await openAs(page, "Response Reader");
  await page.evaluate(async (run) => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const rendererPath = "/node_modules/.vite/deps/react-dom_client.js";
    const componentPath = "/src/components/AgentResponse.tsx";
    const { default: React } = await import(reactPath);
    const { default: { createRoot } } = await import(rendererPath);
    const { AgentResponse } = await import(componentPath);
    const container = document.createElement("section");
    document.body.append(container);
    const root = createRoot(container);
    root.render(React.createElement(AgentResponse, { run }));
    Object.assign(window, { updateRecordedResponse(nextRun: AgentRun) { root.render(React.createElement(AgentResponse, { run: nextRun })); } });
  }, { ...recorded, status: "running", finishedAt: undefined, output: undefined, activity: partial });
  const response = page.getByTestId("agent-response");
  const partialText = partial.messages!.filter((part) => part.sessionId === recorded.runtimeSessionId && part.text.trim()).map((part) => part.text).join("\n\n");
  await expect(response).toHaveText(partialText);
  await expect(response).not.toContainText("You are working only on the project");
  const complete = { ...recorded, activity: progress.snapshot() };
  await page.evaluate((run) => {
    (window as typeof window & { updateRecordedResponse(run: AgentRun): void }).updateRecordedResponse(run);
  }, complete);
  const completeText = complete.activity.messages!.filter((part) => part.sessionId === recorded.runtimeSessionId && part.text.trim()).map((part) => part.text).join("\n\n");
  await expect(response).toHaveText(completeText);
  await expect(response).toHaveCount(1);
  expect(completeText).toContain(recorded.output!);
});
