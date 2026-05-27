import { runWorkspaceCommand } from "../runner.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../workspace.js";
import type { AgentReport, AgentTaskInput } from "./types.js";

export async function runMockAgentTask({
  workspaceRoot,
  events,
  tasks,
  taskId,
  agentId
}: AgentTaskInput): Promise<AgentReport> {
  const task = tasks.getTask(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  tasks.markRunning(taskId);
  events.append({
    type: "agent_plan",
    roomId: task.roomId,
    taskId,
    memberId: agentId,
    payload: {
      plan: [
        "Read src/hello.ts",
        "Update the greeting inside the authorized path",
        "Run npm test",
        "Report the result"
      ]
    }
  });

  const targetPath = "src/hello.ts";
  if (!tasks.canEdit(taskId, targetPath)) {
    events.append({
      type: "approval_requested",
      roomId: task.roomId,
      taskId,
      memberId: agentId,
      payload: { reason: "file_not_authorized", path: targetPath }
    });
    throw new Error("File edit is not authorized");
  }

  const original = await readWorkspaceFile(workspaceRoot, targetPath);
  const updated = original.includes("collaboration")
    ? original
    : `${original.trimEnd()}\nexport const collaboration = 'human-agent';\n`;
  await writeWorkspaceFile(workspaceRoot, targetPath, updated);
  events.append({
    type: "agent_edited_file",
    roomId: task.roomId,
    taskId,
    memberId: agentId,
    payload: { path: targetPath }
  });

  const command = "npm test";
  const run = await runWorkspaceCommand({
    workspaceRoot,
    command,
    whitelist: task.commandWhitelist,
    events,
    roomId: task.roomId,
    taskId,
    initiatorId: agentId,
    timeoutMs: 30_000
  });

  const report: AgentReport = {
    taskId,
    agentId,
    summary: `MockAgent updated ${targetPath} and ran ${command} with exit code ${run.exitCode}.`,
    commands: [command],
    risks: run.exitCode === 0 ? [] : ["Command failed; inspect output for details."]
  };

  events.append({
    type: "agent_reported",
    roomId: task.roomId,
    taskId,
    memberId: agentId,
    payload: report
  });
  tasks.markCompleted(taskId, report.summary);

  return report;
}
