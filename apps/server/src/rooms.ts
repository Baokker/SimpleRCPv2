import path from "node:path";
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { MemberKind, RoomMember, RoomState } from "./types.js";

export interface JoinRoomInput {
  name: string;
  kind: MemberKind;
  clientId: string;
  provider?: string;
}

export function createRoomStore(events: EventLog) {
  const rooms = new Map<string, RoomState>();

  return {
    createRoom(workspaceRoot: string) {
      const room: RoomState = {
        id: nanoid(10),
        workspaceName: path.basename(workspaceRoot),
        members: []
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

      const now = new Date().toISOString();
      const existing = findExistingMember(room.members, input);
      if (existing) {
        existing.name = input.name;
        existing.kind = input.kind;
        existing.clientId = input.clientId;
        existing.provider = input.provider;
        existing.online = true;
        existing.lastSeenAt = now;
        events.append({
          type: "member_rejoined",
          roomId,
          memberId: existing.id,
          payload: {
            name: existing.name,
            kind: existing.kind,
            clientId: existing.clientId,
            provider: existing.provider
          }
        });
        return existing;
      }

      const member: RoomMember = {
        id: nanoid(10),
        name: input.name,
        kind: input.kind,
        clientId: input.clientId,
        provider: input.provider,
        online: true,
        lastSeenAt: now
      };
      room.members.push(member);
      events.append({
        type: "member_joined",
        roomId,
        memberId: member.id,
        payload: {
          name: member.name,
          kind: member.kind,
          clientId: member.clientId,
          provider: member.provider
        }
      });
      return member;
    },
    markOnline(roomId: string, memberId: string, now = new Date()) {
      const member = findMember(rooms, roomId, memberId);
      member.online = true;
      member.lastSeenAt = now.toISOString();
      events.append({
        type: "member_online",
        roomId,
        memberId,
        payload: { lastSeenAt: member.lastSeenAt }
      });
      return member;
    },
    markOffline(roomId: string, memberId: string, now = new Date()) {
      const member = findMember(rooms, roomId, memberId);
      member.online = false;
      member.lastSeenAt = now.toISOString();
      events.append({
        type: "member_offline",
        roomId,
        memberId,
        payload: { lastSeenAt: member.lastSeenAt }
      });
      return member;
    },
    cleanupStaleMembers(roomId: string, now = new Date(), ttlMs = 120_000) {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      const before = room.members.length;
      room.members = room.members.filter((member) => {
        if (member.online || member.kind === "agent") return true;
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
      patch: Pick<RoomMember, "currentFile">
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }
      const member = room.members.find(
        (candidate) => candidate.id === memberId
      );
      if (!member) {
        throw new Error("Member not found");
      }

      Object.assign(member, patch);
      events.append({
        type: "presence_updated",
        roomId,
        memberId,
        payload: patch
      });
      return member;
    },
    listRooms() {
      return [...rooms.values()];
    }
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;

function findExistingMember(members: RoomMember[], input: JoinRoomInput) {
  if (input.kind === "agent" && input.provider) {
    return members.find(
      (member) => member.kind === "agent" && member.provider === input.provider
    );
  }

  return members.find((member) => member.clientId === input.clientId);
}

function findMember(
  rooms: Map<string, RoomState>,
  roomId: string,
  memberId: string
) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Room not found");
  }
  const member = room.members.find((candidate) => candidate.id === memberId);
  if (!member) {
    throw new Error("Member not found");
  }
  return member;
}
