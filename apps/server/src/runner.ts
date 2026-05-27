import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { RunRecord } from "./types.js";

export interface RunWorkspaceCommandInput {
  workspaceRoot: string;
  command: string;
  whitelist: string[];
  events: EventLog;
  roomId: string;
  taskId: string;
  initiatorId: string;
  timeoutMs: number;
}

export async function runWorkspaceCommand({
  workspaceRoot,
  command,
  whitelist,
  events,
  roomId,
  taskId,
  initiatorId,
  timeoutMs
}: RunWorkspaceCommandInput): Promise<RunRecord> {
  if (!whitelist.includes(command)) {
    events.append({
      type: "approval_requested",
      roomId,
      taskId,
      memberId: initiatorId,
      payload: { reason: "command_not_authorized", command }
    });
    throw new Error("Command is not authorized");
  }

  const run: RunRecord = {
    id: nanoid(10),
    roomId,
    taskId,
    initiatorId,
    command,
    exitCode: null,
    output: ""
  };

  events.append({
    type: "command_started",
    roomId,
    taskId,
    memberId: initiatorId,
    payload: { runId: run.id, command }
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      settled = true;
      reject(new Error("Command timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      appendOutput(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendOutput(chunk.toString());
    });
    child.on("error", (error) => {
      if (settled) return;
      clearTimeout(timeout);
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timeout);
      run.exitCode = code ?? 1;
      events.append({
        type: "command_completed",
        roomId,
        taskId,
        memberId: initiatorId,
        payload: {
          runId: run.id,
          command,
          exitCode: run.exitCode,
          output: summarize(run.output)
        }
      });
      settled = true;
      resolve(run);
    });

    function appendOutput(output: string) {
      run.output += output;
      events.append({
        type: "command_output",
        roomId,
        taskId,
        memberId: initiatorId,
        payload: {
          runId: run.id,
          output
        }
      });
    }
  });
}

function summarize(output: string) {
  return output.length > 2000 ? `${output.slice(0, 2000)}\n...` : output;
}
