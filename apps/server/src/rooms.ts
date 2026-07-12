import path from "node:path";
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { RoomConnection, RoomMember, RoomState } from "./types.js";

export interface JoinRoomInput {
  name: string;
  userId?: string;
  connectionId?: string;
}

export function createRoomStore(events: EventLog) {
  const rooms = new Map<string, RoomState>();

  return {
    createRoom(workspaceRoot: string) {
      const room: RoomState = {
        id: nanoid(10),
        workspaceName: path.basename(workspaceRoot),
        members: [],
        connections: []
      };
      rooms.set(room.id, room);
      events.append({
        type: "room_created",
        roomId: room.id,
        payload: { workspaceName: room.workspaceName }
      });
      return room;
    },
    getRoom(roomId: string) {
      return rooms.get(roomId);
    },
    joinRoom(roomId: string, input: JoinRoomInput) {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      const normalized = normalizeJoinInput(input);
      const now = new Date().toISOString();
      const existing = findExistingMember(room.members, normalized);
      if (existing) {
        existing.name = normalized.name;
        existing.userId = normalized.userId;
        upsertConnection(room, {
          id: normalized.connectionId,
          userId: existing.userId,
          roomId,
          online: true,
          lastSeenAt: now
        });
        syncMemberFromConnections(room, existing, now);
        refreshDisplayNames(room);
        events.append({
          type: "member_rejoined",
          roomId,
          memberId: existing.id,
          payload: {
            name: existing.name,
            userId: existing.userId,
            connectionId: normalized.connectionId,
            connectionCount: existing.connectionCount
          }
        });
        return existing;
      }

      const member: RoomMember = {
        id: nanoid(10),
        name: normalized.name,
        displayName: normalized.name,
        userId: normalized.userId,
        online: true,
        lastSeenAt: now,
        connectionCount: 1
      };
      room.members.push(member);
      upsertConnection(room, {
        id: normalized.connectionId,
        userId: member.userId,
        roomId,
        online: true,
        lastSeenAt: now
      });
      refreshDisplayNames(room);
      events.append({
        type: "member_joined",
        roomId,
        memberId: member.id,
        payload: {
          name: member.name,
          userId: member.userId,
          connectionId: normalized.connectionId
        }
      });
      return member;
    },
    markOnline(roomId: string, memberId: string, now = new Date()) {
      const member = findMember(rooms, roomId, memberId);
      const wasOnline = member.online;
      member.online = true;
      member.lastSeenAt = now.toISOString();
      if (!wasOnline) {
        events.append({
          type: "member_online",
          roomId,
          memberId,
          payload: { name: member.displayName, lastSeenAt: member.lastSeenAt }
        });
      }
      return member;
    },
    markConnectionOnline(roomId: string, connectionId: string, now = new Date()) {
      const room = findRoom(rooms, roomId);
      const connection = room.connections.find(
        (candidate) => candidate.id === connectionId
      );
      if (!connection) {
        throw new Error("Connection not found");
      }
      const member = room.members.find(
        (candidate) => candidate.userId === connection.userId
      );
      if (!member) {
        throw new Error("Member not found");
      }
      const wasOnline = member.online;
      connection.online = true;
      connection.lastSeenAt = now.toISOString();
      syncMemberFromConnections(room, member, now.toISOString());
      if (!wasOnline && member.online) {
        events.append({
          type: "member_online",
          roomId,
          memberId: member.id,
          payload: {
            name: member.displayName,
            connectionId,
            lastSeenAt: member.lastSeenAt
          }
        });
      }
      return member;
    },
    markOffline(roomId: string, memberId: string, now = new Date()) {
      const member = findMember(rooms, roomId, memberId);
      const wasOnline = member.online;
      member.online = false;
      member.lastSeenAt = now.toISOString();
      if (wasOnline) {
        events.append({
          type: "member_offline",
          roomId,
          memberId,
          payload: { name: member.displayName, lastSeenAt: member.lastSeenAt }
        });
      }
      return member;
    },
    markConnectionOffline(roomId: string, connectionId: string, now = new Date()) {
      const room = findRoom(rooms, roomId);
      const connection = room.connections.find(
        (candidate) => candidate.id === connectionId
      );
      if (!connection) {
        throw new Error("Connection not found");
      }
      const member = room.members.find(
        (candidate) => candidate.userId === connection.userId
      );
      if (!member) {
        throw new Error("Member not found");
      }
      const wasOnline = member.online;
      connection.online = false;
      connection.lastSeenAt = now.toISOString();
      syncMemberFromConnections(room, member, now.toISOString());
      if (wasOnline && !member.online) {
        events.append({
          type: "member_offline",
          roomId,
          memberId: member.id,
          payload: {
            name: member.displayName,
            connectionId,
            lastSeenAt: member.lastSeenAt
          }
        });
      }
      return member;
    },
    cleanupStaleMembers(roomId: string, now = new Date(), ttlMs = 120_000) {
      const room = findRoom(rooms, roomId);

      const before = room.members.length;
      room.connections = room.connections.filter((connection) => {
        if (connection.online) return true;
        return now.getTime() - new Date(connection.lastSeenAt).getTime() <= ttlMs;
      });
      for (const member of room.members) {
        syncMemberFromConnections(room, member, member.lastSeenAt);
      }
      room.members = room.members.filter((member) => {
        if (member.online) return true;
        return now.getTime() - new Date(member.lastSeenAt).getTime() <= ttlMs;
      });

      if (room.members.length !== before) {
        events.append({
          type: "member_removed",
          roomId,
          payload: { removed: before - room.members.length }
        });
      }

      return room.members;
    },
    updatePresence(
      roomId: string,
      memberId: string,
      patch: Pick<RoomMember, "currentFile"> & { connectionId?: string }
    ) {
      const room = findRoom(rooms, roomId);
      const member = room.members.find(
        (candidate) => candidate.id === memberId
      );
      if (!member) {
        throw new Error("Member not found");
      }

      if (patch.connectionId) {
        const connection = room.connections.find(
          (candidate) => candidate.id === patch.connectionId
        );
        if (connection) {
          connection.currentFile = patch.currentFile;
          connection.lastSeenAt = new Date().toISOString();
        }
      }
      member.currentFile = patch.currentFile;
      return member;
    },
    listRooms() {
      return [...rooms.values()];
    }
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;

type NormalizedJoinInput = Required<Pick<JoinRoomInput, "name">> & {
  userId: string;
  connectionId: string;
};

function normalizeJoinInput(input: JoinRoomInput): NormalizedJoinInput {
  const userId = input.userId ?? input.connectionId ?? `human:${input.name}`;
  return {
    name: input.name,
    userId,
    connectionId: input.connectionId ?? userId
  };
}

function findExistingMember(members: RoomMember[], input: NormalizedJoinInput) {
  return members.find((member) => member.userId === input.userId);
}

function upsertConnection(room: RoomState, connection: RoomConnection) {
  const existing = room.connections.find(
    (candidate) => candidate.id === connection.id
  );
  if (existing) {
    Object.assign(existing, connection);
    return existing;
  }
  room.connections.push(connection);
  return connection;
}

function syncMemberFromConnections(
  room: RoomState,
  member: RoomMember,
  fallbackLastSeenAt: string
) {
  const connections = room.connections.filter(
    (connection) => connection.userId === member.userId
  );
  const onlineConnections = connections.filter((connection) => connection.online);
  member.connectionCount = onlineConnections.length;
  member.online = onlineConnections.length > 0;
  member.lastSeenAt =
    connections
      .map((connection) => connection.lastSeenAt)
      .sort()
      .at(-1) ?? fallbackLastSeenAt;
  member.currentFile =
    onlineConnections.find((connection) => connection.currentFile)?.currentFile ??
    member.currentFile;
}

function refreshDisplayNames(room: RoomState) {
  const counts = new Map<string, number>();
  for (const member of room.members) {
    const count = (counts.get(member.name) ?? 0) + 1;
    counts.set(member.name, count);
    member.displayName = count === 1 ? member.name : `${member.name} #${count}`;
  }
}

function findRoom(rooms: Map<string, RoomState>, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Room not found");
  }
  return room;
}

function findMember(
  rooms: Map<string, RoomState>,
  roomId: string,
  memberId: string
) {
  const room = findRoom(rooms, roomId);
  const member = room.members.find((candidate) => candidate.id === memberId);
  if (!member) {
    throw new Error("Member not found");
  }
  return member;
}
