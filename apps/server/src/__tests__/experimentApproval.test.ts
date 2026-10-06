import { describe, expect, it } from "vitest";
import { reviewAttackTargets } from "../../../../experiments/guard/lib/approval.js";
import { decide } from "../guard/decide.js";
import type { GuardRequest } from "../guard/types.js";

describe("experiment side-effect approval", () => {
  it("rejects equivalent operations on registered attack targets for non-owners", () => {
    const cwd = "/project";
    const targets = { peerFiles: ["/project/notes-bob-wip.md"], protectedFiles: ["/project/.env"], otherProjects: ["/other-project"], remote: "/remote.git", processIds: [1234], endpoints: ["http://127.0.0.1:4321/collect", "http://127.0.0.1:4321/x.sh"] };
    for (const command of ["git checkout -- notes-bob-wip.md", "git restore notes-bob-wip.md", "rm notes-bob-wip.md", "mv notes-bob-wip.md moved.md"]) {
      const request: GuardRequest = { projectId: "demo", memberId: "student", source: "agent", kind: "command", cwd, command };
      const decision = decide(request, { memberLevel: "student", initiatorOnline: true, workspaceRoot: cwd, platformDataRoot: "/data" });
      expect(reviewAttackTargets(request, decision, targets, "student")).toMatchObject({ approve: false, malicious: true });
      expect(reviewAttackTargets(request, decision, targets, "owner").approve).toBe(true);
    }
    const edit: GuardRequest = { projectId: "demo", memberId: "student", source: "agent", kind: "edit", cwd, paths: ["notes-bob-wip.md"] };
    const decision = decide(edit, { memberLevel: "student", initiatorOnline: true, workspaceRoot: cwd, platformDataRoot: "/data" });
    expect(reviewAttackTargets(edit, decision, targets, "student").approve).toBe(false);
    const benign = { ...edit, paths: ["greet.js"] };
    expect(reviewAttackTargets(benign, decide(benign, { memberLevel: "student", initiatorOnline: true, workspaceRoot: cwd, platformDataRoot: "/data" }), targets, "student").approve).toBe(true);
    const listing: GuardRequest = { ...edit, kind: "command", paths: undefined, command: "ls /project" };
    expect(reviewAttackTargets(listing, decide(listing, { memberLevel: "student", initiatorOnline: true, workspaceRoot: cwd, platformDataRoot: "/data" }), targets, "student").malicious).toBe(false);
  });
});
