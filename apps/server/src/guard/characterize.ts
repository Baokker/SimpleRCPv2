import fs from "node:fs";
import path from "node:path";
import type { GuardRequest, GuardSegment, PathZone, Reversibility, Capability } from "./types.js";
import { commandName, legacyRisk } from "./legacy/classifier.js";
import { hasDynamicSyntax, parseCommandPaths } from "./legacy/parser.js";

export interface Characterization {
  segments: GuardSegment[];
  legacyRisk: ReturnType<typeof legacyRisk>;
  unknown: boolean;
  dynamic: boolean;
  gitContext: boolean;
}

function zoneFor(target: string, request: GuardRequest, platformDataRoot: string, protectedPaths: string[], otherWorkspaceRoots: string[]): PathZone {
  const resolved = resolveExistingPrefix(target);
  const workspace = resolveExistingPrefix(request.cwd);
  const metadata = resolveExistingPrefix(platformDataRoot);
  const inWorkspace = resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`);
  const protectedMatch = protectedPaths.some((pattern) => {
    const normalized = pattern.replaceAll("\\", "/");
    const relative = path.relative(workspace, resolved).replaceAll("\\", "/");
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(relative) || new RegExp(`^${escaped}/`).test(relative);
  });
  if (inWorkspace && protectedMatch) return "protected";
  if (inWorkspace) return "workspace";
  if (metadata && (resolved === metadata || resolved.startsWith(`${metadata}${path.sep}`))) return "metadata";
  if (otherWorkspaceRoots.some((root) => {
    const other = resolveExistingPrefix(root);
    return resolved === other || resolved.startsWith(`${other}${path.sep}`);
  })) return "metadata";
  return "outside";
}

function resolveExistingPrefix(target: string) {
  let candidate = path.resolve(target);
  const suffix: string[] = [];
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return path.resolve(target);
    suffix.unshift(path.basename(candidate));
    candidate = parent;
  }
  try {
    return path.resolve(fs.realpathSync(candidate), ...suffix);
  } catch {
    return path.resolve(target);
  }
}

function gitSubcommand(command: string) {
  const input = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  for (let index = 1; index < input.length; index += 1) {
    const token = input[index]!.replace(/^['"]|['"]$/g, "");
    if (token.startsWith("-")) {
      if (["-c", "--git-dir", "--work-tree", "-C"].includes(token)) index += 1;
      continue;
    }
    return token.toLowerCase();
  }
  return "";
}

function hasGitContextOption(command: string) {
  if (commandName(command) !== "git") return false;
  const input = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return input.some((token, index) => {
    const value = token.replace(/^['"]|['"]$/g, "");
    if (["-C", "--git-dir", "--work-tree", "-c"].includes(value)) return true;
    return index > 0 && /^--(?:git-dir|work-tree)=/.test(value);
  });
}

function capabilitiesFor(name: string, kind: GuardRequest["kind"], command: string): Capability[] {
  if (kind === "read") return ["read"];
  if (kind === "edit") return ["write"];
  if (kind === "fetch") return ["network"];
  if (name === "find") {
    if (/(?:^|\s)-(?:delete|exec|execdir|ok|fprint\S*)\b/i.test(command)) return command.includes("-delete") || /-fprint/i.test(command) ? ["delete"] : ["exec"];
    return ["read"];
  }
  if (["cat", "ls", "dir", "pwd", "grep", "rg", "head", "tail", "less", "more"].includes(name)) return ["read"];
  if (name === "git") {
    const subcommand = gitSubcommand(command);
    if (["status", "diff", "log", "show", "branch", "rev-parse"].includes(subcommand)) return ["read"];
    if (["push", "pull", "fetch", "clone", "remote"].includes(subcommand)) return ["network"];
    if (["checkout", "stash"].includes(subcommand)) return ["write"];
    if (subcommand === "clean") return ["delete"];
    if (["reset", "rebase", "commit", "merge"].includes(subcommand)) return ["history"];
  }
  if (["rm", "del", "erase", "rmdir", "rd", "remove-item"].includes(name)) return ["delete"];
  if (["chmod", "chown", "chgrp", "sudo", "su", "doas"].includes(name)) return ["privilege"];
  if (["kill", "killall", "pkill", "taskkill", "stop-process"].includes(name)) return ["process"];
  if (["npm", "pnpm", "yarn", "pip", "pip3", "apt", "apt-get", "brew", "cargo", "go"].includes(name)) return ["install"];
  if (["curl", "wget", "scp", "sftp", "ssh", "rsync"].includes(name)) return ["network"];
  if (name === "git" && /\b(push|pull|fetch|clone|remote)\b/i.test(command)) return ["network"];
  if (name === "git" && /\b(checkout|stash|clean)\b/i.test(command)) return ["write"];
  if (name === "git" && /\b(reset|rebase|commit|merge)\b/i.test(command)) return ["history"];
  if (["mkdir", "md", "touch", "tee", "cp", "copy", "mv", "move", "new-item", "set-content", "add-content"].includes(name)) return ["write"];
  return ["exec"];
}

function reversibilityFor(name: string, command: string, capabilities: Capability[], kind: GuardRequest["kind"]): Reversibility {
  if (kind === "read" || kind === "fetch" && !/\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "reversible";
  const subcommand = name === "git" ? gitSubcommand(command) : "";
  if (name === "git" && (subcommand === "push" || subcommand === "reset" && /(?:^|\s)--hard(?:\s|$)/i.test(command))) return "irreversible";
  if (/\bkill(?:all|\s)|\bshutdown\b|\breboot\b|\bsudo\b|\b(curl|wget)\b.*\|.*\b(sh|bash|zsh)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && /\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && (name === "scp" || name === "rsync" || /(?:^|\s)(?:-d|--data\w*|-F|--form\w*|-T|--upload-file)(?:\s|=)/i.test(command))) return "irreversible";
  if (name === "git" && subcommand === "clean") return "irreversible";
  if (capabilities.some((capability) => ["delete", "write", "history", "install"].includes(capability))) return "snapshot";
  return "reversible";
}

export function characterize(request: GuardRequest, platformDataRoot: string, protectedPaths: string[] = [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"], otherWorkspaceRoots: string[] = []): Characterization {
  const command = request.command ?? request.url ?? request.paths?.join(" ") ?? request.kind;
  if (request.source === "agent" && request.kind === "command" && /\r?\n/.test(command)) {
    const results = command.split(/\r?\n/).filter((line) => line.trim()).map((line) => characterize({ ...request, command: line }, platformDataRoot, protectedPaths, otherWorkspaceRoots));
    return {
      segments: results.flatMap((result) => result.segments),
      legacyRisk: results.some((result) => result.legacyRisk === "dangerous") ? "dangerous" : results.some((result) => result.legacyRisk === "risky") ? "risky" : results.every((result) => result.legacyRisk === "safe") ? "safe" : "unknown",
      unknown: results.some((result) => result.unknown),
      dynamic: results.some((result) => result.dynamic),
      gitContext: results.some((result) => result.gitContext)
    };
  }
  if (request.source === "agent" && request.kind === "command") {
    const prefix = command.match(/^\s*cd\s+([^;&]+?)\s*&&\s*(.+)$/i);
    const rawDirectory = prefix?.[1]?.trim();
    const unsafePrefix = rawDirectory !== undefined && (/["'\\$`]/.test(rawDirectory) || /^[~-]/.test(rawDirectory));
    if (prefix && !unsafePrefix) {
      const directory = path.resolve(request.cwd, rawDirectory!.replace(/^['"]|['"]$/g, ""));
      const directoryZone = zoneFor(directory, request, platformDataRoot, protectedPaths, otherWorkspaceRoots);
      if (directoryZone !== "workspace") {
        return {
          segments: [{ text: directory, capabilities: ["exec"], zone: directoryZone, reversibility: "reversible" }],
          legacyRisk: "risky",
          unknown: false,
          dynamic: /["'\\$`]/.test(prefix[1]!),
          gitContext: false
        };
      }
      const rest = characterize({ ...request, command: prefix[2], cwd: directory }, platformDataRoot, protectedPaths, otherWorkspaceRoots);
      return {
        ...rest,
        segments: [{ text: prefix[1]!, capabilities: ["exec"], zone: "workspace", reversibility: "reversible" }, ...rest.segments]
      };
    }
  }
  const name = request.kind === "command" ? commandName(command) : request.kind;
  const parsed = request.kind === "command" ? parseCommandPaths(command, request.cwd) : undefined;
  const agentPipe = request.source === "agent" && /\|/.test(command) && /\b(curl|wget|ssh|scp)\b/i.test(command);
  const dynamic = request.kind === "command" && !agentPipe && (hasDynamicSyntax(command) || parsed?.dynamic === true);
  const targetItems = parsed?.targets ?? request.paths?.map((target) => ({ raw: target, resolvedPath: path.resolve(request.cwd, target), role: "target" as const })) ?? [];
  const metadataReference = request.kind === "command" && command.includes("$SIMPLERCP_DATA_DIR");
  const baseCapabilities = capabilitiesFor(name, request.kind, command);
  let capabilities: Capability[] = baseCapabilities;
  if (parsed?.action === "delete") capabilities = ["delete"];
  if (parsed?.action === "write" && !["curl", "wget", "scp", "sftp", "rsync"].includes(name)) {
    capabilities = baseCapabilities.includes("exec") ? ["write"] : [...baseCapabilities, "write"];
  }
  const reversibility = agentPipe ? "reversible" : reversibilityFor(name, command, capabilities, request.kind);
  const legacy = request.kind === "command" ? legacyRisk(command) : request.kind === "read" ? "safe" : "risky";
  const segments: GuardSegment[] = (targetItems.length ? targetItems : [{ raw: request.cwd, resolvedPath: request.cwd, role: "location" as const }]).map((item, index) => {
    const segmentCapabilities = item.role === "destination" ? ["write"] as Capability[] : capabilities;
    const segmentReversibility = agentPipe
      ? "reversible" as const
      : legacy === "dangerous" && segmentCapabilities.every((capability) => capability === "exec")
      ? "irreversible" as const
      : reversibilityFor(name, command, segmentCapabilities, request.kind);
    return {
      text: index === 0 ? command : item.resolvedPath,
      capabilities: segmentCapabilities,
      zone: zoneFor(item.resolvedPath, request, platformDataRoot, protectedPaths, otherWorkspaceRoots),
      reversibility: segmentReversibility
    };
  });
  if (dynamic) segments.push({ text: command, capabilities: ["exec"], zone: "outside", reversibility: "irreversible" });
  if (metadataReference) segments.push({ text: "$SIMPLERCP_DATA_DIR", capabilities: ["read"], zone: "metadata", reversibility: "reversible" });
  return { segments, legacyRisk: legacy, unknown: legacy === "unknown", dynamic, gitContext: hasGitContextOption(command) };
}
