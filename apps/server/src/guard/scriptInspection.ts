import fs from "node:fs";
import path from "node:path";
import { decide } from "./decide.js";
import { LEVELS } from "./roles.js";
import { stricter } from "./rules.js";
import type { Action, GuardContext, GuardDecision, GuardRequest, Level } from "./types.js";

// Rules see only the command text, so `bash run.sh` hides whatever run.sh does. Before a script runs,
// read it and judge its commands with the same rules, at the lower of the executor's level and the
// level of whoever last wrote it. Interpreter scripts (node, python, ...) are scanned for the paths,
// commands and URLs they pass to file, process and network APIs.

export interface ScriptSource {
  read(absolutePath: string): string | undefined;
  writerLevel?(absolutePath: string): Level | undefined;
}

export interface ScriptInspection {
  action: Action;
  rules: string[];
  scripts: string[];
}

type ScriptKind = "shell" | "node" | "python" | "perl" | "ruby" | "php";

const MAX_DEPTH = 3;
const MAX_BYTES = 256 * 1024;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "source", "."]);
const INTERPRETERS: Record<string, ScriptKind> = { node: "node", tsx: "node", "ts-node": "node", python: "python", python3: "python", perl: "perl", ruby: "ruby", php: "php" };
const INLINE_FLAGS = new Set(["-c", "-e", "-p", "--eval", "--print", "-m", "-r"]);

export function fileScriptSource(maxBytes = MAX_BYTES, writerLevel?: (absolutePath: string) => Level | undefined): ScriptSource {
  return {
    read(absolutePath) {
      try {
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile() || stat.size > maxBytes) return undefined;
        const content = fs.readFileSync(absolutePath, "utf8");
        return content.includes("\u0000") ? undefined : content;
      } catch {
        return undefined;
      }
    },
    writerLevel
  };
}

export function lowerLevel(left: Level, right: Level | undefined): Level {
  if (!right) return left;
  return LEVELS.indexOf(right) < LEVELS.indexOf(left) ? right : left;
}

