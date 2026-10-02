export type LegacyRisk = "safe" | "risky" | "dangerous" | "unknown";

const safe = new Set([
  "pwd", "ls", "dir", "cat", "type", "head", "tail", "less", "more", "grep", "egrep",
  "fgrep", "rg", "find", "wc", "du", "df", "stat", "file", "which", "whereis", "whoami",
  "id", "uname", "date", "env", "printenv", "echo", "sort", "cut", "basename", "printf",
  "clear", "cd", "chdir", "pushd", "popd"
]);
const risky = new Set([
  "git", "npm", "pnpm", "yarn", "npx", "bun", "node", "python", "python3", "bash", "sh", "zsh",
  "perl", "powershell", "pwsh", "pip", "pip3", "uv", "make", "cmake", "cargo", "rustc", "go",
  "java", "javac", "mvn", "gradle", "dotnet", "docker", "docker-compose", "podman", "kubectl",
  "terraform", "brew", "apt", "apt-get", "curl", "wget", "scp", "sftp", "ssh", "rsync", "tar",
  "zip", "unzip", "gzip", "gunzip", "touch", "tee", "vi", "vim", "nano", "code", "new-item",
  "mkdir", "md", "copy", "cp", "move", "mv", "ren", "rename-item", "set-content", "add-content"
]);
const dangerous = new Set([
  "del", "erase", "rm", "rd", "rmdir", "remove-item", "remove-itemproperty", "move-item", "sudo",
  "su", "kill", "killall", "pkill", "stop-process", "taskkill", "shutdown", "restart-computer",
  "reboot", "halt", "poweroff", "format", "dd", "mkfs", "fsck", "mount", "umount", "diskutil",
  "chmod", "chown", "chgrp", "sc", "reg", "icacls", "takeown"
]);

export function legacyRisk(command: string | undefined): LegacyRisk {
  const name = command?.trim().match(/^(?:["']([^"']+)["']|(\S+))/)?.[1] ??
    command?.trim().match(/^(?:["']([^"']+)["']|(\S+))/)?.[2];
  if (!name) return "unknown";
  const normalized = name.replace(/^.*\//, "").toLowerCase();
  if (safe.has(normalized)) return "safe";
  if (risky.has(normalized)) return "risky";
  if (dangerous.has(normalized) || normalized.startsWith("mkfs.")) return "dangerous";
  return "unknown";
}

export function commandName(command: string): string {
  const token = command.trim().match(/^(?:["']([^"']+)["']|(\S+))/);
  return (token?.[1] ?? token?.[2] ?? "").replace(/^.*\//, "").toLowerCase();
}
