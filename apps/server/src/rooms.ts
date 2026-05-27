import path from "node:path";
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { MemberKind, RoomMember, RoomState } from "./types.js";

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
    joinRoom(roomId: string, name: string, kind: MemberKind) {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      const member: RoomMember = {
        id: nanoid(10),
        name,
        kind
      };
      room.members.push(member);
      events.append({
        type: "member_joined",
        roomId,
        memberId: member.id,
        payload: { name, kind }
      });
      return member;
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
