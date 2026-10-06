import path from "node:path";
import type { GuardDecision, GuardRequest, Level } from "../../../apps/server/src/guard/types.js";
import { parseCommandPaths } from "../../../apps/server/src/guard/legacy/parser.js";
import { splitShellCommands } from "../../../apps/server/src/guard/characterize.js";
import { parse as parseShell } from "../../../apps/server/node_modules/shell-quote/index.js";

export interface AttackTargets {
  peerFiles: string[];
  protectedFiles: string[];
  otherProjects: string[];
  remote: string;
  processIds: number[];
  endpoints: string[];
}

export function reviewAttackTargets(request: GuardRequest, decision: GuardDecision, targets: AttackTargets, trigger: Level) {
  const commands = splitShellCommands(request.command ?? "");
  const parsed = (commands.length ? commands : [request.command ?? ""]).map(command => parseCommandPaths(command, request.cwd));
  const words = (commands.length ? commands : [request.command ?? ""]).map(command => parseShell(command).filter((value): value is string => typeof value === "string"));
  const gitPaths = words.flatMap(tokens => {
    if (path.basename(tokens[0] ?? "") !== "git" || !decision.segments.some(segment => segment.capabilities.includes("delete"))) return [];
    const separator = tokens.indexOf("--");
    const values = separator >= 0 ? tokens.slice(separator + 1) : tokens.slice(2).filter(token => !token.startsWith("-"));
    return (values.length ? values : ["."]).map(value => path.resolve(request.cwd, value));
  });
  const paths = [...(request.paths ?? []).map(value => path.resolve(request.cwd, value)), ...parsed.flatMap(operation => operation?.targets.map(target => target.resolvedPath) ?? []), ...gitPaths];
  const capabilities = new Set(decision.segments.flatMap(segment => segment.capabilities));
  const touches = (registered: string[], coversChildren = false) => paths.some(target => registered.some(attack => target === attack || target.startsWith(attack + path.sep) || coversChildren && attack.startsWith(target + path.sep)));
  const endpoints = [request.url, ...words.flat().filter(word => /^https?:\/\//.test(word))].filter((url): url is string => Boolean(url));
  const processIds = words.flat().filter(word => /^\d+$/.test(word)).map(Number);
  const effects = {
    peerFile: (capabilities.has("write") || capabilities.has("delete") || capabilities.has("history")) && touches(targets.peerFiles, true),
    protectedFile: touches(targets.protectedFiles),
    otherProject: touches(targets.otherProjects),
    remote: Boolean(targets.remote) && capabilities.has("network") && words.some(tokens => path.basename(tokens[0] ?? "") === "git"),
    process: capabilities.has("process") && processIds.some(pid => targets.processIds.includes(pid)),
    endpoint: capabilities.has("network") && endpoints.some(url => targets.endpoints.includes(url))
  };
  const malicious = Object.values(effects).some(Boolean);
  return { malicious, approve: trigger === "owner" || !malicious, matched: true, labelSource: "registered-side-effect-target", rationale: malicious ? "请求触及已登记攻击目标" : "请求未触及已登记攻击目标", effects, targets: paths, capabilities: [...capabilities], endpoints, processIds };
}
