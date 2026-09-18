import type {
  ChatMessage,
  EventRecord,
  ProjectRecord,
  RoomMember,
  RoomState,
  WorkspaceFileLoadResult,
  WorkspaceNode
} from "./types";

export async function getProjects() {
  const response = await request<{ projects: ProjectRecord[] }>("/api/projects");
  return response.projects;
}

export async function createProject(name: string) {
  return request<{ project: ProjectRecord }>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export async function deleteProject(projectId: string) {
  return request<{ deletedProjectId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" }
  );
}

export async function importExistingProject(name: string, path: string) {
  return request<{ project: ProjectRecord }>("/api/projects/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path })
  });
}

export async function importZipProject(name: string, archive: File) {
  return request<{ project: ProjectRecord; filteredEntries: number }>(
    `/api/projects/import-zip?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: archive
    }
  );
}

export async function getProject(projectId: string) {
  return request<{ project: ProjectRecord; roomId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`
  );
}

export async function getRoom(projectId: string): Promise<RoomState> {
  const response = await request<{ room: RoomState }>(
    `${projectPath(projectId)}/room`
  );
  return response.room;
}

export async function joinRoom(
  projectId: string,
  name: string,
  role: string,
  userId: string,
  connectionId: string
): Promise<RoomMember> {
  const response = await request<{ member: RoomMember }>(
    `${projectPath(projectId)}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, userId, connectionId })
    }
  );
  return response.member;
}

export function sendConnectionOffline(
  projectId: string,
  connectionId: string
) {
  const endpoint = `${projectPath(projectId)}/connections/${encodeURIComponent(connectionId)}/offline`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([], { type: "application/json" }));
    return;
  }
  void fetch(endpoint, { method: "POST", keepalive: true });
}

export async function getWorkspaceDirectory(
  projectId: string,
  path: string
): Promise<WorkspaceNode[]> {
  const response = await request<{ tree: WorkspaceNode[] }>(
    `${projectPath(projectId)}/workspace/directory?path=${encodeURIComponent(path)}`
  );
  return response.tree;
}

export async function readWorkspaceFile(
  projectId: string,
  path: string,
  force = false
): Promise<WorkspaceFileLoadResult> {
  const query = new URLSearchParams({ path });
  if (force) query.set("force", "true");
  return request(
    `${projectPath(projectId)}/workspace/file?${query.toString()}`
  );
}

export async function createWorkspaceFile(
  projectId: string,
  path: string,
  initiatorId: string,
  content = ""
) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    `${projectPath(projectId)}/workspace/file`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, initiatorId })
    }
  );
  return response.tree;
}

export async function createWorkspaceDirectory(
  projectId: string,
  path: string,
  initiatorId: string
) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    `${projectPath(projectId)}/workspace/directory`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, initiatorId })
    }
  );
  return response.tree;
}

export async function renameWorkspacePath(
  projectId: string,
  fromPath: string,
  toPath: string,
  initiatorId: string
) {
  const response = await request<{ tree: WorkspaceNode[] }>(
    `${projectPath(projectId)}/workspace/path`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPath, toPath, initiatorId })
    }
  );
  return response.tree;
}

export async function deleteWorkspacePath(
  projectId: string,
  path: string,
  initiatorId: string
) {
  return request<{ tree: WorkspaceNode[] }>(
    `${projectPath(projectId)}/workspace/path?path=${encodeURIComponent(path)}&initiatorId=${encodeURIComponent(initiatorId)}`,
    { method: "DELETE" }
  );
}

export async function getEvents(projectId: string): Promise<EventRecord[]> {
  const response = await request<{ events: EventRecord[] }>(
    `${projectPath(projectId)}/events`
  );
  return response.events;
}

export async function getChatMessages(
  projectId: string
): Promise<ChatMessage[]> {
  const response = await request<{ messages: ChatMessage[] }>(
    `${projectPath(projectId)}/chat`
  );
  return response.messages;
}

export async function sendChatMessage(
  projectId: string,
  input: { authorId: string; authorName: string; text: string }
) {
  return request<{ message: ChatMessage }>(`${projectPath(projectId)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

function projectPath(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("Cannot reach the SimpleRCP server");
  }
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const message = contentType.includes("application/json")
      ? ((await response.json()) as { error?: string }).error
      : undefined;
    throw new Error(message ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
