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
  dynamic?: boolean;
}

function tokens(command: string) {
  return command.match(/"[^\"]*"|'[^']*'|\S+/g) ?? [];
}

export function unquote(token: string) {
  let result = "";
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index]!;
    if (character === "\\" && quote !== "single") {
      const next = token[index + 1];
      if (next !== undefined) {
        result += next;
        index += 1;
        continue;
      }
    }
    if (character === "'" && quote !== "double") {
      quote = quote === "single" ? undefined : "single";
      continue;
    }
    if (character === '"' && quote !== "single") {
      quote = quote === "double" ? undefined : "double";
      continue;
    }
    result += character;
  }
  return result;
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

const uploadFileOptions = new Set(["-t", "--upload-file", "--post-file", "--body-file"]);

function uploadOptionValue(token: string) {
  const lower = token.toLowerCase();
  const equals = lower.indexOf("=");
  if (equals < 0) return undefined;
  const option = lower.slice(0, equals);
  return uploadFileOptions.has(option) || option === "-d" || option.startsWith("--data") || option === "-f" || option.startsWith("--form")
    ? token.slice(equals + 1)
    : undefined;
}

export function hasNetworkUpload(command: string) {
  const input = tokens(command).map(unquote);
  for (let index = 1; index < input.length; index += 1) {
    const token = input[index]!;
    const lower = token.toLowerCase();
    const inlineValue = uploadOptionValue(token);
    if (inlineValue !== undefined) {
      const option = lower.slice(0, lower.indexOf("="));
      if (uploadFileOptions.has(option) || option === "-d" || option.startsWith("--data") || option === "-f" || option.startsWith("--form")) return true;
      continue;
    }
    if (uploadFileOptions.has(lower) || lower === "-d" || lower.startsWith("--data") || lower === "-f" || lower.startsWith("--form")) {
      const value = input[index + 1] ?? "";
      if (uploadFileOptions.has(lower) || lower === "-d" || lower.startsWith("--data") || lower === "-f" || lower.startsWith("--form") || value.startsWith("@")) return true;
      index += 1;
    }
  }
  return false;
}

export function parseCommandPaths(command: string, cwd: string): ParsedOperation | undefined {
  const redirections = extractRedirections(command, cwd);
  const input = tokens(redirections.command);
  const name = (input[0] ?? "").replace(/^.*\//, "").replace(/^['\"]|['\"]$/g, "").toLowerCase();
  const values = positional(input);
  let operation: ParsedOperation | undefined;
  if (["cd", "chdir", "pushd", "set-location", "sl"].includes(name)) {
    operation = { commandName: name, action: "navigate", targets: [target(cwd, values[0] ?? "~", "location")] };
  } else if (["rm", "del", "erase", "rd", "rmdir", "remove-item"].includes(name)) {
    operation = values.length ? { commandName: name, action: "delete", targets: values.map((value) => target(cwd, value, "target")) } : undefined;
  } else if (["cat", "type", "gc", "get-content", "head", "tail", "less", "more", "grep", "rg", "find", "ls", "dir", "get-childitem", "gci"].includes(name)) {
    operation = values.length ? { commandName: name, action: "read", targets: values.map((value) => target(cwd, value, "target")) } : undefined;
  } else if (["mkdir", "md", "touch", "tee", "new-item", "ni", "set-content", "add-content"].includes(name)) {
    operation = values.length ? { commandName: name, action: "write", targets: values.map((value) => target(cwd, value, "target")) } : undefined;
  } else if (["mv", "move", "move-item", "mi", "ren", "rename-item", "cp", "copy", "copy-item", "ci"].includes(name)) {
    operation = values.length >= 2
      ? { commandName: name, action: name.startsWith("c") ? "write" : "move", targets: [target(cwd, values[0]!, "source"), target(cwd, values[1]!, "destination")] }
      : undefined;
  } else if (["curl", "wget", "scp", "sftp", "rsync"].includes(name)) {
    const uploadTargets: ParsedTarget[] = [];
    for (let index = 1; index < input.length; index += 1) {
      const token = unquote(input[index]!);
      const lower = token.toLowerCase();
      const inlineValue = uploadOptionValue(token);
      if (inlineValue !== undefined) {
        const option = lower.slice(0, lower.indexOf("="));
        if (uploadFileOptions.has(option)) uploadTargets.push(target(cwd, inlineValue, "source"));
        else if (inlineValue.startsWith("@")) uploadTargets.push(target(cwd, inlineValue.slice(1), "source"));
        continue;
      }
      const takesValue = uploadFileOptions.has(lower) || lower === "-d" || lower.startsWith("--data") || lower === "-f" || lower.startsWith("--form");
      if (takesValue) {
        const value = unquote(input[index + 1] ?? "");
        if (uploadFileOptions.has(lower)) uploadTargets.push(target(cwd, value, "source"));
        else if (value.startsWith("@")) uploadTargets.push(target(cwd, value.slice(1), "source"));
        index += 1;
        continue;
      }
      if (token.startsWith("@")) uploadTargets.push(target(cwd, token.slice(1), "source"));
    }
    operation = uploadTargets.length ? { commandName: name, action: "write", targets: uploadTargets } : undefined;
  }
  if (redirections.targets.length) {
    operation = operation
      ? { ...operation, targets: [...operation.targets, ...redirections.targets], dynamic: operation.dynamic || redirections.dynamic }
      : { commandName: name, action: "write", targets: redirections.targets, dynamic: redirections.dynamic };
  }
  return operation;
}

function extractRedirections(command: string, cwd: string) {
  const targets: ParsedTarget[] = [];
  let dynamic = false;
  let stripped = "";
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < command.length;) {
    const character = command[index]!;
    if (character === "\\" && quote !== "single") {
      stripped += command.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === "'" && quote !== "double") {
      quote = quote === "single" ? undefined : "single";
      stripped += character;
      index += 1;
      continue;
    }
    if (character === '"' && quote !== "single") {
      quote = quote === "double" ? undefined : "double";
      stripped += character;
      index += 1;
      continue;
    }
    if (!quote) {
      const operator = command.slice(index).match(/^(?:\d+)?(?:&>|>>|2>|>\|?|>)/)?.[0];
      if (operator) {
        let targetStart = index + operator.length;
        while (/\s/.test(command[targetStart] ?? "")) targetStart += 1;
        let targetEnd = targetStart;
        if (command[targetStart] === "'" || command[targetStart] === '"') {
          const delimiter = command[targetStart]!;
          targetEnd += 1;
          while (targetEnd < command.length && command[targetEnd] !== delimiter) targetEnd += 1;
          if (targetEnd < command.length) targetEnd += 1;
        } else {
          while (targetEnd < command.length && !/\s/.test(command[targetEnd]!)) targetEnd += 1;
        }
        const raw = command.slice(targetStart, targetEnd);
        if (raw) {
          targets.push(target(cwd, raw, "destination"));
          dynamic ||= /["'\\$`]/.test(raw);
        }
        stripped += " ".repeat(Math.max(1, targetEnd - index));
        index = targetEnd;
        continue;
      }
    }
    stripped += character;
    index += 1;
  }
  return { command: stripped, targets, dynamic };
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