function tokenize(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^(['"])(.*)\1$/, "$2"));
}

// Split on unquoted ; && || | and newlines into simple commands; with keepPipes, pipelines stay whole.
export function simpleCommands(command: string, keepPipes = false): string[] {
  const parts: string[] = [];
  let current = "", quote: string | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!, next = command[index + 1];
    if (quote) { if (char === quote) quote = null; current += char; continue; }
    if (char === "'" || char === "\"") { quote = char; current += char; continue; }
    if ((char === "&" && next === "&") || (char === "|" && next === "|")) { parts.push(current); current = ""; index += 1; continue; }
    if (char === ";" || char === "\n" || char === "|" && !keepPipes) { parts.push(current); current = ""; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.replace(/^[\s(]+|[\s)]+$/g, "").replace(/^(?:\w+=\S*\s+)+/, "").trim()).filter(Boolean);
}

function kindFromShebang(content: string): ScriptKind {
  const shebang = content.match(/^#!\s*(\S+)(?:\s+(\S+))?/);
  if (!shebang) return "shell";
  const program = path.basename(shebang[1] === "/usr/bin/env" ? shebang[2] ?? "" : shebang[1]!);
  return INTERPRETERS[program] ?? "shell";
}

interface ScriptTarget { file?: string; definedIn?: string; kind: ScriptKind; lines?: string[]; label: string; packageScript?: boolean }

function packageScriptLines(cwd: string, name: string, source: ScriptSource): string[] | undefined {
  const content = source.read(path.join(cwd, "package.json"));
  if (!content) return undefined;
  try {
    const scripts = (JSON.parse(content) as { scripts?: Record<string, string> }).scripts ?? {};
    const lines = [`pre${name}`, name, `post${name}`].map((key) => scripts[key]).filter((value): value is string => typeof value === "string");
    return lines.length ? lines : undefined;
  } catch {
    return undefined;
  }
}

function makeRecipeLines(cwd: string, target: string | undefined, source: ScriptSource): string[] | undefined {
  const content = source.read(path.join(cwd, "Makefile")) ?? source.read(path.join(cwd, "makefile"));
  if (!content) return undefined;
  const recipes = new Map<string, { deps: string[]; lines: string[] }>();
  let current: { deps: string[]; lines: string[] } | undefined, first: string | undefined;
  for (const raw of content.split(/\r?\n/)) {
    if (raw.startsWith("\t")) { current?.lines.push(raw.slice(1).replace(/^[@+-]+/, "")); continue; }
    const rule = raw.match(/^([\w./-]+)\s*:(?!=)\s*(.*)$/);
    if (!rule) { if (raw.trim()) current = undefined; continue; }
    current = { deps: rule[2]!.split(/\s+/).filter(Boolean), lines: [] };
    recipes.set(rule[1]!, current);
    if (!first && !rule[1]!.startsWith(".")) first = rule[1];
  }
  const lines: string[] = [], seen = new Set<string>();
  const visit = (name: string | undefined) => {
    if (!name || seen.has(name) || seen.size > 32) return;
    seen.add(name);
    const recipe = recipes.get(name);
    if (!recipe) return;
    recipe.deps.forEach(visit);
    lines.push(...recipe.lines);
  };
  visit(target ?? first);
  return lines;
}

function scriptTarget(tokens: string[], cwd: string, source: ScriptSource): ScriptTarget | undefined {
  const executable = path.basename(tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);
  const firstFile = () => {
    for (const arg of args) {
      if (INLINE_FLAGS.has(arg) || /^-[a-z]*[ce]$/i.test(arg)) return undefined;
      if (!arg.startsWith("-")) return arg;
    }
    return undefined;
  };
  if (SHELLS.has(executable)) {
    const file = firstFile();
    return file ? { file: path.resolve(cwd, file), kind: "shell", label: file } : undefined;
  }
  if (INTERPRETERS[executable]) {
    const file = firstFile();
    return file ? { file: path.resolve(cwd, file), kind: INTERPRETERS[executable]!, label: file } : undefined;
  }
  if (["npm", "pnpm", "yarn"].includes(executable)) {
    const [sub, name] = args;
    const script = sub === "run" || sub === "run-script" ? name : sub === "test" || sub === "start" || sub === "t" ? (sub === "t" ? "test" : sub) : executable !== "npm" && sub && !["install", "add", "i", "ci", "update", "remove", "exec", "dlx", "x"].includes(sub) && !sub.startsWith("-") ? sub : undefined;
    const lines = script ? packageScriptLines(cwd, script, source) : undefined;
    return lines ? { kind: "shell", lines, label: `package.json#${script}`, definedIn: path.join(cwd, "package.json"), packageScript: true } : undefined;
  }
  if (executable === "make") {
    const target = args.find((arg) => !arg.startsWith("-") && !arg.includes("="));
    const lines = makeRecipeLines(cwd, target, source);
    const definedIn = [path.join(cwd, "Makefile"), path.join(cwd, "makefile")].find((file) => source.read(file) !== undefined);
    return lines ? { kind: "shell", lines, label: `Makefile#${target ?? "default"}`, definedIn } : undefined;
  }
  if (/[/\\]/.test(tokens[0] ?? "")) {
    const file = path.resolve(cwd, tokens[0]!);
    const content = source.read(file);
    return content === undefined ? undefined : { file, kind: kindFromShebang(content), label: tokens[0]! };
  }
  return undefined;
}

// Builtins that only change shell state; anything that runs code (eval, trap, source) is still judged.
const STATE_BUILTINS = new Set(["set", "export", "unset", "shift", "exit", "return", "true", "false", ":", "local", "readonly", "wait", "echo"]);

function shellLines(content: string): string[] {
  return content.replace(/\\\r?\n/g, " ").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function literals(text: string): string[] {
  return [...text.matchAll(LITERAL)].filter((match) => !(match[1] === "`" && match[2]!.includes("${"))).map((match) => match[2]!);
}

// Each call `name(` with its argument text, balancing parentheses.
function calls(content: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(pattern)) {
    let depth = 1, index = match.index! + match[0].length;
    const start = index;
    while (index < content.length && depth > 0) {
      if (content[index] === "(") depth += 1;
      else if (content[index] === ")") depth -= 1;
      index += 1;
    }
    found.push(content.slice(start, index - 1));
  }
  return found;
}

const API: Record<Exclude<ScriptKind, "shell">, { spawn: RegExp; remove: RegExp; write: RegExp; network: RegExp; dynamic: RegExp; include?: RegExp }> = {
  node: {
    spawn: /\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync|fork)\s*\(/g,
    remove: /\b(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/g,
    write: /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|rename|renameSync)\s*\(/g,
    network: /\b(?:fetch|request|get|post|put|axios)\s*\(/g,
    dynamic: /\beval\s*\(|\bnew\s+Function\s*\(|\bvm\.\w+|\bBuffer\.from\([^)]*['"]base64['"]|\batob\s*\(|\brequire\s*\(\s*[^'"`\s)]/,
    include: /\brequire\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1|\bimport\s+(?:[^'"]+\s+from\s+)?(['"])(\.{1,2}\/[^'"]+)\3/g
  },
  python: {
    spawn: /\b(?:os\.system|os\.popen|subprocess\.\w+|os\.exec\w*)\s*\(/g,
    remove: /\b(?:os\.remove|os\.unlink|os\.rmdir|shutil\.rmtree|\.unlink|\.rmdir)\s*\(/g,
    write: /\b(?:open|shutil\.copy\w*|shutil\.move|os\.rename|\.write_text|\.write_bytes)\s*\(/g,
    network: /\b(?:requests\.\w+|urlopen|urllib\.request\.\w+|httpx\.\w+)\s*\(/g,
    dynamic: /\b(?:eval|exec|compile|__import__)\s*\(|\bbase64\.b64decode\s*\(|\bimportlib\./
  },
  perl: { spawn: /\b(?:system|exec|qx)\s*\(/g, remove: /\b(?:unlink|rmdir|rmtree)\s*\(/g, write: /\bopen\s*\(/g, network: /\b(?:get|post|request)\s*\(/g, dynamic: /\beval\s*[({]|`/ },
  ruby: { spawn: /\b(?:system|exec|spawn|Open3\.\w+)\s*\(/g, remove: /\b(?:File\.delete|FileUtils\.rm\w*|Dir\.rmdir)\s*\(/g, write: /\b(?:File\.write|File\.open|FileUtils\.(?:cp|mv)\w*)\s*\(/g, network: /\b(?:Net::HTTP\.\w+|URI\.open|open-uri)\s*\(/g, dynamic: /\beval\s*\(|`|\binstance_eval\b/ },
  php: { spawn: /\b(?:exec|shell_exec|system|passthru|proc_open|popen)\s*\(/g, remove: /\b(?:unlink|rmdir)\s*\(/g, write: /\b(?:file_put_contents|fopen|copy|rename)\s*\(/g, network: /\b(?:file_get_contents|curl_exec|fsockopen)\s*\(/g, dynamic: /\beval\s*\(|\bbase64_decode\s*\(|`/ }
};

const quote = (value: string) => `'${value.replaceAll("'", "")}'`;
const looksLikePath = (value: string) => /^(?:\.{1,2}\/|\/|~|\$HOME|\$\{HOME\})/.test(value) || /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key)$/.test(value) || /^[\w.-]+\/[\w./-]+$/.test(value);

// Commands that stand for what an interpreter script does, so the ordinary rules can judge them.
function interpreterCommands(content: string, kind: Exclude<ScriptKind, "shell">): { commands: string[]; dynamic: boolean; includes: string[] } {
  const api = API[kind], commands: string[] = [];
  for (const args of calls(content, api.spawn)) {
    const parts = literals(args);
    if (parts.length) commands.push(parts.join(" "));
  }
  for (const args of calls(content, api.remove)) for (const target of literals(args).filter(looksLikePath)) commands.push(`rm -rf ${quote(target)}`);
  for (const args of calls(content, api.write)) {
    const parts = literals(args);
    const isRead = kind === "python" && /^\s*[^,]+,\s*['"]r?b?['"]\s*\)?\s*$/.test(args) || kind === "python" && !args.includes(",");
    for (const target of parts.filter(looksLikePath)) commands.push(isRead ? `cat ${quote(target)}` : `touch ${quote(target)}`);
  }
  for (const args of calls(content, api.network)) for (const url of literals(args).filter((value) => /^https?:\/\//i.test(value))) commands.push(`curl ${quote(url)}`);
  const covered = new Set(commands.flatMap((command) => tokenize(command)));
  for (const value of literals(content)) if (looksLikePath(value) && !covered.has(value)) commands.push(`cat ${quote(value)}`);
  const includes = api.include ? [...content.matchAll(api.include)].map((match) => match[2] ?? match[4]!).filter(Boolean) : [];
  return { commands, dynamic: api.dynamic.test(content), includes };
}

function combine(target: ScriptInspection, action: Action, rules: Iterable<string>) {
  target.action = stricter(target.action, action);
  for (const rule of rules) if (!target.rules.includes(rule)) target.rules.push(rule);
}

function judgeLine(line: string, cwd: string, request: GuardRequest, context: GuardContext, level: Level, source: ScriptSource, depth: number, result: ScriptInspection, packageScript = false) {
  // Script lines run unattended, like Agent tool calls, so they are judged with the Agent's `cd x && ...` handling.
  const relative = path.relative(context.workspaceRoot, cwd);
  const command = relative ? `cd ${/^[\w./-]+$/.test(relative) ? relative : quote(relative)} && ${line}` : line;
  const inner = { ...request, source: "agent" as const, kind: "command" as const, command, cwd: context.workspaceRoot, paths: undefined };
  let decision = decide(inner, { ...context, memberLevel: level, initiatorOnline: true });
  // npm, pnpm and yarn put node_modules/.bin on PATH, so a package script runs local tools as npx would.
  if (packageScript && decision.matchedRules.includes("classify.unknown")) {
    decision = decide({ ...inner, command: relative ? command.replace(` && ${line}`, ` && npx ${line}`) : `npx ${line}` }, { ...context, memberLevel: level, initiatorOnline: true });
  }
  combine(result, decision.action, decision.matchedRules.filter((rule) => rule !== "agent.default").map((rule) => `script.${rule}`));
  if (decision.matchedRules.includes("agent.default")) combine(result, "ask", ["script.agent.default"]);
  const nested = inspectInternal({ ...inner, command: line, cwd }, { ...context, memberLevel: level }, source, depth + 1);
  combine(result, nested.action, nested.rules);
  result.scripts.push(...nested.scripts);
}

function inspectTarget(target: ScriptTarget, cwd: string, request: GuardRequest, context: GuardContext, source: ScriptSource, depth: number, result: ScriptInspection) {
  const definedIn = target.file ?? target.definedIn;
  const writer = definedIn ? source.writerLevel?.(definedIn) : undefined;
  const level = lowerLevel(context.memberLevel, writer);
  if (writer && level !== context.memberLevel) combine(result, "allow", [`script.writer.${writer}`]);
  result.scripts.push(target.label);
  const content = target.file ? source.read(target.file) : undefined;
  if (target.file && content === undefined) return;
  if (target.kind === "shell") {
    let current = target.file ? path.dirname(target.file) : cwd;
    if (target.lines) current = cwd;
    for (const line of target.lines ?? shellLines(content!)) {
      for (const part of simpleCommands(line, true)) {
        const tokens = tokenize(part);
        if (tokens[0] === "cd") {
          current = path.resolve(current, tokens[1] ?? ".");
          judgeLine("ls .", current, request, context, level, source, depth, result);
          continue;
        }
        if (STATE_BUILTINS.has(tokens[0] ?? "") && !/[`$]\(|`/.test(part) && !/[<>]/.test(part)) continue;
        judgeLine(part, current, request, context, level, source, depth, result, target.packageScript);
      }
    }
    return;
  }
  const scanned = interpreterCommands(content!, target.kind);
  for (const command of scanned.commands) judgeLine(command, path.dirname(target.file!), request, context, level, source, depth, result);
  if (scanned.dynamic && level !== "owner") combine(result, "ask", ["script.dynamic-code"]);
  if (depth < MAX_DEPTH) {
    for (const include of scanned.includes) {
      const resolved = path.resolve(path.dirname(target.file!), include);
      const file = [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.ts`].find((candidate) => source.read(candidate) !== undefined);
      if (file) inspectTarget({ file, kind: target.kind, label: path.relative(context.workspaceRoot, file) }, cwd, request, context, source, depth + 1, result);
    }
  }
}

function inspectInternal(request: GuardRequest, context: GuardContext, source: ScriptSource, depth: number): ScriptInspection {
  const result: ScriptInspection = { action: "allow", rules: [], scripts: [] };
  if (request.kind !== "command" || !request.command || depth > MAX_DEPTH) return result;
  let cwd = request.cwd;
  for (const simple of simpleCommands(request.command)) {
    const tokens = tokenize(simple);
    if (tokens[0] === "cd" && tokens[1]) { cwd = path.resolve(cwd, tokens[1]); continue; }
    const target = scriptTarget(tokens, cwd, source);
    if (target) inspectTarget(target, cwd, request, context, source, depth, result);
  }
  return result;
}

export function inspectScripts(request: GuardRequest, context: GuardContext, source: ScriptSource): ScriptInspection {
  return inspectInternal(request, context, source, 0);
}

// Script findings only tighten a decision; a request they tighten is never left to the model or to the initiator.
export function applyScriptInspection(decision: GuardDecision, inspection: ScriptInspection, level: Level, requestSource: GuardRequest["source"]): GuardDecision {
  if (!inspection.rules.length) return decision;
  const action = stricter(decision.action, inspection.action);
  const tightened = action !== decision.action;
  return {
    ...decision,
    action,
    matchedRules: [...decision.matchedRules, ...inspection.rules.filter((rule) => !decision.matchedRules.includes(rule))],
    autoEligible: tightened ? false : decision.autoEligible,
    approvers: action !== "ask" ? null : tightened ? (level === "owner" && requestSource === "terminal" ? "self" : "owners") : decision.approvers
  };
}
