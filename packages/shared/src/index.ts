export type ProjectSource = "demo" | "blank" | "directory" | "zip";

export interface ProjectRecord {
  id: string;
  name: string;
  source: ProjectSource;
  workspacePath: string;
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

export type WorkspaceFileLoadResult =
  | { status: "text"; path: string; size: number; content: string }
  | { status: "binary"; path: string; size: number }
  | { status: "large"; path: string; size: number };

export interface RoomMember {
  id: string;
  userId: string;
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
  userId: string;
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
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface ChatMessage {
  sequence: number;
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: string;
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
  memberName?: string;
  prompt: string;
  contexts?: AgentPromptContext[];
  status: AgentRunStatus;
  runtime: "opencode";
  provider: "deepseek";
  model: string;
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
  memberName?: string;
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
    };

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "restart" };

export type TerminalServerMessage =
  | { type: "terminal_snapshot"; data: string }
  | { type: "terminal_output"; data: string }
  | { type: "terminal_error"; message: string };
