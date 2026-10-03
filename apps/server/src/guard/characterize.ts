import path from "node:path";
import type { GuardRequest, GuardSegment, PathZone, Reversibility, Capability } from "./types.js";
import { commandName, legacyRisk } from "./legacy/classifier.js";
import { hasDynamicSyntax, parseCommandPaths } from "./legacy/parser.js";

export interface Characterization {
  segments: GuardSegment[];
  legacyRisk: ReturnType<typeof legacyRisk>;
  unknown: boolean;
  dynamic: boolean;
}

function zoneFor(target: string, request: GuardRequest, platformDataRoot: string, protectedPaths: string[], otherWorkspaceRoots: string[]): PathZone {
  const resolved = path.resolve(target);
  const workspace = path.resolve(request.cwd);
  const metadata = path.resolve(platformDataRoot);
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
    const other = path.resolve(root);
    return resolved === other || resolved.startsWith(`${other}${path.sep}`);
  })) return "metadata";
  return "outside";
}

function capabilitiesFor(name: string, kind: GuardRequest["kind"], command: string): Capability[] {
  if (kind === "read") return ["read"];
  if (kind === "edit") return ["write"];
  if (kind === "fetch") return ["network"];
  if (["cat", "ls", "dir", "pwd", "grep", "rg", "find", "head", "tail", "less", "more"].includes(name)) return ["read"];
  if (name === "git" && /\b(status|diff|log|show|branch|rev-parse)\b/i.test(command)) return ["read"];
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
  if (/\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bkill(?:all|\s)|\bshutdown\b|\breboot\b|\bsudo\b|\b(curl|wget)\b.*\|.*\b(sh|bash|zsh)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && /\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "irreversible";
  if (capabilities.some((capability) => ["delete", "write", "history", "install"].includes(capability))) return "snapshot";
  return "reversible";
}

export function characterize(request: GuardRequest, platformDataRoot: string, protectedPaths: string[] = [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"], otherWorkspaceRoots: string[] = []): Characterization {
  const command = request.command ?? request.url ?? request.paths?.join(" ") ?? request.kind;
  const name = request.kind === "command" ? commandName(command) : request.kind;
  const dynamic = request.kind === "command" && hasDynamicSyntax(command);
  const parsed = request.kind === "command" ? parseCommandPaths(command, request.cwd) : undefined;
  const targets = parsed?.targets.map((item) => item.resolvedPath) ?? request.paths?.map((target) => path.resolve(request.cwd, target)) ?? [];
  const metadataReference = request.kind === "command" && command.includes("$SIMPLERCP_DATA_DIR");
  const capabilities = capabilitiesFor(name, request.kind, command);
  const reversibility = reversibilityFor(name, command, capabilities, request.kind);
  const segments: GuardSegment[] = (targets.length ? targets : [request.cwd]).map((target, index) => ({
    text: index === 0 ? command : target,
    capabilities,
    zone: zoneFor(target, request, platformDataRoot, protectedPaths, otherWorkspaceRoots),
    reversibility
  }));
  if (dynamic) segments.push({ text: command, capabilities: ["exec"], zone: "outside", reversibility: "irreversible" });
  if (metadataReference) segments.push({ text: "$SIMPLERCP_DATA_DIR", capabilities: ["read"], zone: "metadata", reversibility: "reversible" });
  const legacy = request.kind === "command" ? legacyRisk(command) : request.kind === "read" ? "safe" : "risky";
  return { segments, legacyRisk: legacy, unknown: legacy === "unknown", dynamic };
}
