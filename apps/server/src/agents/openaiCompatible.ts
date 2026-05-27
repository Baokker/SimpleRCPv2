import { runWorkspaceCommand } from "../runner.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../workspace.js";
import type { AgentConfig } from "../config.js";
import type { AgentAction, AgentReport, AgentTaskInput } from "./types.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface AgentActionEnvelope {
  actions?: AgentAction[];
}

export async function runOpenAICompatibleAgentTask(
  input: AgentTaskInput,
  config: AgentConfig,
  fetchImpl: typeof fetch = fetch
): Promise<AgentReport> {
  if (!config.apiKey) {
    throw new Error("Agent API key is required");
  }

  const task = input.tasks.getTask(input.taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  input.tasks.markRunning(input.taskId);
  const response = await fetchImpl(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an AI coding collaborator. Return only JSON with an actions array. Supported action types: message, edit_file, run_command, final_report."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: {
              title: task.title,
              description: task.description,
              acceptanceTarget: task.acceptanceTarget,
              editablePaths: task.editablePaths,
              commandWhitelist: task.commandWhitelist
            },
            recentEvents: input.events.list().slice(-20)
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Agent provider request failed: ${response.status}`);
  }

  const completion = (await response.json()) as ChatCompletionResponse;
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Agent provider returned no content");
  }

  let envelope: AgentActionEnvelope;
  try {
    envelope = JSON.parse(content) as AgentActionEnvelope;
  } catch (error) {
    input.events.append({
      type: "agent_error",
      roomId: task.roomId,
      taskId: task.id,
      memberId: input.agentId,
      payload: { message: "Agent returned invalid JSON" }
    });
    throw error;
  }

  const actions = (envelope.actions ?? []).slice(0, 6);
  let report: AgentReport | undefined;
  const commands: string[] = [];
  const risks: string[] = [];

  for (const action of actions) {
    if (action.type === "message") {
      input.events.append({
        type: "agent_message",
        roomId: task.roomId,
        taskId: task.id,
        memberId: input.agentId,
        payload: { text: action.text }
      });
      continue;
    }

    if (action.type === "edit_file") {
      if (!input.tasks.canEdit(task.id, action.path)) {
        input.events.append({
          type: "approval_requested",
          roomId: task.roomId,
          taskId: task.id,
          memberId: input.agentId,
          payload: { reason: "file_not_authorized", path: action.path }
        });
        continue;
      }
      await readWorkspaceFile(input.workspaceRoot, action.path);
      await writeWorkspaceFile(input.workspaceRoot, action.path, action.content);
      input.events.append({
        type: "agent_edited_file",
        roomId: task.roomId,
        taskId: task.id,
        memberId: input.agentId,
        payload: { path: action.path }
      });
      continue;
    }

    if (action.type === "run_command") {
      if (!input.tasks.canRunCommand(task.id, action.command)) {
        input.events.append({
          type: "approval_requested",
          roomId: task.roomId,
          taskId: task.id,
          memberId: input.agentId,
          payload: { reason: "command_not_authorized", command: action.command }
        });
        continue;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: input.workspaceRoot,
        command: action.command,
        whitelist: task.commandWhitelist,
        events: input.events,
        roomId: task.roomId,
        taskId: task.id,
        initiatorId: input.agentId,
        timeoutMs: 30_000
      });
      commands.push(action.command);
      if (run.exitCode !== 0) {
        risks.push(`Command ${action.command} exited with ${run.exitCode}.`);
      }
      continue;
    }

    if (action.type === "final_report") {
      report = {
        taskId: task.id,
        agentId: input.agentId,
        summary: action.summary,
        commands: action.commands ?? commands,
        risks: action.risks ?? risks
      };
    }
  }

  report ??= {
    taskId: task.id,
    agentId: input.agentId,
    summary: "Agent completed without a final report action.",
    commands,
    risks
  };

  input.events.append({
    type: "agent_reported",
    roomId: task.roomId,
    taskId: task.id,
    memberId: input.agentId,
    payload: report
  });
  input.tasks.markCompleted(task.id, report.summary);

  return report;
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
