import type {
  AgentReport,
  EventRecord,
  RoomMember,
  RoomState,
  RunRecord,
  TaskRecord,
  WorkspaceNode
} from "./types";

export async function getHealth(): Promise<{
  ok: true;
  workspaceRoot: string;
  roomId: string;
}> {
  return request("/api/health");
}

export async function getRoom(roomId: string): Promise<RoomState> {
  const response = await request<{ room: RoomState }>(`/api/rooms/${roomId}`);
  return response.room;
}

export async function joinRoom(
  roomId: string,
  name: string,
  kind: "human" | "agent" = "human",
  clientId: string,
  provider?: string
): Promise<RoomMember> {
  const response = await request<{ member: RoomMember }>(
    `/api/rooms/${roomId}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, clientId, provider })
    }
  );
  return response.member;
}

export async function getAllowedCommands(): Promise<string[]> {
  const response = await request<{ commands: string[] }>("/api/config/commands");
  return response.commands;
}

export async function getWorkspaceTree(): Promise<WorkspaceNode[]> {
  const response = await request<{ tree: WorkspaceNode[] }>(
    "/api/workspace/tree"
  );
  return response.tree;
}

export async function readWorkspaceFile(path: string): Promise<string> {
  const response = await request<{ content: string }>(
    `/api/workspace/file?path=${encodeURIComponent(path)}`
  );
  return response.content;
}

export async function writeWorkspaceFile(path: string, content: string) {
  await request("/api/workspace/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content })
  });
}

export async function createWorkspaceFile(path: string, content = "") {
  const response = await request<{ tree: WorkspaceNode[] }>("/api/workspace/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content })
  });
  return response.tree;
}

export async function createWorkspaceDirectory(path: string) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    "/api/workspace/directory",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    }
  );
  return response.tree;
}

export async function renameWorkspacePath(fromPath: string, toPath: string) {
  const response = await request<{ tree: WorkspaceNode[] }>("/api/workspace/path", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromPath, toPath })
  });
  return response.tree;
}

export async function deleteWorkspacePath(path: string) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    `/api/workspace/path?path=${encodeURIComponent(path)}`,
    {
      method: "DELETE"
    }
  );
  return response.tree;
}

export async function getEvents(): Promise<EventRecord[]> {
  const response = await request<{ events: EventRecord[] }>("/api/events");
  return response.events;
}

export async function createTask(input: {
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
}): Promise<TaskRecord> {
  const response = await request<{ task: TaskRecord }>("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return response.task;
}

export async function getTasks(roomId: string): Promise<TaskRecord[]> {
  const response = await request<{ tasks: TaskRecord[] }>(
    `/api/tasks?roomId=${encodeURIComponent(roomId)}`
  );
  return response.tasks;
}

export async function runMockAgent(
  taskId: string,
  agentId: string
): Promise<AgentReport> {
  const response = await request<{ report: AgentReport }>(
    `/api/tasks/${taskId}/agent/mock/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId })
    }
  );
  return response.report;
}

export async function runConfiguredAgent(
  taskId: string,
  agentId: string
): Promise<AgentReport> {
  const response = await request<{ report: AgentReport }>(
    `/api/tasks/${taskId}/agent/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId })
    }
  );
  return response.report;
}

export async function runQuickCommand(
  command: string,
  initiatorId: string
): Promise<RunRecord> {
  const response = await request<{ run: RunRecord }>("/api/runner/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, initiatorId })
  });
  return response.run;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}
