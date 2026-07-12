import type {
  ChatMessage,
  EventRecord,
  RoomMember,
  RoomState,
  RunRecord,
  RuntimeConfig,
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
  userId: string,
  connectionId: string
): Promise<RoomMember> {
  const response = await request<{ member: RoomMember }>(
    `/api/rooms/${roomId}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, userId, connectionId })
    }
  );
  return response.member;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return request("/api/config/runtime");
}

export function sendConnectionOffline(roomId: string, connectionId: string) {
  const path = `/api/rooms/${roomId}/connections/${connectionId}/offline`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(path, new Blob([], { type: "application/json" }));
    return;
  }
  void fetch(path, { method: "POST", keepalive: true });
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

export async function createWorkspaceFile(
  path: string,
  initiatorId: string,
  content = ""
) {
  const response = await request<{ tree: WorkspaceNode[] }>("/api/workspace/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, initiatorId })
  });
  return response.tree;
}

export async function createWorkspaceDirectory(
  path: string,
  initiatorId: string
) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    "/api/workspace/directory",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, initiatorId })
    }
  );
  return response.tree;
}

export async function renameWorkspacePath(
  fromPath: string,
  toPath: string,
  initiatorId: string
) {
  const response = await request<{ tree: WorkspaceNode[] }>("/api/workspace/path", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromPath, toPath, initiatorId })
  });
  return response.tree;
}

export async function deleteWorkspacePath(path: string, initiatorId: string) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    `/api/workspace/path?path=${encodeURIComponent(path)}&initiatorId=${encodeURIComponent(initiatorId)}`,
    { method: "DELETE" }
  );
  return response.tree;
}

export async function getEvents(): Promise<EventRecord[]> {
  const response = await request<{ events: EventRecord[] }>("/api/events");
  return response.events;
}

export async function getChatMessages(roomId: string): Promise<ChatMessage[]> {
  const response = await request<{ messages: ChatMessage[] }>(
    `/api/rooms/${roomId}/chat`
  );
  return response.messages;
}

export async function sendChatMessage(
  roomId: string,
  input: { authorId: string; authorName: string; text: string }
): Promise<{ message: ChatMessage }> {
  return request(`/api/rooms/${roomId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
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
