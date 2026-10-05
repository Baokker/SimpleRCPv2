import type { Permission } from "./types.ts";
import { canAccess } from "./logic.ts";
export function visibleActions(grants: Permission[], subject: string): string[] { return ["read", "write", "delete"].filter((action) => canAccess(grants, subject, action)); }
