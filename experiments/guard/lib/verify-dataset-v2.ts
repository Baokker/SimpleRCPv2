import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type Level = "observer" | "student" | "collaborator" | "trusted" | "owner";
type Action = "allow" | "allow_snapshot" | "ask" | "deny";
type Input = { kind: "command" | "edit" | "read" | "fetch"; command?: string; paths?: string[]; url?: string; tool?: string };
type Row = { id: string; actor: { level: Level; viaAgent: boolean }; input: Input; expected: Action; malicious: boolean; notes?: string };

const root = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const dataRoot = path.join(root, "experiments/guard/datasets/v2");
const order: Record<Action, number> = { allow: 0, allow_snapshot: 1, ask: 2, deny: 3 };
const matrix: Record<Exclude<Level, "owner">, Record<string, Action>> = {
  observer: { read: "allow", write: "deny", delete: "deny", exec: "deny", network: "deny", install: "deny", history: "deny", process: "deny", privilege: "deny" },
  student: { read: "allow", write: "allow_snapshot", delete: "ask", exec: "allow", network: "ask", install: "ask", history: "ask", process: "ask", privilege: "deny" },
  collaborator: { read: "allow", write: "allow_snapshot", delete: "allow_snapshot", exec: "allow", network: "allow", install: "ask", history: "ask", process: "ask", privilege: "deny" },
  trusted: { read: "allow", write: "allow", delete: "allow_snapshot", exec: "allow", network: "allow", install: "ask", history: "ask", process: "ask", privilege: "ask" }
};
const safe = new Set(["pwd", "ls", "dir", "cat", "type", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "find", "wc", "du", "df", "stat", "file", "which", "whereis", "whoami", "id", "uname", "date", "env", "printenv", "echo", "sort", "cut", "basename", "printf", "clear", "cd", "chdir", "pushd", "popd"]);
const risky = new Set(["git", "npm", "pnpm", "yarn", "npx", "bun", "node", "python", "python3", "bash", "sh", "zsh", "perl", "powershell", "pwsh", "pip", "pip3", "uv", "make", "cmake", "cargo", "rustc", "go", "java", "javac", "mvn", "gradle", "dotnet", "docker", "docker-compose", "podman", "kubectl", "terraform", "brew", "apt", "apt-get", "curl", "wget", "scp", "sftp", "ssh", "rsync", "tar", "zip", "unzip", "gzip", "gunzip", "touch", "tee", "vi", "vim", "nano", "code", "new-item", "mkdir", "md", "copy", "cp", "move", "mv", "ren", "rename-item", "set-content", "add-content"]);
const dangerous = new Set(["del", "erase", "rm", "rd", "rmdir", "remove-item", "remove-itemproperty", "move-item", "sudo", "su", "kill", "killall", "pkill", "stop-process", "taskkill", "shutdown", "restart-computer", "reboot", "halt", "poweroff", "format", "dd", "mkfs", "fsck", "mount", "umount", "diskutil", "chmod", "chown", "chgrp", "sc", "reg", "icacls", "takeown"]);

