import type {
  AgentRun,
  AgentSession,
  AgentRuntimeStatus,
  AgentPromptContext,
  AgentSettings,
  AgentSettingsResponse,
  AgentTraceEvent,
  ChatMessage,
  EventRecord,
  ProjectRecord,
  ProjectParticipant,
  RoomMember,
  RoomState,
  WorkspaceFileLoadResult,
  WorkspaceNode
} from "./types";
import type {
  KnowledgeAnchorResolution,
  KnowledgeCard,
  KnowledgeCardInput,
  KnowledgeCardType,
  KnowledgeGuideItem,
  KnowledgeScope,
  KnowledgeTimelineItem
} from "./types";
import { activeMemberId, rememberMember, storedMemberId } from "./memberIdentity";

export interface ServerInfo {
  ok: boolean;
  dataDir: string;
  publicOrigin: string;
  features: {
    terminal: boolean;
    knowledge?: boolean;
    knowledgeMode?: "off" | "capture" | "inject" | "full";
  };
}

export function getServerInfo() {
  return request<ServerInfo>("/api/health");
}

export async function getAgentSettings() {
  return request<AgentSettingsResponse>("/api/agent/settings");
}

export async function updateAgentSettings(settings: AgentSettings) {
  return request<AgentSettingsResponse>("/api/agent/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export async function getAgentStatus() {
  return request<AgentRuntimeStatus>("/api/agent/status");
}

export async function getAgentRuns(projectId: string) {
  const response = await request<{ runs: AgentRun[] }>(
    `${projectPath(projectId)}/agent/runs`
  );
  return response.runs;
}

export async function getAgentSessions(projectId: string) {
  const response = await request<{ sessions: AgentSession[] }>(
    `${projectPath(projectId)}/agent/sessions`
  );
  return response.sessions;
}

export async function getTeamAgents(projectId: string) {
  const response = await request<{ agents: AgentSession[] }>(
    `${projectPath(projectId)}/team-agents`
  );
  return response.agents;
}

export async function createTeamAgent(
  projectId: string,
  input: { name: string; description?: string }
) {
  return request<{ agent: AgentSession }>(`${projectPath(projectId)}/team-agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function createAgentSession(
  projectId: string,
  input: { title?: string }
) {
  return request<{ session: AgentSession }>(`${projectPath(projectId)}/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title })
  });
}

export async function createAgentSessionRun(
  projectId: string,
  sessionId: string,
  input: { prompt: string; contexts?: AgentPromptContext[]; knowledge?: { excludeCardIds?: string[]; disabled?: boolean } }
) {
  return request<{ run: AgentRun }>(
    `${projectPath(projectId)}/agent/sessions/${encodeURIComponent(sessionId)}/runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt, contexts: input.contexts, knowledge: input.knowledge })
    }
  );
}

export async function previewAgentKnowledge(
  projectId: string,
  input: { prompt: string; contexts?: AgentPromptContext[]; knowledge?: { excludeCardIds?: string[]; disabled?: boolean } }
) {
  return request<{
    records: Array<{ id: string; title: string; score: number; chars: number }>;
    activeFiles: string[];
    excludedByUser: string[];
    totalChars: number;
    reviewCards?: Array<{ id: string; title: string }>;
  }>(`${projectPath(projectId)}/agent/knowledge/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function getAgentTrace(projectId: string, runId: string) {
  const response = await request<{ events: AgentTraceEvent[] }>(
    `${projectPath(projectId)}/agent/runs/${encodeURIComponent(runId)}/trace`
  );
  return response.events;
}

export async function downloadAgentTrace(projectId: string, runId: string) {
  const response = await fetch(`${projectPath(projectId)}/agent/runs/${encodeURIComponent(runId)}/trace?download=true`, {
    headers: { "X-SimpleRCP-Member": storedMemberId(projectId) ?? "" }
  });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `trace-${runId}.jsonl`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function cancelAgentRun(
  projectId: string,
  runId: string
) {
  return request<{ run: AgentRun }>(
    `${projectPath(projectId)}/agent/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
}

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

export async function getParticipants(projectId: string) {
  const response = await request<{ participants: ProjectParticipant[] }>(
    `${projectPath(projectId)}/participants`
  );
  return response.participants;
}

export async function joinRoom(
  projectId: string,
  name: string,
  role: string,
  memberId: string | undefined,
  connectionId: string
): Promise<{ member: RoomMember; participant: ProjectParticipant }> {
  const result = await request<{ member: RoomMember; participant: ProjectParticipant }>(
    `${projectPath(projectId)}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, memberId, connectionId })
    }
  );
  rememberMember(projectId, result.member.id);
  return result;
}

