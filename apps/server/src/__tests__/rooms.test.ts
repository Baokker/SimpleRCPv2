import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createRoomStore } from "../rooms.js";

describe("room store", () => {
  it("creates a room and logs room creation", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);

    const room = rooms.createRoom("sample-workspace");

    expect(room.workspaceName).toBe("sample-workspace");
    expect(events.list()).toMatchObject([
      {
        type: "room_created",
        roomId: room.id
      }
    ]);
  });

  it("joins members and updates presence", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    const member = rooms.joinRoom(room.id, "Ada", "human");

    rooms.updatePresence(room.id, member.id, { currentFile: "src/hello.ts" });

    expect(rooms.getRoom(room.id)?.members[0]).toMatchObject({
      id: member.id,
      name: "Ada",
      kind: "human",
      currentFile: "src/hello.ts"
    });
    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined",
      "presence_updated"
    ]);
  });
});
