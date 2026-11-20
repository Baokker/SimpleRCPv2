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
  // The command writes a set of paths it does not name, so the target set cannot be bounded
  // statically and the decision is at least an approval.
  unboundedWrite: boolean;
}

const plainDownloadToShellPattern = /^\s*(curl|wget)\s+[^;&|<>`$()]*\|\s*(sh|bash|zsh)\s*$/i;

const directoryCommands = new Set(["cd", "chdir", "pushd", "popd", "set-location", "sl"]);

function shellSegments(command: string, multiline: boolean) {
  const parts: { command: string; next: string }[] = [];
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
    if (quote || !("|;&".includes(character) || multiline && character === "\n")) continue;
    if ((character === "&" && (command[index + 1] === ">" || /[<>]/.test(command[index - 1] ?? ""))) ||
        (character === "|" && command[index - 1] === ">")) continue;
    const part = command.slice(start, index).trim();
    let next = character;
    if (command[index + 1] === character && (character === "&" || character === "|")) {
      next += character;
      index += 1;
    }
    if (part) parts.push({ command: part, next });
    start = index + 1;
  }
  const finalPart = command.slice(start).trim();
  if (finalPart) parts.push({ command: finalPart, next: "" });
  return parts;
}

export function changesShellDirectory(command: string) {
  return shellSegments(command, true).some((part) => directoryCommands.has(commandName(part.command)));
}

export function splitShellCommands(command: string) {
  const parts = shellSegments(command, false);
  return parts.length > 1 ? parts.map((part) => part.command) : [];
}

export function stripHereDocument(command: string) {
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

function zoneFor(target: string, workspaceRoot: string, platformDataRoot: string, protectedPaths: string[], otherWorkspaceRoots: string[]): PathZone {
  const resolved = resolveExistingPrefix(target);
  const workspace = resolveExistingPrefix(workspaceRoot);
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
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTDIR") return path.resolve(target);
      if (code !== "ENOENT") throw error;
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

function packageManagerCapability(name: string, command: string): Capability[] {
  const input = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const subcommand = input.slice(1).find((token) => !token.startsWith("-"))?.replace(/^['"]|['"]$/g, "").toLowerCase();
  // Removing a dependency rewrites the manifest and the lock file. Like installation it is not
  // recoverable from a snapshot of the tracked files, so it takes the same capability.
  const removal = ["npm", "pnpm", "yarn"].includes(name)
    ? ["uninstall", "remove", "rm"].includes(subcommand ?? "")
    : ["pip", "pip3"].includes(name) && subcommand === "uninstall";
  const install = ["install", "add", "ci", "i", "update", "upgrade", "sync"].includes(subcommand ?? "") || name === "yarn" && subcommand === undefined || removal;
  return install || /^(?:pip|tool)\s+install\b/.test(input.slice(1).join(" ")) ? ["install"] : ["exec"];
}

// Git subcommands that remove tracked content or rewrite references. The four-level matrix decides
// them as deletions or history changes instead of ordinary execution.
function gitSubcommandCapability(command: string): Capability[] | undefined {
  const subcommand = gitSubcommand(command);
  const flag = (pattern: RegExp) => pattern.test(command);
  if (subcommand === "rm") return flag(/(?:^|\s)--cached(?:\s|$)/) ? ["write"] : ["delete"];
  if (subcommand === "branch" && flag(/(?:^|\s)(?:-d|-D|--delete|-m|-M|--move|-f|--force)(?:\s|$)/)) return ["history"];
  if (subcommand === "tag" && flag(/(?:^|\s)(?:-d|--delete)(?:\s|$)/)) return ["history"];
  if (subcommand === "update-ref" || subcommand === "reflog" || subcommand === "gc") return ["history"];
  if (subcommand === "worktree" && flag(/(?:^|\s)(?:remove|prune)(?:\s|$)/)) return ["history"];
  return undefined;
}

// A forced or pruned reference deletion cannot be restored from a working-tree snapshot.
function gitIrreversible(name: string, command: string) {
  if (name !== "git") return false;
  const subcommand = gitSubcommand(command);
  if (subcommand === "push" || subcommand === "clean") return true;
  if (subcommand === "reset" && /(?:^|\s)--hard(?:\s|$)/.test(command)) return true;
  if (/(?:^|\s)-D(?:\s|$)/.test(command)) return true;
  if (["branch", "tag", "worktree"].includes(subcommand) && /(?:^|\s)(?:--force|-f)(?:\s|$)/.test(command)) return true;
  return /(?:^|\s)--prune(?:=\S*)?(?:\s|$)/.test(command);
}

const archivePrograms = new Set(["tar", "unzip", "7z", "7za", "7zr", "gunzip", "bunzip2"]);

// Extraction writes files whose names come from the archive, so the write target set is not known
// statically. Listing or testing an archive writes nothing.
function extractsArchive(name: string, command: string) {
  if (!archivePrograms.has(name)) return false;
  const input = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
  const flags = input.slice(1).filter((token) => token.startsWith("-"));
  if (name === "tar") return flags.some((token) => /^-[A-Za-z]*x/.test(token) || token === "--extract" || token === "--get");
  if (name === "unzip") return !flags.some((token) => /^-[A-Za-z]*[lvtzp]/.test(token));
  if (name === "gunzip" || name === "bunzip2") return !flags.some((token) => /^-[A-Za-z]*[ltc]/.test(token) || /^--(?:list|test|stdout)$/.test(token));
  const subcommand = input.slice(1).find((token) => !token.startsWith("-"))?.toLowerCase();
  return subcommand === "x" || subcommand === "e";
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
  if (name === "eval") return ["exec_uninspectable"];
  if (name === "find") {
    if (/(?:^|\s)-(?:delete|exec|execdir|ok|fprint\S*)\b/i.test(command)) return command.includes("-delete") || /-fprint/i.test(command) ? ["delete"] : ["exec"];
    return ["read"];
  }
  if (["cat", "ls", "dir", "pwd", "grep", "rg", "head", "tail", "less", "more"].includes(name)) return ["read"];
  if (name === "git") {
    const destructive = gitSubcommandCapability(command);
    if (destructive) return destructive;
    const subcommand = gitSubcommand(command);
    if (["status", "diff", "log", "show", "branch", "rev-parse"].includes(subcommand)) return ["read"];
    if (subcommand === "stash") return ["list", "show"].includes(gitStashSubcommand(command)) ? ["read"] : ["delete"];
    if (["push", "pull", "fetch", "clone", "remote"].includes(subcommand)) return ["network"];
    if (["checkout", "restore", "clean"].includes(subcommand)) return ["delete"];
    if (["reset", "rebase", "commit", "merge"].includes(subcommand)) return ["history"];
  }
  if (extractsArchive(name, command)) return ["write"];
  if (["rm", "del", "erase", "rmdir", "rd", "remove-item"].includes(name)) return ["delete"];
  if (["chmod", "chown", "chgrp", "sudo", "su", "doas"].includes(name)) return ["privilege"];
  if (["kill", "killall", "pkill", "taskkill", "stop-process"].includes(name)) return ["process"];
  if (["npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "apt", "apt-get", "brew", "cargo", "go"].includes(name)) return packageManagerCapability(name, command);
  if (["python", "python3"].includes(name) && /\s-m\s+pip\s+install\b/.test(command)) return ["install"];
  if (["curl", "wget", "scp", "sftp", "ssh", "rsync"].includes(name)) return ["network"];
  if (name === "git" && /\b(push|pull|fetch|clone|remote)\b/i.test(command)) return ["network"];
  if (name === "git" && /\b(checkout|restore|stash|clean)\b/i.test(command)) return ["delete"];
  if (name === "git" && /\b(reset|rebase|commit|merge)\b/i.test(command)) return ["history"];
  if (["mkdir", "md", "touch", "tee", "cp", "copy", "mv", "move", "new-item", "set-content", "add-content"].includes(name)) return ["write"];
  return ["exec"];
}

function reversibilityFor(name: string, command: string, capabilities: Capability[], kind: GuardRequest["kind"]): Reversibility {
  if (kind === "read" || kind === "fetch" && !/\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "reversible";
  if (gitIrreversible(name, command)) return "irreversible";
  if (capabilities.includes("process") || /(?:^|[\s|;&(])(?:kill|pkill|killall|taskkill|stop-process)(?=\s|$)/i.test(command)) return "irreversible";
  if (/\bshutdown\b|\breboot\b|\bsudo\b|\b(curl|wget)\b.*\|.*\b(sh|bash|zsh)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && /\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(command)) return "irreversible";
  if (capabilities.includes("network") && (name === "scp" || name === "rsync" || hasNetworkUpload(command))) return "irreversible";
  if (capabilities.includes("install")) return "irreversible";
  if (capabilities.some((capability) => ["delete", "write", "history"].includes(capability))) return "snapshot";
  return "reversible";
}

export function characterize(request: GuardRequest, platformDataRoot: string, protectedPaths: string[] = [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"], otherWorkspaceRoots: string[] = [], workspaceRoot = request.cwd): Characterization {
  const rawCommand = request.command ?? request.url ?? request.paths?.join(" ") ?? request.kind;
  const command = request.source === "agent" && request.kind === "command"
    ? stripHereDocument(rawCommand)
    : rawCommand;
  const agentShell = request.source === "agent" && request.kind === "command";
  const plainDownloadToShell = agentShell && plainDownloadToShellPattern.test(command);
  const zone = (target: string) => zoneFor(target, workspaceRoot, platformDataRoot, protectedPaths, otherWorkspaceRoots);
  if (request.kind === "command" && !plainDownloadToShell) {
    const parts = shellSegments(command, agentShell);
    if (parts.length > 1) {
      let directories = new Set<string | undefined>([request.cwd]);
      const skippedDirectories = new Set<string | undefined>();
      const results: Characterization[] = [];
      for (const [index, part] of parts.entries()) {
        const previous = parts[index - 1]?.next;
        const nextDirectories = new Set<string | undefined>();
        for (const directory of directories) {
          const cwd = directory ?? request.cwd;
          results.push(characterizeSegment({ ...request, cwd }, part.command, zone, directory === undefined));
          if (!agentShell || !directoryCommands.has(commandName(part.command)) || previous === "|" || part.next === "|" || part.next === "&") {
            nextDirectories.add(directory);
            continue;
          }
          nextDirectories.add(directory === undefined ? undefined : directoryTarget(part.command, cwd));
          if (part.next === "&&") skippedDirectories.add(directory);
          if (previous === "||" || part.next !== "&&") nextDirectories.add(directory);
        }
        if (part.next !== "&&" && part.next !== "|") {
          for (const skipped of skippedDirectories) nextDirectories.add(skipped);
          skippedDirectories.clear();
        }
        directories = nextDirectories;
      }
      const downloadExecute = hasDownloadExecute(command, parts.map((part) => part.command));
      return {
        segments: [...results.flatMap((result) => result.segments), ...(downloadExecute ? [{ text: command, capabilities: ["network", "exec"] as Capability[], zone: "workspace" as PathZone, reversibility: "irreversible" as Reversibility }] : [])],
        legacyRisk: results.some((result) => result.legacyRisk === "dangerous") ? "dangerous" : results.some((result) => result.legacyRisk === "risky") ? "risky" : results.every((result) => result.legacyRisk === "safe") ? "safe" : "unknown",
        unknown: results.some((result) => result.unknown),
        dynamic: results.some((result) => result.dynamic) || hasInterpreterPipe(command) || hasEvalCommand(command),
        gitContext: results.some((result) => result.gitContext),
        plainDownloadToShell: false,
        downloadExecute,
        unboundedWrite: results.some((result) => result.unboundedWrite)
      };
    }
  }
  return characterizeSegment(request, command, zone, false, plainDownloadToShell);
}

function directoryTarget(command: string, cwd: string) {
  const target = parseCommandPaths(command, cwd)?.targets.find((item) => item.role === "location");
  if (!target || !/^(?:[\w./][\w./-]*|'[\w./][\w ./-]*'|"[\w./][\w ./-]*")$/.test(target.raw)) return undefined;
  return resolveExistingPrefix(target.resolvedPath);
}

function characterizeSegment(request: GuardRequest, command: string, zone: (target: string) => PathZone, unknownDirectory: boolean, plainDownloadToShell = false): Characterization {
  const name = request.kind === "command" ? commandName(command) : request.kind;
  const parsed = request.kind === "command" ? parseCommandPaths(command, request.cwd) : undefined;
  const changesDirectory = request.source === "agent" && directoryCommands.has(name);
  const dynamic = unknownDirectory || request.kind === "command" && (parsed?.dynamic === true || (changesDirectory ? directoryTarget(command, request.cwd) === undefined : hasDynamicSyntax(command)));
  const targetItems = parsed?.targets ?? request.paths?.map((target) => ({ raw: target, resolvedPath: path.resolve(request.cwd, unquote(target)), role: "target" as const })) ?? [];
  const metadataReference = request.kind === "command" && command.includes("$SIMPLERCP_DATA_DIR");
  const baseCapabilities = capabilitiesFor(name, request.kind, command);
  let capabilities: Capability[] = baseCapabilities;
  const isSedPrint = parsed?.commandName === "sed" && parsed.action === "read";
  if (isSedPrint) capabilities = ["read"];
  if (parsed?.action === "delete") capabilities = ["delete"];
  if (parsed?.targets.some((target) => target.role === "destination") || parsed?.action === "write" && parsed.targets.some((target) => target.role === "target")) {
    if (!["curl", "wget", "scp", "sftp", "rsync"].includes(name)) {
      capabilities = [...baseCapabilities.filter((capability) => capability !== "exec"), "write"];
    }
  }
  const legacy = changesDirectory ? "risky" : isSedPrint ? "safe" : request.kind === "command" ? legacyRisk(command) : request.kind === "read" ? "safe" : "risky";
  const moveRemovesSource = parsed?.action === "move" && parsed.targets.length >= 2;
  const segments: GuardSegment[] = (targetItems.length ? targetItems : [{ raw: request.cwd, resolvedPath: request.cwd, role: "location" as const }]).map((item, index) => {
    const segmentCapabilities: Capability[] = moveRemovesSource && item.role === "source" ? ["delete"] : capabilities;
    const segmentReversibility = legacy === "unknown" || legacy === "dangerous" && segmentCapabilities.every((capability) => capability === "exec")
      ? "irreversible" as const
      : reversibilityFor(name, command, segmentCapabilities, request.kind);
    return {
      text: index === 0 ? command : item.resolvedPath,
      capabilities: segmentCapabilities,
      zone: unknownDirectory && !path.isAbsolute(item.raw) ? "outside" : zone(item.resolvedPath),
      reversibility: segmentReversibility
    };
  });
  if (dynamic) segments.push({ text: command, capabilities: ["exec_uninspectable"], zone: "outside", reversibility: "irreversible" });
  if (hasDownloadExecute(command, [command])) segments.push({ text: command, capabilities: ["network", "exec"], zone: "workspace", reversibility: "irreversible" });
  if (metadataReference) segments.push({ text: "$SIMPLERCP_DATA_DIR", capabilities: ["read"], zone: "metadata", reversibility: "reversible" });
  return { segments, legacyRisk: legacy, unknown: legacy === "unknown", dynamic, gitContext: hasGitContextOption(command), plainDownloadToShell, downloadExecute: hasDownloadExecute(command, [command]), unboundedWrite: request.kind === "command" && extractsArchive(name, command) };
}
