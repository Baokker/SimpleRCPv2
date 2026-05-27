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
  name: string;
  kind: MemberKind;
  currentFile?: string;
}

export interface RoomState {
  id: string;
  workspaceName: string;
  members: RoomMember[];
}

export interface EventRecord {
  id: string;
  type: string;
  roomId?: string;
  memberId?: string;
  taskId?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export type ClientMessage =
  | {
      type: "open_file";
      roomId: string;
      memberId: string;
      path: string;
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
  taskId: string;
  initiatorId: string;
  command: string;
  exitCode: number | null;
  output: string;
}
