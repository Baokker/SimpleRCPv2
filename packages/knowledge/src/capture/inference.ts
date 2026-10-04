import type { CaptureChatEvent } from "./events.js";
import type { SuggestedAnchor } from "../schema.js";

export interface CaptureActivity { type: "cursor" | "edit" | "presence"; actor: string; file: string; at: number; startLine: number; endLine: number; chars?: number; }
export function inferCoOccurrence(options: {
  messages: CaptureChatEvent[]; activities: CaptureActivity[]; texts: Map<string, string>; from: number; to: number;
  weights: { dwell: number; edits: number; speakers: number; textMatch: number };
}): SuggestedAnchor[] {
  const speakers = new Set(options.messages.map(message => message.authorId));
  const candidates = new Map<string, SuggestedAnchor & { speakers: Set<string> }>();
  const activities = options.activities.filter(activity => speakers.has(activity.actor) && activity.at <= options.to);
  const add = (activity: CaptureActivity, score: number, reason: string) => {
    if (score <= 0) return;
    const first = Math.floor((activity.startLine - 1) / 20);
    const last = Math.floor((activity.endLine - 1) / 20);
    for (let segment = first; segment <= last; segment++) {
      const key = `${activity.file}:${segment}`;
      const maxLine = options.texts.get(activity.file)?.split("\n").length ?? (segment + 1) * 20;
      const item = candidates.get(key) ?? { file: activity.file, startLine: segment * 20 + 1, endLine: Math.min((segment + 1) * 20, maxLine), score: 0, reasons: [], speakers: new Set<string>() };
      item.score += score / (last - first + 1);
      item.speakers.add(activity.actor);
      if (!item.reasons.includes(reason)) item.reasons.push(reason);
      candidates.set(key, item);
    }
  };
  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i]!;
    if (activity.type === "edit") {
      if (activity.at >= options.from) add(activity, (activity.chars ?? 0) * options.weights.edits, "讨论成员的编辑");
    } else if (activity.type === "cursor") {
      const next = activities.slice(i + 1).find(item => (item.type === "cursor" || item.type === "presence") && item.actor === activity.actor);
      const duration = Math.max(0, Math.min(next?.at ?? options.to, options.to) - Math.max(activity.at, options.from));
      add(activity, duration / 1000 * options.weights.dwell, "讨论成员的光标停留");
    }
  }
  const discussion = options.messages.map(message => message.text).join("\n");
  const symbols = new Set(discussion.match(/\b[A-Za-z_$][\w$]{2,}\b/g) ?? []);
  const snippets = [...discussion.matchAll(/`([^`]+)`/g)].map(match => match[1]!);
  for (const candidate of candidates.values()) {
    candidate.score += candidate.speakers.size * options.weights.speakers;
    const filename = candidate.file.split("/").at(-1)!;
    if (discussion.includes(candidate.file) || discussion.includes(filename)) { candidate.score += options.weights.textMatch; candidate.reasons.push("聊天提及文件"); }
    const code = (options.texts.get(candidate.file) ?? "").split("\n").slice(candidate.startLine - 1, candidate.endLine).join("\n");
    if ([...symbols].some(symbol => new RegExp(`\\b${symbol.replace(/\$/g, "\\$")}\\b`).test(code))) { candidate.score += options.weights.textMatch; candidate.reasons.push("聊天提及代码标识符"); }
    if (snippets.some(snippet => code.includes(snippet))) { candidate.score += options.weights.textMatch; candidate.reasons.push("聊天引用代码片段"); }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine).slice(0, 3).map(({ speakers: _speakers, ...candidate }) => candidate);
}
