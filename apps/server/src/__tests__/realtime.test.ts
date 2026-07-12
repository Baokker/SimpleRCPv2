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
      kind: "human",
      userId: "user-ada",
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

  it("records file change events", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      kind: "human",
      userId: "user-ada",
      connectionId: "tab-a"
    });

    const result = handleRealtimeMessage({
      events,
      rooms,
      message: {
        type: "file_change",
        roomId: room.id,
        memberId: member.id,
        connectionId: "tab-a",
        path: "src/hello.ts",
        content: "updated"
      }
    });

    expect(result.broadcast).toMatchObject({
      type: "file_change",
      path: "src/hello.ts",
      content: "updated"
    });
    expect(events.list().map((event) => event.type)).toContain("file_changed");
  });
});
