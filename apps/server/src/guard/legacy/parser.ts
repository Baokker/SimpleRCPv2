import os from "node:os";
import path from "node:path";

export interface ParsedTarget {
  raw: string;
  resolvedPath: string;
  role: "location" | "target" | "source" | "destination";
}

export interface ParsedOperation {
  commandName: string;
  action: "navigate" | "delete" | "read" | "write" | "move";
  targets: ParsedTarget[];
}

function tokens(command: string) {
  return command.match(/"[^\"]*"|'[^']*'|\S+/g) ?? [];
}

function unquote(token: string) {
  return token.startsWith("\"") && token.endsWith("\"") || token.startsWith("'") && token.endsWith("'")
    ? token.slice(1, -1)
    : token;
}

function target(cwd: string, raw: string, role: ParsedTarget["role"]): ParsedTarget {
  const value = unquote(raw);
  const resolvedPath = value === "~"
    ? os.homedir()
    : value.startsWith("~/")
      ? path.resolve(os.homedir(), value.slice(2))
      : path.resolve(cwd, value);
  return { raw: value, resolvedPath, role };
}

function positional(input: string[]) {
  const values: string[] = [];
  for (let index = 1; index < input.length; index += 1) {
    const token = input[index]!;
    if (token.startsWith("-") || (process.platform === "win32" && /^\/[a-z]/i.test(token))) {
      if (["-path", "-literalpath", "-destination", "-newname", "-name"].includes(token.toLowerCase())) {
        const value = input[index + 1];
        if (value && !value.startsWith("-")) values.push(value);
        index += 1;
      }
      continue;
    }
    values.push(token);
  }
  return values;
}

export function parseCommandPaths(command: string, cwd: string): ParsedOperation | undefined {
  const input = tokens(command);
  const name = (input[0] ?? "").replace(/^.*\//, "").replace(/^['\"]|['\"]$/g, "").toLowerCase();
  const values = positional(input);
  if (["cd", "chdir", "pushd", "set-location", "sl"].includes(name)) {
    return { commandName: name, action: "navigate", targets: [target(cwd, values[0] ?? "~", "location")] };
  }
  if (["rm", "del", "erase", "rd", "rmdir", "remove-item"].includes(name)) {
    return values.length ? { commandName: name, action: "delete", targets: values.map((value) => target(cwd, value, "target")) } : undefined;
  }
  if (["cat", "type", "gc", "get-content", "head", "tail", "less", "more", "grep", "rg", "find", "ls", "dir", "get-childitem", "gci"].includes(name)) {
    return values.length ? { commandName: name, action: "read", targets: values.map((value) => target(cwd, value, "target")) } : undefined;
  }
  if (["mkdir", "md", "touch", "tee", "new-item", "ni", "set-content", "add-content"].includes(name)) {
    return values.length ? { commandName: name, action: "write", targets: values.map((value) => target(cwd, value, "target")) } : undefined;
  }
  if (["mv", "move", "move-item", "mi", "ren", "rename-item", "cp", "copy", "copy-item", "ci"].includes(name)) {
    return values.length >= 2
      ? { commandName: name, action: name.startsWith("c") ? "write" : "move", targets: [target(cwd, values[0]!, "source"), target(cwd, values[1]!, "destination")] }
      : undefined;
  }
  if (["curl", "wget", "scp", "sftp", "rsync"].includes(name)) {
    const uploadTargets: ParsedTarget[] = [];
    for (let index = 1; index < input.length; index += 1) {
      const token = unquote(input[index]!);
      const lower = token.toLowerCase();
      const takesValue = lower === "-d" || lower.startsWith("--data") || lower === "-f" || lower.startsWith("--form") || lower === "-t" || lower === "--upload-file";
      if (takesValue) {
        const value = unquote(input[index + 1] ?? "");
        if (value.startsWith("@")) uploadTargets.push(target(cwd, value.slice(1), "source"));
        index += 1;
        continue;
      }
      if (token.startsWith("@")) uploadTargets.push(target(cwd, token.slice(1), "source"));
    }
    return uploadTargets.length ? { commandName: name, action: "write", targets: uploadTargets } : undefined;
  }
  const redirects = [...command.matchAll(/(?:^|\s)(?:\d*)>>?\s*("[^"]*"|'[^']*'|\S+)/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => target(cwd, value, "destination"));
  if (redirects.length) return { commandName: name, action: "write", targets: redirects };
  return undefined;
}

export function hasDynamicSyntax(command: string) {
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === "\\" && quote !== "single") { index += 1; continue; }
    if (character === "'" && quote !== "double") { quote = quote === "single" ? undefined : "single"; continue; }
    if (character === '"' && quote !== "single") { quote = quote === "double" ? undefined : "double"; continue; }
    if (character === "$" || character === "`") {
      if (quote !== "single") return true;
    }
    if (quote) continue;
    if (character !== undefined && "|;&<*?[]{}()\n\r".includes(character)) return true;
  }
  const input = tokens(command).map(unquote);
  const executable = path.basename(input[0] ?? "").toLowerCase();
  const options = input.slice(1).map((value) => value.toLowerCase());
  const shortFlag = (flag: string) => options.some((value) => /^-[a-z]+$/i.test(value) && value.slice(1).includes(flag));
  if (["bash", "sh", "zsh", "python", "python3"].includes(executable) && shortFlag("c")) return true;
  if (["node", "perl"].includes(executable) && shortFlag("e")) return true;
  if (["powershell", "pwsh"].includes(executable) && (options.some((value) => value.startsWith("-command") || value.startsWith("-encodedcommand")) || shortFlag("c"))) return true;
  if (executable === "env" && input.length > 1) return true;
  const first = input[0] ?? "";
  if (first.includes("/") && !["/bin/", "/usr/bin/", "/sbin/", "/usr/sbin/"].some((prefix) => first.startsWith(prefix) && first.slice(prefix.length) && !first.slice(prefix.length).includes("/"))) return true;
  const pathCommands = new Set(["cd", "chdir", "pushd", "set-location", "sl", "rm", "del", "erase", "rd", "rmdir", "remove-item", "cat", "type", "gc", "get-content", "head", "tail", "less", "more", "grep", "rg", "find", "ls", "dir", "get-childitem", "gci", "mkdir", "md", "touch", "tee", "new-item", "ni", "set-content", "add-content", "mv", "move", "move-item", "mi", "ren", "rename-item", "cp", "copy", "copy-item", "ci"]);
  const pathTokenHasEscapes = pathCommands.has(executable) && input.slice(1).some((value) => /["'\\]/.test(value));
  return pathTokenHasEscapes || input.slice(1).some((value) => value.includes("../") || (value.startsWith("~") && !value.startsWith("~/"))) || (!parseCommandPaths(command, process.cwd()) && input.slice(1).some((value) => value.startsWith("/") || value.startsWith("./") || value.startsWith("~/")));
}
