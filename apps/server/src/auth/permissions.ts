import type { Request, Response } from "express";
import type { Identity } from "./identity.js";

export type Action =
  | "project:list"
  | "project:write"
  | "project:read"
  | "invite:manage"
  | "member:role"
  | "agent:settings"
  | "agent:read"
  | "agent:create"
  | "agent:cancel"
  | "workspace:read"
  | "workspace:write";

export function can(identity: Identity | undefined, action: Action, resource?: { projectId?: string; ownerMemberId?: string }) {
  if (!identity) return false;
  if (identity.kind === "admin") return true;
  if (resource?.projectId && identity.projectId !== resource.projectId) return false;
  if (["project:write", "invite:manage", "member:role", "agent:settings"].includes(action)) return false;
  if (action === "agent:cancel" && resource?.ownerMemberId && resource.ownerMemberId !== identity.memberId) return false;
  return true;
}

export function requireIdentity(request: Request, response: Response) {
  if (!request.identity) {
    response.status(401).json({ error: "Authentication required" });
    return undefined;
  }
  return request.identity;
}

export function requirePermission(request: Request, response: Response, action: Action, resource?: { projectId?: string; ownerMemberId?: string }) {
  const identity = requireIdentity(request, response);
  if (!identity) return undefined;
  if (!can(identity, action, resource)) {
    response.status(403).json({ error: "Permission denied" });
    return undefined;
  }
  return identity;
}
