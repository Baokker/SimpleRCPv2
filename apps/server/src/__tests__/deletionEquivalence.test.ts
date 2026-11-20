import { describe, expect, it } from "vitest";
import { applyAgentProvenance, decide } from "../guard/decide.js";
import { ACTION_ORDER } from "../guard/rules.js";
import type { Action, GuardContext, GuardRequest, Level } from "../guard/types.js";

// Deletion equivalence: a command that removes or overwrites another member's content must decide
// like the deletion it performs. The audit below runs every command against `peer.txt`, a file
// written by another member, and checks the decision from a contributor terminal, a maintainer
// terminal, and an owner agent whose run has read contributor-authored content.

const workspace = "/workspace/project";
const peer = "peer.txt";

const context = (memberLevel: Level): GuardContext => ({
  memberLevel,
  initiatorOnline: true,
  workspaceRoot: workspace,
  platformDataRoot: "/platform/data"
});

const request = (level: Level, command: string, source: "terminal" | "agent"): GuardRequest => ({
  projectId: "project",
  memberId: "member",
  source,
  agentRunId: source === "agent" ? "run" : undefined,
  kind: "command",
  command,
  cwd: workspace
});

const terminal = (level: Level, command: string) => decide(request(level, command, "terminal"), context(level));
const agent = (level: Level, command: string) => decide(request(level, command, "agent"), context(level));
// The owner agent read a contributor-authored file, so the run carries a contributor source. This is
// the same composition that `makeDecision` uses.
const ownerAgent = (command: string) => applyAgentProvenance(agent("owner", command), terminal("contributor", command), "contributor");

const atLeast = (actual: Action, minimum: Action, label: string) => {
  expect(ACTION_ORDER[actual], `${label}: expected at least ${minimum}, received ${actual}`).toBeGreaterThanOrEqual(ACTION_ORDER[minimum]);
};

interface AuditRow {
  command: string;
  contributor: Action;
  maintainer: Action;
  ownerAgent: Action;
  effect: string;
}

// Commands that the specification now classifies as deletions, history changes, writes with an
// unbounded target set, or dependency removal. `git rm --cached` only rewrites the index, so it is a
// recoverable write rather than a deletion.
const classified: AuditRow[] = [
  { command: `git rm ${peer}`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "removes the tracked file" },
  { command: "git rm -r .", contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "removes the tracked tree" },
  { command: `git rm -f ${peer}`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "forces removal of the tracked file" },
  { command: `git rm --cached ${peer}`, contributor: "allow_snapshot", maintainer: "allow_snapshot", ownerAgent: "allow_snapshot", effect: "rewrites the index only, the working file stays" },
  { command: "git branch -d feature", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "deletes a branch reference" },
  { command: "git branch -D feature", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "forces branch deletion, not recoverable from a snapshot" },
  { command: "git tag -d v1.0.0", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "deletes a tag reference" },
  { command: "git update-ref -d refs/heads/feature", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "deletes a reference directly" },
  { command: "git worktree remove ../wt", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "removes a worktree" },
  { command: "git reflog expire --expire=now --all", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "drops reflog history" },
  { command: "git gc --prune=now", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "prunes unreachable objects, not recoverable" },
  { command: "tar -x peer.tar", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "extracts files whose names are not statically known" },
  { command: "tar -xvf peer.tar", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "same, with verbose listing" },
  { command: "unzip peer.zip", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "extracts an archive over existing files" },
  { command: "7z x peer.7z", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "extracts an archive over existing files" },
  { command: "gunzip peer.gz", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "decompresses over an existing file" },
  { command: "bunzip2 peer.bz2", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "decompresses over an existing file" },
  { command: "npm uninstall lodash", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "rewrites the manifest and lock file" },
  { command: "pnpm remove lodash", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "rewrites the manifest and lock file" },
  { command: "yarn rm lodash", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "rewrites the manifest and lock file" },
  { command: "pip uninstall requests", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "removes an installed dependency" }
];

