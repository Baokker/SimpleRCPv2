export type CaptureEventType =
  | "edit"
  | "cursor"
  | "chat"
  | "fileExternal"
  | "docOpen"
  | "docRetired"
  | "memberPresence";

export type CaptureActorKind = "member" | "agent" | "filesystem" | "unknown";

export interface ParsedCaptureActor {
  kind: CaptureActorKind;
  memberId?: string;
  runId?: string;
}

export function parseActor(actor: string): ParsedCaptureActor {
  if (actor === "filesystem") return { kind: "filesystem" };
  if (actor === "unknown") return { kind: "unknown" };
  if (actor.startsWith("agent:") && actor.length > "agent:".length) return { kind: "agent", runId: actor.slice("agent:".length) };
  if (actor.length > 0) return { kind: "member", memberId: actor };
  return { kind: "unknown" };
}

export interface CaptureEventBase {
  schemaVersion: 1;
  type: CaptureEventType;
  at: number;
  seq: number;
}

export interface CaptureEditOp {
  start: number;
  deleteCount: number;
  insertText: string;
  deletedText?: string;
}

export interface CaptureEditEvent extends CaptureEventBase {
  type: "edit";
  file: string;
  actor: string;
  ops: CaptureEditOp[];
  revisionAfter?: number;
  textBefore?: string;
  textAfter?: string;
}

export interface CaptureCursorEvent extends CaptureEventBase {
  type: "cursor";
  memberId: string;
  file: string;
  position: { line: number; character: number };
  selection: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
}

export interface CaptureChatEvent extends CaptureEventBase {
  type: "chat";
  messageId: string;
  authorId: string;
  kind: "member" | "agent" | "system";
  text: string;
  mentions?: string[];
  file?: string;
}

export interface CaptureFileExternalEvent extends CaptureEventBase {
  type: "fileExternal";
  file: string;
  change: "add" | "change" | "unlink" | "rename";
  textBefore?: string;
  textAfter?: string;
  hasDocument?: boolean;
}

export interface CaptureDocOpenEvent extends CaptureEventBase {
  type: "docOpen";
  file: string;
  text: string;
}

export interface CaptureDocRetiredEvent extends CaptureEventBase {
  type: "docRetired";
  file: string;
}

export interface CaptureMemberPresenceEvent extends CaptureEventBase {
  type: "memberPresence";
  memberId: string;
  action: "join" | "leave" | "switchFile";
  file?: string;
  previousFile?: string;
}

export type CaptureEvent =
  | CaptureEditEvent
  | CaptureCursorEvent
  | CaptureChatEvent
  | CaptureFileExternalEvent
  | CaptureDocOpenEvent
  | CaptureDocRetiredEvent
  | CaptureMemberPresenceEvent;

export function isCaptureEvent(value: unknown): value is CaptureEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.schemaVersion !== 1 || typeof event.at !== "number" || !Number.isFinite(event.at) || event.at < 0 || !coordinate(event.seq)) return false;
  const optionalText = (field: string) => event[field] === undefined || typeof event[field] === "string";
  if (event.type === "memberPresence") return text(event.memberId) && ["join", "leave", "switchFile"].includes(String(event.action)) && optionalText("file") && optionalText("previousFile");
  if (event.type === "chat") return text(event.messageId) && text(event.authorId) && ["member", "agent", "system"].includes(String(event.kind)) && typeof event.text === "string" && optionalText("file") && (event.mentions === undefined || Array.isArray(event.mentions) && event.mentions.every(text));
  if (!text(event.file)) return false;
  if (event.type === "docOpen") return typeof event.text === "string";
  if (event.type === "docRetired") return true;
  if (event.type === "fileExternal") return ["add", "change", "unlink", "rename"].includes(String(event.change)) && optionalText("textBefore") && optionalText("textAfter") && (event.hasDocument === undefined || typeof event.hasDocument === "boolean");
  if (event.type === "edit") {
    if (!text(event.actor) || !Array.isArray(event.ops) || !optionalText("textBefore") || !optionalText("textAfter") || (event.revisionAfter !== undefined && !coordinate(event.revisionAfter))) return false;
    let previousEnd = 0;
    return event.ops.every(value => {
      if (!value || typeof value !== "object") return false;
      const op = value as Record<string, unknown>;
      if (!coordinate(op.start) || !coordinate(op.deleteCount) || op.start < previousEnd || typeof op.insertText !== "string" || (op.deletedText !== undefined && typeof op.deletedText !== "string")) return false;
      previousEnd = op.start + op.deleteCount;
      return typeof event.textBefore !== "string" || previousEnd <= event.textBefore.length;
    });
  }
  if (event.type === "cursor") {
    const position = event.position as Record<string, unknown> | undefined;
    const selection = event.selection as Record<string, unknown> | undefined;
    return text(event.memberId) && !!position && coordinate(position.line) && coordinate(position.character) && !!selection && coordinate(selection.startLine) && coordinate(selection.startCharacter) && coordinate(selection.endLine) && coordinate(selection.endCharacter)
      && (selection.startLine < selection.endLine || selection.startLine === selection.endLine && selection.startCharacter <= selection.endCharacter);
  }
  return false;
}

function coordinate(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
