import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createRoomStore } from "../rooms.js";

describe("room store", () => {
  it("creates a room and joins a person", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      userId: "user-ada",
      connectionId: "tab-a"
    });

    expect(member).toMatchObject({
      name: "Ada",
      displayName: "Ada",
      userId: "user-ada",
      connectionCount: 1,
      online: true
    });
    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined"
    ]);
  });

  it("updates the file a person is viewing without adding activity noise", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      userId: "user-ada",
      connectionId: "tab-a"
    });

    rooms.updatePresence(room.id, member.id, {
      currentFile: "src/hello.ts",
      connectionId: "tab-a"
    });

    expect(rooms.getRoom(room.id)?.members[0]?.currentFile).toBe("src/hello.ts");
    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined"
    ]);
  });

  it("groups multiple tabs under one person", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");

    const first = rooms.joinRoom(room.id, {
      name: "Bob",
      userId: "user-bob",
      connectionId: "tab-1"
    });
    const second = rooms.joinRoom(room.id, {
      name: "Bob",
      userId: "user-bob",
      connectionId: "tab-2"
    });

    expect(second.id).toBe(first.id);
    expect(rooms.getRoom(room.id)?.members).toMatchObject([
      { name: "Bob", connectionCount: 2, online: true }
    ]);
  });

  it("disambiguates different people using the same name", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");

    rooms.joinRoom(room.id, {
      name: "Bob",
      userId: "user-a",
      connectionId: "tab-a"
    });
    rooms.joinRoom(room.id, {
      name: "Bob",
      userId: "user-b",
      connectionId: "tab-b"
    });

    expect(
      rooms.getRoom(room.id)?.members.map((member) => member.displayName)
    ).toEqual(["Bob", "Bob #2"]);
  });

  it("records offline activity only after the final tab closes", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    rooms.joinRoom(room.id, {
      name: "Bob",
      userId: "user-bob",
      connectionId: "tab-1"
    });
    rooms.joinRoom(room.id, {
      name: "Bob",
      userId: "user-bob",
      connectionId: "tab-2"
    });

    rooms.markConnectionOnline(room.id, "tab-1");
    rooms.markConnectionOffline(room.id, "tab-1");
    rooms.markConnectionOffline(room.id, "tab-2");
    rooms.markConnectionOffline(room.id, "tab-2");

    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined",
      "member_rejoined",
      "member_offline"
    ]);
  });

  it("removes stale offline people", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    rooms.joinRoom(room.id, {
      name: "Ada",
      userId: "user-ada",
      connectionId: "tab-a"
    });
    rooms.markConnectionOffline(
      room.id,
      "tab-a",
      new Date("2026-05-27T00:00:00Z")
    );

    rooms.cleanupStaleMembers(
      room.id,
      new Date("2026-05-27T00:02:01Z"),
      120_000
    );

    expect(rooms.getRoom(room.id)?.members).toHaveLength(0);
  });
});
