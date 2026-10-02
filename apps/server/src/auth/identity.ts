import crypto from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { getProjectMetadataPath, type ProjectRecord } from "../projects.js";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { normalizeStoredRole } from "../guard/roles.js";

export interface MemberRecord {
  memberId: string;
  projectId: string;
  displayName: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export type Identity = Pick<MemberRecord, "projectId" | "memberId" | "displayName" | "role">;

interface MemberFile {
  version: 1;
  members: MemberRecord[];
}

export function createMemberStore(options: { projects: () => ProjectRecord[]; normalizeRoles?: boolean }) {
  const cache = new Map<string, MemberFile>();
  const loading = new Map<string, Promise<MemberFile>>();
  let operations = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>) {
    const result = operations.then(operation);
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  function findProject(projectId: string) {
    const project = options.projects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }

  function projectDataPath(project: ProjectRecord) {
    return getProjectMetadataPath(project);
  }

  async function load(projectId: string) {
    const cached = cache.get(projectId);
    if (cached) return cached;
    const pending = loading.get(projectId);
    if (pending) return pending;
    const operation = loadFile(projectId);
    loading.set(projectId, operation);
    try { return await operation; }
    finally { loading.delete(projectId); }
  }

  async function loadFile(projectId: string) {
    const project = findProject(projectId);
    const stored = await readJsonFile<MemberFile>(path.join(projectDataPath(project), "members.json"));
    if (stored && (stored.version !== 1 || !Array.isArray(stored.members))) throw new Error("Invalid member file");
    const legacy = stored === undefined
      ? await readJsonFile<{ version: 1; participants: Array<{ id: string; displayName: string; profileRole?: string; createdAt: string; updatedAt: string }> }>(path.join(projectDataPath(project), "participants.json"))
      : undefined;
    const records = stored?.members ?? legacy?.participants.map((member) => ({
      memberId: member.id, projectId, displayName: member.displayName, role: member.profileRole ?? "", createdAt: member.createdAt, updatedAt: member.updatedAt
    })) ?? [];
    const file: MemberFile = { version: 1, members: records.map((member) => ({
      memberId: member.memberId, projectId: member.projectId, displayName: member.displayName,
      role: member.role ?? "", createdAt: member.createdAt, updatedAt: member.updatedAt ?? member.createdAt
    })) };
    if (file.members.some((member) => !member.memberId || member.projectId !== projectId || typeof member.displayName !== "string" || typeof member.role !== "string")) throw new Error("Invalid member record");
    if (legacy || (stored && JSON.stringify(stored) !== JSON.stringify(file))) await save(projectId, file);
    cache.set(projectId, file);
    return file;
  }

  async function save(projectId: string, file: MemberFile) {
    const project = findProject(projectId);
    await writeJsonFileAtomically(path.join(projectDataPath(project), "members.json"), file, 0o600);
    cache.set(projectId, file);
  }

  return {
    async join(projectId: string, input: { memberId?: string; displayName: string; role?: string }) {
      return enqueue(async () => {
        const displayName = input.displayName.trim();
        if (!displayName) throw new Error("name is required");
        const file = await load(projectId);
        const now = new Date().toISOString();
        if (input.memberId) {
          const index = file.members.findIndex((member) => member.memberId === input.memberId);
          if (index >= 0) {
            const current = file.members[index]!;
            const member = { ...current, displayName, role: input.role === undefined ? current.role : normalizeRole(input.role), updatedAt: now };
            file.members[index] = member;
            await save(projectId, file);
            return member;
          }
        }
        const member: MemberRecord = {
          memberId: crypto.randomUUID(),
          projectId,
          displayName,
          role: normalizeRole(input.role),
          createdAt: now,
          updatedAt: now
        };
        await save(projectId, { version: 1, members: [...file.members, member] });
        return member;
      });
    },
    async getMember(projectId: string, memberId: string) {
      return (await load(projectId)).members.find((member) => member.memberId === memberId);
    },
    async listMembers(projectId: string) {
      return (await load(projectId)).members.map((member) => ({ ...member }));
    },
    async resolveIdentity(projectId: string, memberId: string) {
      return (await load(projectId)).members.find((member) => member.memberId === memberId);
    },
    async findIdentity(memberId: string) {
      for (const project of options.projects()) {
        const member = (await load(project.id)).members.find((candidate) => candidate.memberId === memberId);
        if (member) return member;
      }
    }
  };

  function normalizeRole(raw: string | undefined) {
    return options.normalizeRoles ? normalizeStoredRole(raw) : raw?.trim() ?? "";
  }
}

export type MemberStore = ReturnType<typeof createMemberStore>;

export function createIdentityMiddleware(options: {
  members: MemberStore;
  projectId?: (request: Request) => string | undefined;
  required?: boolean;
}) {
  return async function identityMiddleware(request: Request, response: Response, next: NextFunction) {
    try {
    const projectId = options.projectId?.(request)
      ?? request.params.projectId
      ?? request.path.match(/\/api\/projects\/([^/]+)/)?.[1];
    const memberId = request.header("x-simplercp-member")?.trim();
    if (memberId) {
      const member = projectId && !["import", "import-zip"].includes(projectId)
        ? await options.members.resolveIdentity(decodeURIComponent(projectId), memberId)
        : await options.members.findIdentity(memberId);
      if (member) {
        request.identity = { projectId: member.projectId, memberId: member.memberId, displayName: member.displayName, role: member.role };
        next();
        return;
      }
    }
    if (options.required) {
      response.status(401).json({ error: "Member identity is required" });
      return;
    }
    next();
    } catch (error) { next(error); }
  };
}

declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}
