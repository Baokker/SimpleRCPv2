import path from "node:path";
import type { ProjectParticipant } from "@simplercp/shared";
import { nanoid } from "nanoid";
import { readJsonFile, writeJsonFileAtomically } from "./jsonFile.js";

interface ParticipantFile {
  version: 1;
  participants: ProjectParticipant[];
}

export function createParticipantStore(projectId: string, projectRoot: string) {
  const storagePath = path.join(projectRoot, "participants.json");
  let loading: Promise<void> | undefined;
  let operations = Promise.resolve();
  let participants: ProjectParticipant[] = [];

  async function load() {
    const stored = await readJsonFile<ParticipantFile>(storagePath);
    if (stored === undefined) return;
    if (
      stored.version !== 1 ||
      !Array.isArray(stored.participants) ||
      stored.participants.some(
        (participant) =>
          !participant ||
          typeof participant.id !== "string" ||
          participant.projectId !== projectId ||
          typeof participant.displayName !== "string"
      )
    ) {
      throw new Error("Invalid participant file");
    }
    participants = stored.participants;
  }

  function ensureLoaded() {
    loading ??= load();
    return loading;
  }

  function enqueue<R>(operation: () => Promise<R>) {
    const result = operations.then(operation);
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function save() {
    await writeJsonFileAtomically(storagePath, {
      version: 1,
      participants
    } satisfies ParticipantFile);
  }

  return {
    async list() {
      await ensureLoaded();
      await operations;
      return participants.map((participant) => ({ ...participant }));
    },
    async get(participantId: string) {
      await ensureLoaded();
      await operations;
      const participant = participants.find(
        (candidate) => candidate.id === participantId
      );
      return participant ? { ...participant } : undefined;
    },
    async resolve(input: {
      participantId?: string;
      displayName: string;
      profileRole?: string;
    }) {
      await ensureLoaded();
      return enqueue(async () => {
        const displayName = input.displayName.trim();
        if (!displayName) throw new Error("name is required");
        const profileRole = input.profileRole?.trim() || undefined;
        const now = new Date().toISOString();
        if (input.participantId) {
          const index = participants.findIndex(
            (participant) => participant.id === input.participantId
          );
          if (index < 0) throw new Error("Participant not found");
          const current = participants[index]!;
          const participant: ProjectParticipant = {
            ...current,
            displayName,
            profileRole,
            updatedAt: now
          };
          participants = [
            ...participants.slice(0, index),
            participant,
            ...participants.slice(index + 1)
          ];
          await save();
          return { ...participant };
        }
        const participant: ProjectParticipant = {
          id: nanoid(12),
          projectId,
          displayName,
          profileRole,
          createdAt: now,
          updatedAt: now
        };
        participants = [...participants, participant];
        await save();
        return { ...participant };
      });
    }
  };
}

export type ParticipantStore = ReturnType<typeof createParticipantStore>;
