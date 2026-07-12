export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file";
}

export interface WorkspaceDirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children: WorkspaceNode[];
}

export type WorkspaceNode = WorkspaceFileNode | WorkspaceDirectoryNode;

export type MemberKind = "human" | "agent";

export interface RoomMember {
  id: string;
  userId: string;
  clientId?: string;
  name: string;
  displayName: string;
  kind: MemberKind;
  online: boolean;
  lastSeenAt: string;
  connectionCount: number;
  currentFile?: string;
  provider?: string;
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
  taskId?: string;
  timestamp: string;
  payload?: object;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorKind: MemberKind;
  text: string;
  mentions: string[];
  timestamp: string;
  taskId?: string;
  runId?: string;
}

export type AgentRunStatus =
  | "queued"
  | "thinking"
  | "editing"
  | "running_command"
  | "reporting"
  | "completed"
  | "failed"
  | "blocked";

export interface AgentRun {
  id: string;
  roomId: string;
  agentId: string;
  agentName: string;
  status: AgentRunStatus;
  startedAt: string;
  triggerMessageId?: string;
  taskId?: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  lastAction?: string;
}

export type TimelineItemType =
  | "join"
  | "chat"
  | "agent"
  | "edit"
  | "command"
  | "result";

export type TimelineItemStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface TimelineItem {
  id: string;
  roomId: string;
  actorName: string;
  actorKind: MemberKind;
  type: TimelineItemType;
  label: string;
  status: TimelineItemStatus;
  timestamp: string;
  detail?: string;
  eventId?: string;
  taskId?: string;
  runId?: string;
}

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
  | {
      type: "file_change";
      roomId: string;
      memberId: string;
      connectionId?: string;
      path: string;
      content: string;
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
      type: "file_change";
      roomId: string;
      memberId: string;
      path: string;
      content: string;
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
      type: "workspace_tree_changed";
      roomId: string;
    };

export interface TaskRecord {
  id: string;
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
  status: "open" | "running" | "completed" | "blocked";
}

export interface RunRecord {
  id: string;
  roomId: string;
  taskId?: string;
  initiatorId: string;
  command: string;
  exitCode: number | null;
  output: string;
}