export function sendConnectionOffline(
  projectId: string,
  connectionId: string
) {
  const endpoint = `${projectPath(projectId)}/connections/${encodeURIComponent(connectionId)}/offline`;
  void request(endpoint, { method: "POST", keepalive: true });
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
      body: JSON.stringify({ path, content })
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
      body: JSON.stringify({ path })
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
      body: JSON.stringify({ fromPath, toPath })
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
    `${projectPath(projectId)}/workspace/path?path=${encodeURIComponent(path)}`,
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
  input: { text: string }
) {
  return request<{ message: ChatMessage }>(`${projectPath(projectId)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input.text })
  });
}

export async function getKnowledgeCards(projectId: string, file?: string) {
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return request<{ cards: KnowledgeCard[]; resolutions: KnowledgeAnchorResolution[] }>(
    `${projectPath(projectId)}/knowledge/cards${query}`
  );
}

export async function createKnowledgeCard(projectId: string, input: KnowledgeCardInput) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateKnowledgeCard(projectId: string, id: string, patch: Record<string, unknown>) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export async function confirmKnowledgeCard(projectId: string, id: string, edited = false, durationMs?: number, patch?: KnowledgeCardInput) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edited, durationMs, patch })
  });
}

export async function archiveKnowledgeCard(projectId: string, id: string, reason?: string) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export async function markKnowledgeCardViewed(projectId: string, id: string) {
  return request<{ ok: boolean }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

export async function reanchorKnowledgeCard(
  projectId: string,
  id: string,
  anchorIndex: number,
  selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/anchors/${anchorIndex}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection })
  });
}

export async function getKnowledgeGuide(projectId: string, file?: string) {
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return request<{ items: KnowledgeGuideItem[] }>(`${projectPath(projectId)}/knowledge/guide${query}`);
}

export async function getKnowledgeTimeline(projectId: string, file?: string) {
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return request<{ items: KnowledgeTimelineItem[] }>(`${projectPath(projectId)}/knowledge/timeline${query}`);
}

export async function generateKnowledgeDemo(projectId: string) {
  return request<{ cards: KnowledgeCard[] }>(`${projectPath(projectId)}/knowledge/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

function projectPath(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function getKnowledgeInbox(projectId: string, all = false) {
  return request<{ suggestions: import("./types").KnowledgeSuggestion[]; warnings: import("./types").KnowledgeRiskWarning[] }>(`${projectPath(projectId)}/knowledge/inbox${all ? "?view=all" : ""}`);
}
export function getKnowledgeActivity(projectId: string) {
  return request<{ items: import("./types").KnowledgeActivityItem[] }>(`${projectPath(projectId)}/knowledge/activity`);
}
export function reviewKnowledgeAnchor(projectId: string, id: string, input: { action: "valid" | "file" | "reassociate"; anchorIndex?: number; file?: string; selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}
export function assistKnowledgeCreation(projectId: string, description: string, selection?: { file: string; selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }) {
  return request<{ draft: { type: KnowledgeCardType; title: string; summary: string; content: string; tags: string[] }; fallback: boolean; applicability: { kind: "block" | "project" | "glob"; file?: string; patterns?: string[] } }>(`${projectPath(projectId)}/knowledge/manual-assist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, selection }) });
}
export function importKnowledgeDocuments(projectId: string, files?: string[]) {
  return request<{ drafts: Array<{ suggestionId: string; suggestion: import("./types").KnowledgeSuggestion }> }>(`${projectPath(projectId)}/knowledge/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
}
export function exportKnowledgeToWorkspace(projectId: string) {
  return request<{ path: string; markdown: string }>(`${projectPath(projectId)}/knowledge/export/workspace`, { method: "POST" });
}
export function getKnowledgeSuggestion(projectId: string, id: string) {
  return request<{ suggestion: import("./types").KnowledgeSuggestion }>(`${projectPath(projectId)}/knowledge/inbox/${encodeURIComponent(id)}`);
}
export function markKnowledgeSuggestionsRead(projectId: string, ids: string[]) {
  return request<{ ok: boolean }>(`${projectPath(projectId)}/knowledge/inbox/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
}
export function markKnowledgeWarningsRead(projectId: string, ids: string[]) {
  return request<{ ok: boolean }>(`${projectPath(projectId)}/knowledge/inbox/warnings/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
}
export function resolveKnowledgeSuggestion(projectId: string, id: string, action: "accept" | "ai-draft" | "discard" | "merge", cardId?: string) {
  return request<{ card?: KnowledgeCard; suggestion?: import("./types").KnowledgeSuggestion }>(`${projectPath(projectId)}/knowledge/inbox/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId }) });
}
export function captureKnowledgeFromChat(projectId: string, messageIds: string[]) {
  return request<{ suggestion: import("./types").KnowledgeSuggestion }>(`${projectPath(projectId)}/knowledge/from-chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageIds }) });
}
export function disputeKnowledgeSuggestion(projectId: string, id: string, reason: string) {
  return request<{ suggestion: import("./types").KnowledgeSuggestion }>(`${projectPath(projectId)}/knowledge/inbox/${encodeURIComponent(id)}/dispute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
}
export function requestKnowledgeTeamScope(projectId: string, id: string) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/scope/request-team`, { method: "POST" });
}
export function getPendingKnowledgeTeamCards(projectId: string) {
  return request<{ cards: KnowledgeCard[] }>(`${projectPath(projectId)}/knowledge/cards/pending-team`);
}
export function confirmKnowledgeTeamScope(projectId: string, id: string) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/scope/confirm-team`, { method: "POST" });
}
export function relateKnowledgeCards(projectId: string, id: string, relation: { kind: "supersedes" | "contradicts" | "duplicates" | "refines"; cardId: string }) {
  return request<{ card: KnowledgeCard }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/relations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(relation) });
}
export function getKnowledgeRelationCandidates(projectId: string, id: string) {
  return request<{ candidates: Array<{ card: KnowledgeCard; score: number }> }>(`${projectPath(projectId)}/knowledge/cards/${encodeURIComponent(id)}/relations/candidates`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const projectId = path.match(/^\/api\/projects\/([^/?]+)/)?.[1];
  const headers = new Headers(init?.headers);
  const memberId = projectId && !["import", "import-zip"].includes(projectId)
    ? storedMemberId(decodeURIComponent(projectId)) : activeMemberId();
  if (memberId) headers.set("X-SimpleRCP-Member", memberId);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
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
