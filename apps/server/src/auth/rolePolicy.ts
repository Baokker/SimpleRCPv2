import { LEVELS, roleLevel } from "../guard/roles.js";
import type { Level } from "../guard/types.js";

// Once a project has an owner, members may pick at most this level for themselves;
// anything higher must be granted by an owner.
export const SELF_ASSIGNABLE_LEVEL: Level = "collaborator";

export class RoleChangeError extends Error {
  constructor(message: string, readonly status: 403 | 404) {
    super(message);
  }
}

interface RoleHolder { memberId: string; role: string }

function rank(role: string | undefined) {
  return LEVELS.indexOf(roleLevel(role));
}

export function hasOwner(members: RoleHolder[], exceptMemberId?: string) {
  return members.some((member) => member.memberId !== exceptMemberId && roleLevel(member.role) === "owner");
}

/** Role kept when a member joins or rejoins; never raises privilege once an owner exists. */
export function resolveJoinRole(members: RoleHolder[], current: RoleHolder | undefined, requested: string) {
  if (!hasOwner(members, current?.memberId)) return requested;
  if (current) return rank(requested) <= rank(current.role) ? requested : current.role;
  return rank(requested) <= LEVELS.indexOf(SELF_ASSIGNABLE_LEVEL) ? requested : "";
}

/** A member may lower their own level, or claim any role while the project has no owner. */
export function checkSelfRoleChange(members: RoleHolder[], current: RoleHolder, requested: string) {
  if (!hasOwner(members, current.memberId)) return;
  if (rank(requested) > rank(current.role)) {
    throw new RoleChangeError("Only an owner can raise a member's role", 403);
  }
}

export function checkGrantRole(members: RoleHolder[], granterId: string, targetId: string) {
  const granter = members.find((member) => member.memberId === granterId);
  if (!granter || roleLevel(granter.role) !== "owner") {
    throw new RoleChangeError("Only an owner can change another member's role", 403);
  }
  if (!members.some((member) => member.memberId === targetId)) {
    throw new RoleChangeError("Member not found", 404);
  }
}