// Deletion routes that already required approval or a snapshot before this change. They are part of
// the audit so a later rule change cannot quietly reopen one of them.
const alreadyCovered: AuditRow[] = [
  { command: `rm ${peer}`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "deletes the file" },
  { command: `git clean -f ${peer}`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "removes an untracked file" },
  { command: `git checkout -- ${peer}`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "restores the file, dropping local content" },
  { command: `git restore ${peer}`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "same as checkout" },
  { command: "git reset --hard", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "discards working-tree changes" },
  { command: "git stash", contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "removes the working-tree change" },
  { command: `git mv ${peer} peer.bak`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "renames the tracked file" },
  { command: "find . -delete", contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "deletes every match" },
  { command: `unlink ${peer}`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "removes the directory entry" },
  { command: `rmdir ${peer}`, contributor: "ask", maintainer: "allow_snapshot", ownerAgent: "ask", effect: "removes a directory" },
  { command: `truncate -s 0 ${peer}`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "empties the file in place" },
  { command: `shred ${peer}`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "overwrites and removes the file" },
  { command: `rsync --delete ${peer} /tmp/x/`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "mirrors a deletion" },
  { command: "xargs rm < list.txt", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "deletes from an argument list" },
  { command: "python3 -c \"import os; os.remove('peer.txt')\"", contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "deletes from inline interpreter code" },
  { command: `: > ${peer}`, contributor: "allow_snapshot", maintainer: "allow_snapshot", ownerAgent: "allow_snapshot", effect: "empties the file through a redirection" },
  { command: `dd if=/dev/zero of=${peer}`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "overwrites the file" },
  { command: `sed -i 's/a/b/' ${peer}`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "rewrites the file in place" },
  { command: `mv ${peer} ../outside/peer.bak`, contributor: "ask", maintainer: "ask", ownerAgent: "ask", effect: "moves the file out of the workspace" }
];

describe("deletion equivalence", () => {
  for (const row of [...classified, ...alreadyCovered]) {
    it(`decides ${row.command} as a change to another member's file`, () => {
      atLeast(terminal("contributor", row.command).action, row.contributor, `contributor ${row.command} (${row.effect})`);
      atLeast(terminal("maintainer", row.command).action, row.maintainer, `maintainer ${row.command} (${row.effect})`);
      atLeast(ownerAgent(row.command).action, row.ownerAgent, `owner agent with a contributor source ${row.command} (${row.effect})`);
    });
  }

  it("requires approval for every deletion-class command at contributor level", () => {
    // `git rm --cached` is the one index-only write in the classified set; it stays recoverable.
    for (const row of [...classified, ...alreadyCovered].filter((entry) => !entry.command.includes("--cached") && !entry.command.startsWith(": >"))) {
      atLeast(terminal("contributor", row.command).action, "ask", `contributor ${row.command}`);
    }
  });

  it("puts a git rm path through the path zone and the snapshot paths", () => {
    const inside = terminal("contributor", `git rm ${peer}`);
    expect(inside.segments.some((segment) => segment.capabilities.includes("delete") && segment.text.includes(peer))).toBe(true);
    expect(inside.segments.some((segment) => segment.capabilities.includes("write") && segment.text.includes(peer))).toBe(false);
    const cached = terminal("contributor", `git rm --cached ${peer}`);
    expect(cached.segments.some((segment) => segment.capabilities.includes("delete"))).toBe(false);
    expect(cached.segments.some((segment) => segment.capabilities.includes("write") && segment.text.includes(peer))).toBe(true);
    const outside = terminal("contributor", "git rm ../outside/peer.txt");
    expect(outside.matchedRules).toContain("hard.outside");
    expect(outside.segments.some((segment) => segment.zone === "outside")).toBe(true);
  });

  it("marks archive extraction as a write with an unbounded target set", () => {
    for (const command of ["tar -x peer.tar", "unzip peer.zip", "gunzip peer.gz"]) {
      const result = terminal("contributor", command);
      expect(result.matchedRules, command).toContain("hard.unbounded-write");
      expect(result.action, command).toBe("ask");
      expect(result.autoEligible, command).toBe(false);
    }
  });

  it("keeps routine inspection commands unblocked", () => {
    for (const command of ["git status", "git log", "npm test", "tar -tf peer.tar", "unzip -l peer.zip", "gunzip -l peer.gz", "git branch", "git tag"]) {
      const result = terminal("contributor", command);
      expect(result.action, command).toBe("allow");
      expect(result.matchedRules, command).not.toContain("hard.unbounded-write");
    }
  });

  it("treats a forced reference deletion as irreversible but a plain one as recoverable", () => {
    expect(terminal("contributor", "git branch -D feature").matchedRules).toContain("hard.nonowner.irreversible");
    expect(terminal("contributor", "git branch -d feature").matchedRules).not.toContain("hard.nonowner.irreversible");
    expect(terminal("contributor", "git gc --prune=now").matchedRules).toContain("hard.nonowner.irreversible");
    expect(terminal("contributor", "git gc").matchedRules).not.toContain("hard.nonowner.irreversible");
  });
});
