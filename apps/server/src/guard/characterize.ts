import fs from "node:fs";
import path from "node:path";
import type { GuardRequest, GuardSegment, PathZone, Reversibility, Capability } from "./types.js";
import { commandName, legacyRisk } from "./legacy/classifier.js";
import { hasDynamicSyntax, hasNetworkUpload, parseCommandPaths, unquote } from "./legacy/parser.js";

export interface Characterization {
  segments: GuardSegment[];
  legacyRisk: ReturnType<typeof legacyRisk>;
  unknown: boolean;
  dynamic: boolean;
  gitContext: boolean;
  plainDownloadToShell: boolean;
  downloadExecute: boolean;
}

const plainDownloadToShellPattern = /^\s*(curl|wget)\s+[^;&|<>`$()]*\|\s*(sh|bash|zsh)\s*$/i;

export function splitShellCommands(command: string) {
  const parts: string[] = [];
  let start = 0;
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (character === "\\" && quote !== "single") {
      index += 1;
      continue;
    }
    if (character === "'" && quote !== "double") {
      quote = quote === "single" ? undefined : "single";
      continue;
    }
    if (character === '"' && quote !== "single") {
      quote = quote === "double" ? undefined : "double";
      continue;
    }
    if (quote || !["|", ";", "&"].includes(character)) continue;
    const part = command.slice(start, index).trim();
    if (part) parts.push(part);
    if (character === "&" && command[index + 1] === "&") index += 1;
    start = index + 1;
  }
  const finalPart = command.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts.length > 1 ? parts : [];
}

function stripHereDocument(command: string) {
  let normalized = command;
  const markerPattern = /<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\2[^\n]*(?:\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(normalized))) {
    const stripTabs = match[1] === "-";
    const marker = match[3]!;
    const bodyStart = match.index + match[0].length;
    const bodyPattern = stripTabs
      ? new RegExp(`^[\\t]*${marker}[ \\t]*(?:\\r?\\n|$)`, "m")
      : new RegExp(`^${marker}[ \\t]*(?:\\r?\\n|$)`, "m");
    const bodyMatch = bodyPattern.exec(normalized.slice(bodyStart));
    const bodyEnd = bodyMatch ? bodyStart + bodyMatch.index + bodyMatch[0].length : normalized.length;
    normalized = `${normalized.slice(0, match.index)}${normalized.slice(bodyEnd)}`;
    markerPattern.lastIndex = match.index;
  }
  return normalized;
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
  return resolvePathWithLinks(path.resolve(target), new Set<string>());
}

function resolvePathWithLinks(target: string, visited: Set<string>): string {
  if (visited.has(target)) throw new Error(`Symbolic link cycle while resolving ${target}`);
  visited.add(target);
  let candidate = target;
  const suffix: string[] = [];
  while (true) {
    try {
      const stats = fs.lstatSync(candidate);
      if (stats.isSymbolicLink()) {
        const link = fs.readlinkSync(candidate);
        const linked = path.isAbsolute(link) ? link : path.resolve(path.dirname(candidate), link);
        return resolvePathWithLinks(path.join(linked, ...suffix), visited);
      }
      return path.resolve(fs.realpathSync(candidate), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) return path.resolve(target);
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function downloadOutputPath(command: string): string | undefined {
  const input = command.match(/"[^\"]*"|'[^']*'|\S+/g) ?? [];
  const name = commandName(command);
  if (!["curl", "wget"].includes(name)) return undefined;
  const options = name === "curl" ? new Set(["-o", "--output"]) : new Set(["-o", "-O", "--output-document"]);
  for (let index = 1; index < input.length; index += 1) {
    const token = input[index]!;
    const equal = token.indexOf("=");
    const option = (equal >= 0 ? token.slice(0, equal) : token).toLowerCase();
    if (!options.has(option)) continue;
    const value = equal >= 0 ? token.slice(equal + 1) : input[index + 1];
    if (equal < 0) index += 1;
    if (value) return unquote(value);
  }
  return undefined;
}

function interpreterRunsPath(command: string, target: string): boolean {
  const input = (command.match(/"[^\"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
  const executable = path.basename(input[0] ?? "").toLowerCase();
  if (!["sh", "bash", "zsh", "fish", "python", "python3", "node", "perl", "ruby", "php", "powershell", "pwsh"].includes(executable)) return false;
  return input.slice(1).some((value) => path.normalize(value) === path.normalize(target));
}

function hasDownloadExecute(command: string, parts: string[]): boolean {
  for (let index = 0; index < parts.length - 1; index += 1) {
    const output = downloadOutputPath(parts[index]!);
    if (output && parts.slice(index + 1).some((part) => interpreterRunsPath(part, output))) return true;
  }
  return false;
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

function gitStashSubcommand(command: string) {
  const input = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const stashIndex = input.findIndex((token) => token.replace(/^['"]|['"]$/g, "").toLowerCase() === "stash");
  for (let index = stashIndex + 1; index < input.length; index += 1) {
    const token = input[index]!.replace(/^['"]|['"]$/g, "").toLowerCase();
    if (!token.startsWith("-")) return token;
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

function packageManagerCapability(command: string): Capability[] {
  const input = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const subcommand = input.slice(1).find((token) => !token.startsWith("-"))?.replace(/^['"]|['"]$/g, "").toLowerCase();
  return ["install", "add", "ci", "i", "update"].includes(subcommand ?? "") ? ["install"] : ["exec"];
}

function hasInterpreterPipe(command: string) {
  return /\|\s*(?:(?:env\s+)?(?:command\s+)?(?:sh|bash|zsh|fish|python|python3|node|perl|ruby|php|powershell|pwsh)\b)/i.test(command);
}

function hasEvalCommand(command: string) {
  return /(?:^|[;&|]\s*)eval(?:\s|$)/i.test(command);
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
    if (subcommand === "stash") return ["list", "show"].includes(gitStashSubcommand(command)) ? ["read"] : ["delete"];
    if (["push", "pull", "fetch", "clone", "remote"].includes(subcommand)) return ["network"];
    if (["checkout", "restore", "clean"].includes(subcommand)) return ["delete"];
    if (["reset", "rebase", "commit", "merge"].includes(subcommand)) return ["history"];
  }
  if (["rm", "del", "erase", "rmdir", "rd", "remove-item"].includes(name)) return ["delete"];
  if (["chmod", "chown", "chgrp", "sudo", "su", "doas"].includes(name)) return ["privilege"];
  if (["kill", "killall", "pkill", "taskkill", "stop-process"].includes(name)) return ["process"];
  if (["npm", "pnpm", "yarn"].includes(name)) return packageManagerCapability(command);
  if (["pip", "pip3", "apt", "apt-get", "brew", "cargo", "go"].includes(name)) return ["install"];
  if (["curl", "wget", "scp", "sftp", "ssh", "rsync"].includes(name)) return ["network"];
  if (name === "git" && /\b(push|pull|fetch|clone|remote)\b/i.test(command)) return ["network"];
  if (name === "git" && /\b(checkout|restore|stash|clean)\b/i.test(command)) return ["delete"];
  if (name === "git" && /\b(reset|rebase|commit|merge)\b/i.test(command)) return ["history"];
  if (["mkdir", "md", "touch", "tee", "cp", "copy", "mv", "move", "new-item", "set-content", "add-content"].includes(name)) return ["write"];
  return ["exec"];
}

function reversibilityFor(name: string, command: string, capabilities: Capability[], kind: GuardRequest["kind"]): Reversibility {
  if (kind === "read" || kind === "fetch" && !/\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "reversible";
  const subcommand = name === "git" ? gitSubcommand(command) : "";
  if (name === "git" && (subcommand === "push" || subcommand === "clean" || subcommand === "reset" && /(?:^|\s)--hard(?:\s|$)/i.test(command))) return "irreversible";
  if (/\bkill(?:all|\s)|\bshutdown\b|\breboot\b|\bsudo\b|\b(curl|wget)\b.*\|.*\b(sh|bash|zsh)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && /\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && (name === "scp" || name === "rsync" || hasNetworkUpload(command))) return "irreversible";
  if (capabilities.some((capability) => ["delete", "write", "history", "install"].includes(capability))) return "snapshot";
  return "reversible";
}

export function characterize(request: GuardRequest, platformDataRoot: string, protectedPaths: string[] = [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"], otherWorkspaceRoots: string[] = []): Characterization {
  const rawCommand = request.command ?? request.url ?? request.paths?.join(" ") ?? request.kind;
  const command = request.source === "agent" && request.kind === "command"
    ? stripHereDocument(rawCommand)
    : rawCommand;
  if (request.source === "agent" && request.kind === "command" && /\r?\n/.test(command)) {
    const results = command.split(/\r?\n/).filter((line) => line.trim()).map((line) => characterize({ ...request, command: line }, platformDataRoot, protectedPaths, otherWorkspaceRoots));
    return {
      segments: results.flatMap((result) => result.segments),
      legacyRisk: results.some((result) => result.legacyRisk === "dangerous") ? "dangerous" : results.some((result) => result.legacyRisk === "risky") ? "risky" : results.every((result) => result.legacyRisk === "safe") ? "safe" : "unknown",
      unknown: results.some((result) => result.unknown),
      dynamic: results.some((result) => result.dynamic),
      gitContext: results.some((result) => result.gitContext),
      plainDownloadToShell: false,
      downloadExecute: results.some((result) => result.downloadExecute)
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
          gitContext: false,
          plainDownloadToShell: false,
          downloadExecute: false
        };
      }
      const rest = characterize({ ...request, command: prefix[2], cwd: directory }, platformDataRoot, protectedPaths, otherWorkspaceRoots);
      return {
        ...rest,
        segments: [{ text: prefix[1]!, capabilities: ["exec"], zone: "workspace", reversibility: "reversible" }, ...rest.segments],
        plainDownloadToShell: false,
        downloadExecute: rest.downloadExecute
      };
    }
  }
  const plainDownloadToShell = request.source === "agent" && request.kind === "command" && plainDownloadToShellPattern.test(command);
  if (request.kind === "command" && !plainDownloadToShell) {
    const parts = splitShellCommands(command);
    if (parts.length > 1) {
      const results = parts.map((part) => characterize({ ...request, command: part }, platformDataRoot, protectedPaths, otherWorkspaceRoots));
      const downloadExecute = hasDownloadExecute(command, parts);
      return {
        segments: [...results.flatMap((result) => result.segments), ...(downloadExecute ? [{ text: command, capabilities: ["network", "exec"] as Capability[], zone: "workspace" as PathZone, reversibility: "irreversible" as Reversibility }] : [])],
        legacyRisk: results.some((result) => result.legacyRisk === "dangerous") ? "dangerous" : results.some((result) => result.legacyRisk === "risky") ? "risky" : results.every((result) => result.legacyRisk === "safe") ? "safe" : "unknown",
        unknown: results.some((result) => result.unknown),
        dynamic: results.some((result) => result.dynamic) || hasInterpreterPipe(command) || hasEvalCommand(command),
        gitContext: results.some((result) => result.gitContext),
        plainDownloadToShell: false,
        downloadExecute
      };
    }
  }
  const name = request.kind === "command" ? commandName(command) : request.kind;
  const parsed = request.kind === "command" ? parseCommandPaths(command, request.cwd) : undefined;
  const dynamic = request.kind === "command" && (hasDynamicSyntax(command) || parsed?.dynamic === true);
  const targetItems = parsed?.targets ?? request.paths?.map((target) => ({ raw: target, resolvedPath: path.resolve(request.cwd, unquote(target)), role: "target" as const })) ?? [];
  const metadataReference = request.kind === "command" && command.includes("$SIMPLERCP_DATA_DIR");
  const baseCapabilities = capabilitiesFor(name, request.kind, command);
  let capabilities: Capability[] = baseCapabilities;
  if (parsed?.action === "delete") capabilities = ["delete"];
  if ((parsed?.action === "write" || parsed?.targets.some((target) => target.role === "destination"))
    && !["curl", "wget", "scp", "sftp", "rsync"].includes(name)) {
    capabilities = [...baseCapabilities.filter((capability) => capability !== "exec"), "write"];
  }
  const reversibility = reversibilityFor(name, command, capabilities, request.kind);
  const legacy = request.kind === "command" ? legacyRisk(command) : request.kind === "read" ? "safe" : "risky";
  const segments: GuardSegment[] = (targetItems.length ? targetItems : [{ raw: request.cwd, resolvedPath: request.cwd, role: "location" as const }]).map((item, index) => {
    const segmentCapabilities = capabilities;
    const segmentReversibility = legacy === "dangerous" && segmentCapabilities.every((capability) => capability === "exec")
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
  if (hasDownloadExecute(command, [command])) segments.push({ text: command, capabilities: ["network", "exec"], zone: "workspace", reversibility: "irreversible" });
  if (metadataReference) segments.push({ text: "$SIMPLERCP_DATA_DIR", capabilities: ["read"], zone: "metadata", reversibility: "reversible" });
  return { segments, legacyRisk: legacy, unknown: legacy === "unknown", dynamic, gitContext: hasGitContextOption(command), plainDownloadToShell, downloadExecute: hasDownloadExecute(command, [command]) };
}
