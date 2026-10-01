import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import type { ProjectRecord } from "../projects.js";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";

export type Identity =
  | { kind: "admin" }
  | { kind: "member"; projectId: string; memberId: string; role: string };

export interface MemberRecord {
  memberId: string;
  projectId: string;
  displayName: string;
  role: string;
  createdAt: string;
  tokenHash: string;
}

export interface InviteRecord {
  id: string;
  projectId: string;
  tokenHash: string;
  role: string;
  createdAt: string;
  expiresAt?: string;
  maxUses?: number;
  uses: number;
  revokedAt?: string;
}

interface MemberFile { version: 1; members: MemberRecord[] }
interface InviteFile { version: 1; invites: InviteRecord[] }
interface AdminFile { version: 1; tokenHash: string }

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function equalTokenHash(token: string, expectedHash: string) {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function parseCookies(header: string | undefined) {
  const values = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) values.set(name, decodeURIComponent(value));
  }
  return values;
}

export function setSessionCookie(response: Response, name: string, token: string, secure: boolean) {
  response.append("Set-Cookie", [
    `${name}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    ...(secure ? ["Secure"] : [])
  ].join("; "));
}

export function createAuthStore(options: { dataDir: string; adminToken?: string; projects: () => ProjectRecord[] }) {
  const instanceDir = path.join(options.dataDir, "instance");
  let adminHash = "";
  let adminPlaintext: string | undefined;
  const memberCache = new Map<string, MemberFile>();
  const inviteCache = new Map<string, InviteFile>();
  let operations = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>) {
    const result = operations.then(operation);
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function initialize() {
    await fs.mkdir(instanceDir, { recursive: true, mode: 0o700 });
    const stored = await readJsonFile<AdminFile>(path.join(instanceDir, "admin.json"));
    if (options.adminToken?.trim()) {
      adminPlaintext = options.adminToken.trim();
      adminHash = hashToken(adminPlaintext);
    } else if (stored?.version === 1 && typeof stored.tokenHash === "string") {
      adminHash = stored.tokenHash;
    } else {
      adminPlaintext = createToken();
      adminHash = hashToken(adminPlaintext);
      await writeJsonFileAtomically(path.join(instanceDir, "admin.json"), { version: 1, tokenHash: adminHash }, 0o600);
    }
    return { adminToken: adminPlaintext };
  }

  function projectDataPath(project: ProjectRecord) {
    return project.metadataPath ?? path.dirname(project.workspacePath);
  }

  async function loadMembers(project: ProjectRecord) {
    const existing = memberCache.get(project.id);
    if (existing) return existing;
    const stored = await readJsonFile<MemberFile>(path.join(projectDataPath(project), "members.json"));
    const file = stored?.version === 1 && Array.isArray(stored.members) ? stored : { version: 1 as const, members: [] };
    memberCache.set(project.id, file);
    return file;
  }

  async function saveMembers(project: ProjectRecord, file: MemberFile) {
    memberCache.set(project.id, file);
    await writeJsonFileAtomically(path.join(projectDataPath(project), "members.json"), file, 0o600);
  }

  async function loadInvites(project: ProjectRecord) {
    const existing = inviteCache.get(project.id);
    if (existing) return existing;
    const stored = await readJsonFile<InviteFile>(path.join(projectDataPath(project), "invites.json"));
    const file = stored?.version === 1 && Array.isArray(stored.invites) ? stored : { version: 1 as const, invites: [] };
    inviteCache.set(project.id, file);
    return file;
  }

  async function saveInvites(project: ProjectRecord, file: InviteFile) {
    inviteCache.set(project.id, file);
    await writeJsonFileAtomically(path.join(projectDataPath(project), "invites.json"), file, 0o600);
  }

  function findProject(projectId: string) {
    const project = options.projects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }

  return {
    initialize,
    adminToken() { return adminPlaintext; },
    isAdminToken(token: string) { return Boolean(adminHash) && equalTokenHash(token, adminHash); },
    memberCookieName(projectId: string) { return `srcp_m_${projectId}`; },
    async createInvite(projectId: string, input: { role?: string; expiresAt?: string; maxUses?: number }) {
      if (input.role !== undefined && typeof input.role !== "string") throw new Error("role must be a string");
      if (input.expiresAt !== undefined && !Number.isFinite(Date.parse(input.expiresAt))) throw new Error("expiresAt must be a date");
      if (input.maxUses !== undefined && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) throw new Error("maxUses must be a positive integer");
      return enqueue(async () => {
      const project = findProject(projectId);
      const token = createToken();
      const file = await loadInvites(project);
      const invite: InviteRecord = { id: crypto.randomUUID(), projectId, tokenHash: hashToken(token), role: input.role?.trim() || "member", createdAt: new Date().toISOString(), expiresAt: input.expiresAt, maxUses: input.maxUses, uses: 0 };
      await saveInvites(project, { version: 1, invites: [...file.invites, invite] });
      const { tokenHash: _tokenHash, ...publicInvite } = invite;
      return { invite: publicInvite, token };
      });
    },
    async listInvites(projectId: string) {
      return (await loadInvites(findProject(projectId))).invites.map(({ tokenHash: _tokenHash, ...invite }) => invite);
    },
    async revokeInvite(projectId: string, inviteId: string) {
      return enqueue(async () => {
      const project = findProject(projectId);
      const file = await loadInvites(project);
      const invite = file.invites.find((candidate) => candidate.id === inviteId);
      if (!invite) throw new Error("Invite not found");
      invite.revokedAt = new Date().toISOString();
      await saveInvites(project, file);
      const { tokenHash: _tokenHash, ...publicInvite } = invite;
      return publicInvite;
      });
    },
    async join(projectId: string, token: string, displayName: string) {
      return enqueue(async () => {
      const project = findProject(projectId);
      const file = await loadInvites(project);
      const invite = file.invites.find((candidate) => equalTokenHash(token, candidate.tokenHash));
      if (!invite || invite.revokedAt) throw new Error("Invite is invalid or revoked");
      if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) throw new Error("Invite has expired");
      if (invite.maxUses !== undefined && invite.uses >= invite.maxUses) throw new Error("Invite use limit reached");
      const normalized = displayName.trim();
      if (!normalized) throw new Error("name is required");
      const sessionToken = createToken();
      const member: MemberRecord = { memberId: crypto.randomUUID(), projectId, displayName: normalized, role: invite.role || "member", createdAt: new Date().toISOString(), tokenHash: hashToken(sessionToken) };
      const members = await loadMembers(project);
      await saveMembers(project, { version: 1, members: [...members.members, member] });
      invite.uses += 1;
      await saveInvites(project, file);
      return { member, sessionToken };
      });
    },
    async getMember(projectId: string, memberId: string) { return (await loadMembers(findProject(projectId))).members.find((member) => member.memberId === memberId); },
    async authenticateMember(projectId: string, token: string) { return (await loadMembers(findProject(projectId))).members.find((member) => equalTokenHash(token, member.tokenHash)); },
    async updateDisplayName(projectId: string, memberId: string, displayName: string) {
      const project = findProject(projectId); const file = await loadMembers(project); const member = file.members.find((candidate) => candidate.memberId === memberId); if (!member) throw new Error("Member not found"); member.displayName = displayName.trim(); await saveMembers(project, file); return member;
    },
    async updateRole(projectId: string, memberId: string, role: string) {
      const project = findProject(projectId); const file = await loadMembers(project); const member = file.members.find((candidate) => candidate.memberId === memberId); if (!member) throw new Error("Member not found"); member.role = role.trim() || "member"; await saveMembers(project, file); return member;
    },
    async listMembers(projectId: string) { return (await loadMembers(findProject(projectId))).members.map(({ tokenHash: _tokenHash, ...member }) => member); }
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;

export function createIdentityMiddleware(options: { auth: AuthStore; projectId?: (request: Request) => string | undefined; required?: boolean }) {
  return async function identityMiddleware(request: Request, response: Response, next: NextFunction) {
    const candidateId = options.projectId?.(request) ?? request.params.projectId ?? request.path.match(/\/api\/projects\/([^/]+)/)?.[1];
    const projectId = candidateId && !["import", "import-zip"].includes(candidateId) ? candidateId : undefined;
    const bearer = request.header("authorization")?.startsWith("Bearer ") ? request.header("authorization")!.slice(7).trim() : undefined;
    const cookies = parseCookies(request.header("cookie"));
    const token = bearer ?? cookies.get("srcp_admin") ?? cookies.get(projectId ? options.auth.memberCookieName(projectId) : "");
    if (token && options.auth.isAdminToken(token)) { request.identity = { kind: "admin" }; next(); return; }
    if (token && projectId) {
      const member = await options.auth.authenticateMember(projectId, token);
      if (member) { request.identity = { kind: "member", projectId, memberId: member.memberId, role: member.role }; next(); return; }
    }
    if (!projectId) {
      for (const [name, value] of cookies) {
        if (!name.startsWith("srcp_m_")) continue;
        const id = name.slice("srcp_m_".length);
        const member = await options.auth.authenticateMember(id, bearer ?? value);
        if (member) { request.identity = { kind: "member", projectId: id, memberId: member.memberId, role: member.role }; next(); return; }
      }
    }
    if (options.required !== false) { response.status(401).json({ error: "Authentication required" }); return; }
    next();
  };
}

declare global {
  namespace Express { interface Request { identity?: Identity } }
}
