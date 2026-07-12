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
      userId: "user-ada",
      connectionId: "tab-a"
    });

    rooms.updatePresence(room.id, member.id, { currentFile: "src/hello.ts" });

    expect(rooms.getRoom(room.id)?.members[0]).toMatchObject({
      id: member.id,
      name: "Ada",
      displayName: "Ada",
      kind: "human",
      userId: "user-ada",
      connectionCount: 1,
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
      userId: "user-ada",
      connectionId: "tab-a"
    });
    const second = rooms.joinRoom(room.id, {
      name: "Ada Lovelace",
      kind: "human",
      userId: "user-ada",
      connectionId: "tab-a"
    });

    expect(second.id).toBe(first.id);
    expect(rooms.getRoom(room.id)?.members).toHaveLength(1);
    expect(second).toMatchObject({
      name: "Ada Lovelace",
      kind: "human",
      userId: "user-ada",
      connectionCount: 1,
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
      userId: "agent-mock",
      connectionId: "agent-mock-connection",
      provider: "mock"
    });
    const second = rooms.joinRoom(room.id, {
      name: "MockAgent",
      kind: "agent",
      userId: "agent-mock-2",
      connectionId: "agent-mock-connection-2",
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
      userId: "user-ada",
      connectionId: "tab-a"
    });

    rooms.markConnectionOffline(
      room.id,
      "tab-a",
      new Date("2026-05-27T00:00:00Z")
    );
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

  it("groups multiple connections under one person", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");

    rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-bob",
      connectionId: "tab-1"
    });
    rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-bob",
      connectionId: "tab-2"
    });

    expect(rooms.getRoom(room.id)?.members).toMatchObject([
      {
        name: "bob",
        displayName: "bob",
        userId: "user-bob",
        connectionCount: 2,
        online: true
      }
    ]);
  });

  it("disambiguates different users with the same display name", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");

    rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-a",
      connectionId: "tab-a"
    });
    rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-b",
      connectionId: "tab-b"
    });

    expect(
      rooms.getRoom(room.id)?.members.map((member) => member.displayName)
    ).toEqual(["bob", "bob #2"]);
  });

  it("marks one connection offline without duplicating the person row", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    const bob = rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-bob",
      connectionId: "tab-1"
    });
    rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-bob",
      connectionId: "tab-2"
    });

    rooms.markConnectionOffline(
      room.id,
      "tab-1",
      new Date("2026-05-28T00:00:00Z")
    );

    expect(rooms.getRoom(room.id)?.members).toMatchObject([
      {
        id: bob.id,
        connectionCount: 1,
        online: true
      }
    ]);
  });

  it("ignores duplicate close notifications for an already offline connection", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    rooms.joinRoom(room.id, {
      name: "bob",
      kind: "human",
      userId: "user-bob",
      connectionId: "tab-1"
    });

    rooms.markConnectionOffline(room.id, "tab-1");

    expect(() => rooms.markConnectionOffline(room.id, "tab-1")).not.toThrow();
    expect(rooms.getRoom(room.id)?.members[0]).toMatchObject({
      connectionCount: 0,
      online: false
    });
  });
});