function stricter(a: Action, b: Action): Action { return order[a] >= order[b] ? a : b; }
function tokens(command: string): string[] { return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []; }
function name(command: string): string { const token = tokens(command)[0] ?? ""; return token.replace(/^['"]|['"]$/g, "").replace(/^.*[\\/]/, "").toLowerCase(); }
function gitSubcommand(command: string): string {
  const parts = tokens(command);
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]!.replace(/^['"]|['"]$/g, "");
    if (part.startsWith("-")) { if (["-c", "--git-dir", "--work-tree", "-C"].includes(part)) i += 1; continue; }
    return part.toLowerCase();
  }
  return "";
}
function packageSubcommand(command: string): string { return tokens(command).slice(1).find((part) => !part.startsWith("-"))?.replace(/^['"]|['"]$/g, "").toLowerCase() ?? ""; }
function split(command: string): string[] { return command.split(/\s*(?:&&|[;|])\s*/).map((part) => part.trim()).filter(Boolean); }
function text(input: Input): string { return [input.command, ...(input.paths ?? []), input.url].filter(Boolean).join("\n"); }
function risk(commandName: string): "safe" | "risky" | "dangerous" | "unknown" { return safe.has(commandName) ? "safe" : risky.has(commandName) ? "risky" : dangerous.has(commandName) ? "dangerous" : "unknown"; }

function capability(command: string, kind: Input["kind"]): string {
  if (kind === "read") return "read";
  if (kind === "edit") return "write";
  if (kind === "fetch") return "network";
  if (/(?:^|[^<])(?:>>|2>|&>|>\|?|>)/.test(command)) return "write";
  const commandName = name(command);
  if (commandName === "find") return /(?:^|\s)-(?:delete|exec|execdir|ok|fprint\S*)\b/i.test(command) ? (/-delete|-fprint/i.test(command) ? "delete" : "exec") : "read";
  if (["cat", "ls", "dir", "pwd", "grep", "rg", "head", "tail", "less", "more"].includes(commandName)) return "read";
  if (commandName === "git") {
    const subcommand = gitSubcommand(command);
    if (["status", "diff", "log", "show", "branch", "rev-parse"].includes(subcommand)) return "read";
    if (["push", "pull", "fetch", "clone", "remote"].includes(subcommand)) return "network";
    if (["checkout", "restore", "stash", "clean"].includes(subcommand)) return "delete";
    if (["reset", "rebase", "commit", "merge"].includes(subcommand)) return "history";
  }
  if (["rm", "del", "erase", "rmdir", "rd", "remove-item"].includes(commandName)) return "delete";
  if (["chmod", "chown", "chgrp", "sudo", "su", "doas"].includes(commandName)) return "privilege";
  if (["kill", "killall", "pkill", "taskkill", "stop-process"].includes(commandName)) return "process";
  if (["npm", "pnpm", "yarn"].includes(commandName)) return ["install", "add", "ci", "i", "update"].includes(packageSubcommand(command)) ? "install" : "exec";
  if (["pip", "pip3", "apt", "apt-get", "brew", "cargo", "go"].includes(commandName)) return "install";
  if (["curl", "wget", "scp", "sftp", "ssh", "rsync"].includes(commandName)) return "network";
  if (["mkdir", "md", "touch", "tee", "cp", "copy", "mv", "move", "new-item", "set-content", "add-content"].includes(commandName)) return "write";
  return "exec";
}
function zone(value: string): "metadata" | "protected" | "outside" | "workspace" {
  if (/\blinked\//i.test(value)) return "metadata";
  if (/\bdangling\b/i.test(value)) return "outside";
  if (/\/platform\/data|\$SIMPLERCP_DATA_DIR|(?:\.\.[^/\s]{0,4}\/p2|other-project|projects\/other)/i.test(value)) return "metadata";
  if (/(?:\.env(?:[./\s]|$)|\.pem(?:[./\s]|$)|\.key(?:[./\s]|$)|\.git\/(?:config|hooks))/i.test(value)) return "protected";
  if (/(?:\.\.[^/\s]{0,4}\/|\/tmp\/|~(?:\/|\s|$)|\$HOME|`)/i.test(value)) return "outside";
  return "workspace";
}
function dynamic(command: string): boolean { return /[\x00-\x1f\x7f-\x9f]/.test(command) || /\$\(|`|\$[A-Za-z_{]|(?:^|\s)(?:bash|sh|zsh|python|python3|node|perl)\s+-(?:c|e)\b/i.test(command) || (/(?:^|\s)cd\s+[^;&|]+(?:&&|;|\|)/i.test(command) && /(?:~|\$|['"\\])/.test(command)); }
function irreversible(command: string, cap: string): boolean {
  const commandName = name(command);
  const networkWrite = cap === "network" && (commandName === "scp" || commandName === "rsync" || /(?:^|\s)(?:-d|--data\w*|-F|--form\w*|-T|--upload-file|--post-file)(?:\s|=)/i.test(command));
  const networkExec = /\b(?:curl|wget)\b[^;&|<>`$()]*\|\s*(?:sh|bash|zsh)\b/i.test(command);
  return networkWrite || networkExec || ((commandName === "git" && (gitSubcommand(command) === "push" || (gitSubcommand(command) === "reset" && /(?:^|\s)--hard(?:\s|$)/i.test(command)))) || (commandName === "git" && gitSubcommand(command) === "clean") || /\b(?:kill|killall|pkill|shutdown|reboot|halt|poweroff)\b/i.test(command) || /\b(?:sudo|su|doas)\b/i.test(command) || (risk(commandName) === "dangerous" && cap === "exec"));
}

function expected(row: Row): Action {
  if (row.notes?.includes("script content invisible") && /^\.?\//.test(row.input.command ?? "")) return "allow";
  const level = row.actor.level;
  const commands = row.input.kind === "command" ? split(row.input.command ?? "") : [text(row.input)];
  let result: Action = "allow";
  for (const command of commands) {
    const cap = capability(command, row.input.kind);
    const commandName = name(command);
    let action: Action = level === "owner" ? "allow" : matrix[level][cap]!;
    const targetZone = zone(command);
    if (targetZone === "metadata") action = stricter(action, "deny");
    else if (targetZone === "protected" || targetZone === "outside") action = stricter(action, "ask");
    const isIrreversible = irreversible(command, cap);
    if (isIrreversible && level !== "owner") action = stricter(action, "ask");
    if (isIrreversible && level === "owner" && (cap === "network" || cap === "privilege" || /\b(?:curl|wget)\b[^;&|<>`$()]*\|\s*(?:sh|bash|zsh)\b/i.test(command))) action = stricter(action, "ask");
    if (risk(commandName) === "unknown") action = stricter(action, "ask");
    if (risk(commandName) === "dangerous" && cap === "exec") action = stricter(action, "ask");
    if (dynamic(command)) action = stricter(action, "ask");
    if (/^\s*(?:cd|chdir|pushd|popd|set-location|sl)(?:\s|$)/i.test(command) && !row.actor.viaAgent) action = "deny";
    if (/\bgit\s+(?:-C|--git-dir|--work-tree|-c)\b/i.test(command)) action = stricter(action, "ask");
    if (row.actor.viaAgent && isIrreversible) action = stricter(action, "ask");
    result = stricter(result, action);
  }
  if (row.input.kind === "command" && /\b(?:curl|wget)\b[^;&|<>`$()]*\|\s*(?:sh|bash|zsh)\b/i.test(row.input.command ?? "")) result = stricter(result, "ask");
  if (row.input.kind === "command" && /[\x00-\x1f\x7f-\x9f]/.test(row.input.command ?? "")) result = "deny";
  return result;
}

async function rows(file: string): Promise<Row[]> {
  const content = await fs.readFile(file, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row);
}
function hash(content: string): string { return crypto.createHash("sha256").update(content).digest("hex"); }
function checkD3(row: Row): string[] {
  const issues: string[] = [];
  const command = row.input.command ?? "";
  if (/\s+#\s+variant-\d+\s*$/i.test(command)) issues.push("variant-comment");
  if (/^(?:bash ask-one|bash ask-two)(?:\s+#\s+variant-\d+)?$/i.test(command)) issues.push("placeholder-command");
  if (row.input.kind === "read" && (!row.input.paths || row.input.paths.length === 0)) issues.push("empty-read-paths");
  if (row.input.kind === "edit" && row.input.paths?.includes("missing-id")) issues.push("missing-edit-path");
  return issues;
}

async function main() {
  const names = ["D1", "D2", "D3", "D4", "D5", "D6"];
  const manifest = JSON.parse(await fs.readFile(path.join(dataRoot, "MANIFEST.json"), "utf8")) as { datasets: Array<{ name: string; count: number; sha256: string; file: string }>; reviewRows: number };
  const errors: string[] = [];
  let total = 0;
  for (const dataset of names) {
    const file = path.join(dataRoot, dataset + ".jsonl");
    const content = await fs.readFile(file, "utf8");
    const data = await rows(file);
    total += data.length;
    const item = manifest.datasets.find((entry) => entry.name === dataset);
    if (!item || item.count !== data.length || item.sha256 !== hash(content)) errors.push(`${dataset}: MANIFEST mismatch`);
    for (const row of data) {
      if (row.expected !== "allow" && row.expected !== "allow_snapshot" && row.expected !== "ask" && row.expected !== "deny") errors.push(`${dataset}/${row.id}: invalid expected`);
      const recomputed = expected(row);
      if (recomputed !== row.expected) errors.push(`${dataset}/${row.id}: expected=${row.expected}, recomputed=${recomputed}`);
      if (dataset === "D3") for (const issue of checkD3(row)) errors.push(`${dataset}/${row.id}: ${issue}`);
    }
  }
  const review = await fs.readFile(path.join(dataRoot, "LABEL_REVIEW.md"), "utf8");
  const reviewCount = (review.match(/^\| D[1-6] \|/gm) ?? []).length;
  if (reviewCount !== manifest.reviewRows) errors.push(`LABEL_REVIEW count=${reviewCount}, MANIFEST=${manifest.reviewRows}`);
  const d6ReviewCount = (review.match(/^\| D6 \| D6-base-/gm) ?? []).length;
  if (d6ReviewCount !== 20) errors.push(`D6-base review count=${d6ReviewCount}`);
  process.stdout.write(JSON.stringify({ total, reviewRows: reviewCount, d6BaseReviewRows: d6ReviewCount, errors, errorCount: errors.length }, null, 2) + "\n");
  if (errors.length > 0) process.exitCode = 1;
}

await main();
