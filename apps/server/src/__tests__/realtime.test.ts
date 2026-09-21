import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createRoomStore } from "../rooms.js";
import { handleRealtimeMessage } from "../realtime.js";

describe("realtime message handling", () => {
  it("updates presence on open_file messages", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      participantId: "user-ada",
      connectionId: "tab-a"
    });

    const result = handleRealtimeMessage({
      events,
      rooms,
      message: {
        type: "open_file",
        roomId: room.id,
        memberId: member.id,
        connectionId: "tab-a",
        path: "src/hello.ts"
      }
    });

    expect(result.broadcast).toMatchObject({
      type: "presence",
      roomId: room.id,
      members: [{ currentFile: "src/hello.ts" }]
    });
    expect(events.list().map((event) => event.type)).toContain("file_opened");
  });

  it("records file edit ranges without broadcasting file content", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      participantId: "user-ada",
      connectionId: "tab-a"
    });

    const result = handleRealtimeMessage({
      events,
      rooms,
      message: {
        type: "file_edited",
        roomId: room.id,
        memberId: member.id,
        connectionId: "tab-a",
        path: "src/hello.ts",
        ranges: [
          { startLine: 2, endLine: 4 },
          { startLine: 8, endLine: 8 }
        ],
        addedLines: 3,
        removedLines: 1,
        startedAt: "2026-09-18T06:00:00.000Z",
        finishedAt: "2026-09-18T06:00:02.000Z"
      }
    });

    expect(result.broadcast).toMatchObject({
      type: "event",
      event: {
        type: "file_changed",
        payload: {
          path: "src/hello.ts",
          ranges: [
            { startLine: 2, endLine: 4 },
            { startLine: 8, endLine: 8 }
          ],
          addedLines: 3,
          removedLines: 1,
          startedAt: "2026-09-18T06:00:00.000Z",
          finishedAt: "2026-09-18T06:00:02.000Z"
        }
      }
    });
    expect(events.list().map((event) => event.type)).toContain("file_changed");
  });

  it("broadcasts cursor and selection updates without adding activity noise", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      participantId: "user-ada",
      connectionId: "tab-a"
    });
    const eventCountBeforeCursorMove = events.list().length;

    const result = handleRealtimeMessage({
      events,
      rooms,
      message: {
        type: "cursor_change",
        roomId: room.id,
        memberId: member.id,
        connectionId: "tab-a",
        path: "src/hello.ts",
        position: { lineNumber: 3, column: 8 },
        selection: {
          startLineNumber: 2,
          startColumn: 1,
          endLineNumber: 3,
          endColumn: 8
        }
      }
    });

    expect(result.broadcast).toEqual({
      type: "cursor_change",
      roomId: room.id,
      memberId: member.id,
      path: "src/hello.ts",
      position: { lineNumber: 3, column: 8 },
      selection: {
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 8
      }
    });
    expect(events.list()).toHaveLength(eventCountBeforeCursorMove);
  });
});
