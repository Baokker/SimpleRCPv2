export type ProjectSource = "demo" | "blank" | "directory" | "zip";

export interface ProjectRecord {
  id: string;
  name: string;
  source: ProjectSource;
  workspacePath: string;
  metadataPath?: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file";
}

export interface WorkspaceDirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children?: WorkspaceNode[];
}

export type WorkspaceNode = WorkspaceFileNode | WorkspaceDirectoryNode;

export interface ProjectParticipant {
  id: string;
  projectId: string;
  displayName: string;
  profileRole?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceFileLoadResult =
  | { status: "text"; path: string; size: number; content: string }
  | { status: "binary"; path: string; size: number }
  | { status: "large"; path: string; size: number };

export interface RoomMember {
  id: string;
  participantId: string;
  name: string;
  displayName: string;
  online: boolean;
  lastSeenAt: string;
  connectionCount: number;
  profileRole?: string;
  currentFile?: string;
}

export interface RoomState {
  id: string;
  workspaceName: string;
  members: RoomMember[];
  connections: RoomConnection[];
}

export interface RoomConnection {
  id: string;
  participantId: string;
  roomId: string;
  currentFile?: string;
  online: boolean;
  lastSeenAt: string;
}

export interface EventRecord {
  id: string;
  type: string;
  roomId?: string;
  memberId?: string;
  participantId?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface ChatMessage {
  sequence: number;
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorRole?: string;
  text: string;
  timestamp: string;
  kind?: "member" | "agent" | "system";
  agentSessionId?: string;
  runId?: string;
  mentions?: string[];
}

export interface AgentSettings {
  provider: "deepseek";
  model: string;
  enabled: boolean;
}

export interface AgentSettingsResponse extends AgentSettings {
  apiKeyConfigured: boolean;
}

export interface AgentRuntimeStatus {
  runtime: "opencode";
  state: "ready" | "disabled" | "unavailable";
  version?: string;
  model: string;
  apiKeyConfigured: boolean;
}

export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentFileChange {
  file: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
}

export interface AgentPromptContext {
  type: "file";
  path: string;
}

export interface AgentRun {
  id: string;
  projectId: string;
  memberId: string;
  initiatorMemberId?: string;
  initiatorRole?: string;
  participantId?: string;
  memberName?: string;
  prompt: string;
  contexts?: AgentPromptContext[];
  status: AgentRunStatus;
  runtime: "opencode";
  provider: "deepseek";
  model: string;
  source?: "agent-panel" | "chat";
  chatMessageId?: string;
  extraPrompt?: string;
  interruptsRunId?: string;
  interruptedByRunId?: string;
  interruptedByMemberId?: string;
  sessionId?: string;
  runtimeSessionId?: string;
  output?: string;
  error?: string;
  fileChanges?: AgentFileChange[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AgentSession {
  id: string;
  projectId: string;
  memberId: string;
  scope?: "personal" | "team";
  handle?: string;
  description?: string;
  createdByMemberId?: string;
  participantId?: string;
  memberName?: string;
  historical?: boolean;
  title: string;
  runtime: "opencode";
  runtimeSessionId?: string;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTraceEvent {
  sequence: number;
  timestamp: string;
  type: string;
  summary?: string;
  data?: Record<string, unknown>;
}

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export interface EditorSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface EditRange {
  startLine: number;
  endLine: number;
}

export interface FileEditChange {
  ranges: EditRange[];
  addedLines: number;
  removedLines: number;
}

export interface FileEditActivity extends FileEditChange {
  startedAt: string;
  finishedAt: string;
}

export type WorkspaceChange =
  | {
      type: "add" | "addDir" | "change" | "unlink" | "unlinkDir";
      path: string;
    }
  | {
      type: "rename";
      path: string;
      fromPath: string;
    };

export type ClientMessage =
  | {
      type: "ready";
      roomId: string;
      memberId: string;
      connectionId?: string;
    }
  | {
      type: "open_file";
      roomId: string;
      memberId: string;
      connectionId?: string;
      path: string;
    }
  | ({
      type: "file_edited";
      roomId: string;
      memberId: string;
      connectionId?: string;
      path: string;
    } & FileEditActivity)
  | {
      type: "cursor_change";
      roomId: string;
      memberId: string;
      connectionId?: string;
      path: string;
      position: CursorPosition;
      selection: EditorSelection;
    }
  | {
      type: "chat_message";
      roomId: string;
      memberId: string;
      connectionId?: string;
      text: string;
    };

export type ServerMessage =
  | {
      type: "presence";
      roomId: string;
      members: RoomMember[];
    }
  | {
      type: "cursor_change";
      roomId: string;
      memberId: string;
      path: string;
      position: CursorPosition;
      selection: EditorSelection;
    }
  | {
      type: "chat_message";
      roomId: string;
      memberId: string;
      text: string;
    }
  | {
      type: "event";
      event: EventRecord;
    }
  | {
      type: "workspace_changed";
      change: WorkspaceChange;
    }
  | {
      type: "file_saved";
      path: string;
    }
  | {
      type: "agent_run_updated";
      run: AgentRun;
    }
  | {
      type: "agent_trace_appended";
      runId: string;
      sequence: number;
      event: AgentTraceEvent;
    }
  | {
      type: "guard_approval";
      approval: GuardApproval;
    }
  | {
      type: "guard_approval_resolved";
      approvalId: string;
      approved: boolean;
      outcome?: "approved" | "rejected" | "timeout" | "cancelled";
    }
  | {
      type: "member_role_updated";
      member: RoomMember;
    }
  | {
      type: "chat_message_created";
      roomId: string;
      message: ChatMessage;
    }
  | {
      type: "team_agents_changed";
      projectId: string;
      agents: AgentSession[];
    };

export interface GuardApproval {
  id: string;
  request: {
    projectId: string;
    memberId: string;
    source: "terminal" | "agent";
    agentRunId?: string;
    sessionScope?: "personal" | "team";
    agentHandle?: string;
    kind: "command" | "edit" | "read" | "fetch";
    command?: string;
    paths?: string[];
    url?: string;
  };
  decision: {
    action: "allow" | "allow_snapshot" | "ask" | "deny";
    segments: Array<{ text: string; capabilities: string[]; zone: string; reversibility: string }>;
    matchedRules: string[];
    approvers?: "owners" | "initiator" | "self" | null;
    outcome?: "allowed" | "approved" | "rejected" | "timeout" | "denied" | "busy";
    command?: string;
    approverName?: string;
    llmUnavailable?: boolean;
    llm?: { mode: "off" | "suggest" | "auto"; risk: string; confidence: number; reason: string; applied: boolean };
  };
  createdAt: string;
  expiresAt?: string;
  approverIds: string[];
  noApprover?: boolean;
}

export type GuardLlmMode = "off" | "suggest" | "auto";

export interface GuardSettings {
  protectedPaths: string[];
  llmMode: GuardLlmMode;
  llmConfigured: boolean;
  guardMode: "full" | "human-only" | "off";
}

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "restart" }
  | { type: "command"; text: string };

export type TerminalServerMessage =
  | { type: "terminal_snapshot"; data: string }
  | { type: "terminal_output"; data: string }
  | { type: "terminal_error"; message: string }
  | { type: "guard_decision"; requestId?: string; action: string; reason: string; outcome?: "allowed" | "approved" | "rejected" | "timeout" | "denied" | "busy"; approverName?: string; snapshotId?: string; command?: string }
  | { type: "guard_pending"; requestId: string; noApprover?: boolean; expiresAt?: string; command?: string; llmUnavailable?: boolean; llm?: { mode: "off" | "suggest" | "auto"; risk: string; confidence: number; reason: string; applied: boolean } }
  | { type: "control"; holderMemberId: string | null; expiresAt?: string; mode?: "full" | "human-only" | "off" };
