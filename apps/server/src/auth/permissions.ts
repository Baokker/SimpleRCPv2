import type { Request, Response } from "express";
import type { Identity } from "./identity.js";

export type Action =
  | "project:list"
  | "project:write"
  | "project:read"
  | "member:join"
  | "member:role"
  | "agent:settings"
  | "agent:read"
  | "agent:create"
  | "agent:cancel"
  | "terminal:input"
  | "workspace:read"
  | "workspace:write";

export function can(identity: Identity | undefined, _action: Action, resource?: { projectId?: string; ownerMemberId?: string }) {
  return true;
}

export function requireIdentity(request: Request, response: Response) {
  if (!request.identity) {
    response.status(401).json({ error: "Member identity is required" });
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
