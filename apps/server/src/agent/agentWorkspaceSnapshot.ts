import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFileChange } from "@simplercp/shared";
import diff from "fast-diff";
import { isIgnoredPath } from "../workspacePolicy.js";

interface SnapshotFile {
  content?: string;
  bytes: Buffer;
}

export type AgentWorkspaceSnapshot = Map<string, SnapshotFile>;

export async function createAgentWorkspaceSnapshot(
  workspacePath: string
): Promise<AgentWorkspaceSnapshot> {
  const snapshot: AgentWorkspaceSnapshot = new Map();
  await readDirectory(workspacePath, "", snapshot);
  return snapshot;
}

export function compareAgentWorkspaceSnapshots(
  before: AgentWorkspaceSnapshot,
  after: AgentWorkspaceSnapshot
): AgentFileChange[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changes: AgentFileChange[] = [];
  for (const file of [...paths].sort((left, right) => left.localeCompare(right))) {
    const previous = before.get(file);
    const current = after.get(file);
    if (previous && current && previous.bytes.equals(current.bytes)) continue;
    if (!previous && current) {
      changes.push({
        file,
        additions: current.content === undefined ? 0 : countLines(current.content),
        deletions: 0,
        status: "added"
      });
      continue;
    }
    if (previous && !current) {
      changes.push({
        file,
        additions: 0,
        deletions: previous.content === undefined ? 0 : countLines(previous.content),
        status: "deleted"
      });
      continue;
    }
    const counts = countTextChanges(previous?.content, current?.content);
    changes.push({
      file,
      additions: counts.additions,
      deletions: counts.deletions,
      status: "modified"
    });
  }
  return changes;
}

async function readDirectory(
  workspacePath: string,
  relativeDirectory: string,
  snapshot: AgentWorkspaceSnapshot
) {
  const absoluteDirectory = path.join(workspacePath, relativeDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory, entry.name)
      : entry.name;
    if (isIgnoredPath(relativePath)) continue;
    if (entry.isDirectory()) {
      await readDirectory(workspacePath, relativePath, snapshot);
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = await fs.readFile(path.join(workspacePath, relativePath));
    snapshot.set(relativePath, {
      bytes,
      content: bytes.includes(0) ? undefined : bytes.toString("utf8")
    });
  }
}

function countTextChanges(previous?: string, current?: string) {
  if (previous === undefined || current === undefined) {
    return { additions: 0, deletions: 0 };
  }
  let additions = 0;
  let deletions = 0;
  for (const [operation, value] of diff(previous, current)) {
    if (operation === diff.INSERT) additions += countLines(value);
    if (operation === diff.DELETE) deletions += countLines(value);
  }
  return { additions, deletions };
}

function countLines(content: string) {
  if (!content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}
