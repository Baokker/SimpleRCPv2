import type {
  EventRecord,
  RoomMember,
  RoomState,
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
  kind: "human" | "agent" = "human"
): Promise<RoomMember> {
  const response = await request<{ member: RoomMember }>(
    `/api/rooms/${roomId}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind })
    }
  );
  return response.member;
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

export async function getEvents(): Promise<EventRecord[]> {
  const response = await request<{ events: EventRecord[] }>("/api/events");
  return response.events;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}
