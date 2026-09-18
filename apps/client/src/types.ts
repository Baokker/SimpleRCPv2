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

export interface ProjectRecord {
  id: string;
  name: string;
  source: "demo" | "blank" | "directory" | "zip";
  workspacePath: string;
  createdAt: string;
  lastOpenedAt: string;
}

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
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: string;
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

export interface RemoteCursor {
  memberId: string;
  displayName: string;
  path: string;
  position: CursorPosition;
  selection: EditorSelection;
}

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
      path: string;
    };

export interface RunRecord {
  id: string;
  roomId: string;
  initiatorId: string;
  command: string;
  exitCode: number | null;
  output: string;
}
