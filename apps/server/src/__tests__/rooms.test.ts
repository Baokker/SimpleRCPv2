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
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      kind: "human",
      clientId: "client-a"
    });

    rooms.updatePresence(room.id, member.id, { currentFile: "src/hello.ts" });

    expect(rooms.getRoom(room.id)?.members[0]).toMatchObject({
      id: member.id,
      name: "Ada",
      kind: "human",
      clientId: "client-a",
      online: true,
      currentFile: "src/hello.ts"
    });
    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined",
      "presence_updated"
    ]);
  });

  it("upserts human members by client id", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");

    const first = rooms.joinRoom(room.id, {
      name: "Ada",
      kind: "human",
      clientId: "client-a"
    });
    const second = rooms.joinRoom(room.id, {
      name: "Ada Lovelace",
      kind: "human",
      clientId: "client-a"
    });

    expect(second.id).toBe(first.id);
    expect(rooms.getRoom(room.id)?.members).toHaveLength(1);
    expect(second).toMatchObject({
      name: "Ada Lovelace",
      kind: "human",
      clientId: "client-a",
      online: true
    });
    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined",
      "member_rejoined"
    ]);
  });

  it("deduplicates agent members by provider", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");

    const first = rooms.joinRoom(room.id, {
      name: "MockAgent",
      kind: "agent",
      clientId: "agent-mock",
      provider: "mock"
    });
    const second = rooms.joinRoom(room.id, {
      name: "MockAgent",
      kind: "agent",
      clientId: "agent-mock-2",
      provider: "mock"
    });

    expect(second.id).toBe(first.id);
    expect(rooms.getRoom(room.id)?.members).toHaveLength(1);
  });

  it("marks members offline and removes stale offline members", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    const member = rooms.joinRoom(room.id, {
      name: "Ada",
      kind: "human",
      clientId: "client-a"
    });

    rooms.markOffline(room.id, member.id, new Date("2026-05-27T00:00:00Z"));
    expect(rooms.getRoom(room.id)?.members[0]).toMatchObject({
      online: false,
      lastSeenAt: "2026-05-27T00:00:00.000Z"
    });

    rooms.cleanupStaleMembers(
      room.id,
      new Date("2026-05-27T00:02:01Z"),
      120_000
    );

    expect(rooms.getRoom(room.id)?.members).toHaveLength(0);
    expect(events.list().map((event) => event.type)).toContain(
      "member_removed"
    );
  });
});
