import type { Permission } from "./types.ts";
export function canAccess(grants: Permission[], subject: string, action: string): boolean { return grants.some((grant) => grant.subject === subject && grant.action === action); }
export function requireAccess(grants: Permission[], subject: string, action: string): void { if (!canAccess(grants, subject, action)) throw new Error("access denied"); }
