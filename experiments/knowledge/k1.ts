import fs from "node:fs/promises";
import path from "node:path";
import {applyPatch} from "diff";
import {
  applyCaptureOps, createCaptureEngine, replayEvents, VirtualCaptureClock, isCaptureEvent,
  type CaptureEvent, type CaptureConfigInput, type CaptureSuggestion, type CaptureChatEvent
} from "@simplercp/knowledge";
import {benchRoot, type Dataset, type ExperimentConfig, type Task, RunStore, pause, readJson, readJsonl, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";
import {CollaborationClient, editorOffset} from "./collaboration.js";

export async function scriptInput(id: string) {
  const directory = path.join(benchRoot, "scripts/sessions", id);
  const metadata = await readJson(path.join(directory, "session.json"));
  const actions = await readJsonl(path.join(directory, "script.jsonl"));
  const labels = await readJson(path.join(directory, "labels.json"));
  const texts = new Map<string, string>();
  async function scan(directory: string) {
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(full);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|md|ya?ml|py)$/u.test(entry.name)) texts.set(path.relative(path.join(benchRoot, "repos", metadata.repository), full), await fs.readFile(full, "utf8"));
    }
  }
  await scan(path.join(benchRoot, "repos", metadata.repository));
  return {metadata, actions, labels, texts};
}
export async function normalizeScript(id: string, speed = 1) {
  const input = await scriptInput(id);
  const texts = new Map(input.texts);
  const pending: Array<CaptureEvent & {order?: number}> = [];
  let ordinal = 0;
  const add = (at: number, event: any) => pending.push({schemaVersion: 1, seq: 0, at: Math.round(at * 1000 / speed), order: ordinal++, ...event});
  for (const [file, text] of texts) add(0, {type: "docOpen", file, text});
  const currentFiles = new Map<string, string>();
  const runIds = new Map<number, string>();
  const runEvents = new Map<number, any>();
  for (const [index, action] of input.actions.entries()) {
    const at = action.t;
    const member = action.member;
    const before = action.file ? texts.get(action.file) : undefined;
    if (action.type === "join" || action.type === "leave") add(at, {type: "memberPresence", memberId: member, action: action.type});
    if (action.type === "open") {
      add(at, {type: "memberPresence", memberId: member, action: "switchFile", file: action.file, previousFile: currentFiles.get(member)});
      currentFiles.set(member, action.file);
    }
    if (action.type === "cursor") add(at, {type: "cursor", memberId: member, file: action.file,
      position: {line: action.line - 1, character: action.column - 1}, selection: {startLine: action.line - 1, endLine: action.line - 1, startCharacter: action.column - 1, endCharacter: action.column - 1}});
    if (action.type === "edit") {
      if (before === undefined) throw new Error(`Unknown script file: ${action.file}`);
      const start = editorOffset(before, action.at.line, action.at.column);
      if (before.slice(start, start + action.delete) !== action.deletedText) throw new Error(`Script deleted text differs: ${id}/${index}`);
      const ops = [{start, deleteCount: action.delete, insertText: action.insert, deletedText: action.deletedText}];
      const textAfter = applyCaptureOps(before, ops);
      add(at, {type: "edit", actor: member, file: action.file, ops, textBefore: before, textAfter});
      texts.set(action.file, textAfter);
    }
    if (action.type === "fileExternal") {add(at, {type: "fileExternal", file: action.file, change: "change", textBefore: before, textAfter: action.content, hasDocument: false}); texts.set(action.file, action.content);}
    if (action.type === "chat") {
      add(at, {type: "chat", messageId: `${id}-message-${index}`, authorId: member, kind: "member", text: action.text, mentions: action.mentions});
      if (action.run !== undefined && action.mentions?.length) {
        const previous = runEvents.get(action.run);
        if (!previous) throw new Error("Correction references an unknown script run");
        add(at, {type: "agentRun", runId: `${id}-correction-${index}`, memberId: member, sessionId: `${id}-${previous.memberId}`, source: "chat", action: "start", status: "running", prompt: action.text, previousRunId: previous.runId});
        add(at + 0.001, {type: "agentRun", runId: `${id}-correction-${index}`, memberId: member, sessionId: `${id}-${previous.memberId}`, source: "chat", action: "end", status: "completed", prompt: action.text});
      }
    }
    if (action.type === "agentRun") {
      const runId = `${id}-run-${index}`;
      runIds.set(index, runId);
      const event = {type: "agentRun", runId, memberId: member, sessionId: `${id}-${member}`, source: action.agent === "team" ? "chat" : "agent-panel", prompt: action.prompt, ...(action.previousRun === undefined ? {} : {previousRunId: runIds.get(action.previousRun)})};
      runEvents.set(index, event);
      add(at, {...event, action: "start", status: "running"});
      const changes = [], ranges = [];
      for (const write of action.writes) {
        const textBefore = texts.get(write.file);
        if (textBefore === undefined) throw new Error(`Unknown Agent file: ${write.file}`);
        const textAfter = applyPatch(textBefore, write.patch);
        if (textAfter === false) throw new Error("Script Agent patch cannot be applied");
        add(at, {type: "fileExternal", file: write.file, change: "change", textBefore, textAfter, hasDocument: false});
        changes.push({file: write.file, patch: write.patch, beforeText: textBefore, afterText: textAfter});
        let start = 0;
        while (textBefore[start] === textAfter[start] && start < Math.min(textBefore.length, textAfter.length)) start++;
        let end = textAfter.length, oldEnd = textBefore.length;
        while (end > start && oldEnd > start && textAfter[end - 1] === textBefore[oldEnd - 1]) {end--; oldEnd--;}
        if (end > start) ranges.push({file: write.file, start, end, text: textAfter.slice(start, end), ownerId: member});
        texts.set(write.file, textAfter);
      }
      if (action.status !== "interrupted") add(at + action.durationSec, {...event, action: action.status === "failed" ? "failed" : "end", status: action.status, fileChanges: changes, agentRanges: ranges});
    }
    if (action.type === "interrupt") {
      const event = runEvents.get(action.run);
      if (!event) throw new Error("Interrupt references an unknown run");
      add(at, {...event, action: "interrupted", status: "cancelled", interruptedByMemberId: member});
    }
    if (action.type === "agentTool") {
      const event = runEvents.get(action.run);
      if (!event) throw new Error("Tool references an unknown run");
      add(at, {type: "agentTool", runId: event.runId, memberId: event.memberId, tool: "bash", command: action.command, success: action.ok, exitCode: action.ok ? 0 : 1, error: action.ok ? undefined : action.output, traceSeq: index});
    }
  }
  const events = pending.sort((a, b) => a.at - b.at || a.order! - b.order!).map(({order: _order, ...event}, index) => ({...event, seq: index + 1} as CaptureEvent));
  if (events.some(event => !isCaptureEvent(event))) throw new Error("Converted script contains an invalid capture event");
  return {...input, events};
}
const overlap = (candidate: any, ranges: any[]) => ranges.some(range => range.file === candidate.file && range.startLine <= candidate.endLine && candidate.startLine <= range.endLine);
// 采用 captureService.ts 的同源证据去重规则，保留 replayEvents 的原始序列供核查。
export function dedupeSuggestions(suggestions: CaptureSuggestion[]) {
  const retained: CaptureSuggestion[] = [];
  const sources: Set<string>[] = [];
  for (const suggestion of suggestions) {
    const ids = new Set(suggestion.actors.runIds.map(id => `run:${id}`));
    for (const key of ["runId", "previousRunId", "suggestionId"] as const) if (typeof suggestion.evidence[key] === "string") ids.add(`${key}:${suggestion.evidence[key]}`);
    const refs = suggestion.evidence.traceRefs as Array<{runId: string; seq: number}> | undefined;
    if (Array.isArray(refs)) for (const ref of refs) if (ref && typeof ref.runId === "string" && Number.isInteger(ref.seq)) ids.add(`trace:${ref.runId}:${ref.seq}`);
    const chats = suggestion.evidence.chatMessages as Array<{messageId: string}> | undefined;
    if (Array.isArray(chats)) for (const chat of chats) if (typeof chat?.messageId === "string") ids.add(`message:${chat.messageId}`);
    if (ids.size && sources.some(previous => [...ids].some(id => previous.has(id)))) continue;
    retained.push(suggestion); sources.push(ids);
  }
  return retained;
}
export function triggerMetrics(suggestions: CaptureSuggestion[], labels: any, speed = 1, offset = 0) {
  const types = [...new Set([...suggestions.map(item => item.triggerType), ...labels.knowledgeMoments.map((item: any) => item.expectedTrigger)])];
  const matched = new Set<string>();
  const rows = types.map(type => {
    const truth = labels.knowledgeMoments.filter((item: any) => item.expectedTrigger === type);
    const predicted = suggestions.filter(item => item.triggerType === type);
    const delays: number[] = [];
    for (const suggestion of predicted) {
      const label = truth.find((item: any) => !matched.has(item.id) && suggestion.createdAt >= offset + item.tStart * 1000 / speed && suggestion.createdAt <= offset + item.tEnd * 1000 / speed);
      if (label) {matched.add(label.id); delays.push((suggestion.createdAt - offset) * speed - label.tStart * 1000);}
    }
    const tp = delays.length;
    return {type, tp, fp: predicted.length - tp, fn: truth.length - tp, precision: predicted.length ? tp / predicted.length : null, recall: truth.length ? tp / truth.length : null, delaysMs: delays};
  });
  return {byTrigger: rows, truePositives: rows.reduce((n, row) => n + row.tp, 0), predicted: suggestions.length, annotated: labels.knowledgeMoments.length};
}
export function anchorMetrics(events: CaptureEvent[], labels: any, config: CaptureConfigInput = {}, speed = 1) {
  const clock = new VirtualCaptureClock(0);
  const engine = createCaptureEngine({clock, config, onSuggestion() {}});
  let cursor = 0;
  const rows = labels.anchorInference.map((item: any) => {
    const moment = labels.knowledgeMoments.find((label: any) => label.id === item.momentId);
    const endAt = Math.round(moment.tEnd * 1000 / speed);
    while (cursor < events.length && events[cursor].at <= endAt) {const event = events[cursor++]; clock.advanceTo(event.at); engine.process(event);}
    clock.advanceTo(endAt);
    const messages = events.filter((event): event is CaptureChatEvent => event.type === "chat" && event.at >= moment.tStart * 1000 / speed && event.at <= endAt);
    const candidates = engine.infer(messages, endAt);
    return {moment: item.momentId, candidates, top1: candidates.slice(0, 1).some(candidate => overlap(candidate, item.discussedCode)), top3: candidates.slice(0, 3).some(candidate => overlap(candidate, item.discussedCode))};
  });
  engine.dispose();
  return {total: rows.length, top1: rows.filter((row: any) => row.top1).length / rows.length, top3: rows.filter((row: any) => row.top3).length / rows.length, rows};
}
export async function runK1Offline(store: RunStore) {
  for (const id of ["S01", "S02"]) {
    const key = `${id}-offline`;
    if (store.done(key)) continue;
    const input = await normalizeScript(id);
    const suggestions = replayEvents(input.events, {}, input.metadata.durationSeconds * 1000 + 60000);
    const metrics = triggerMetrics(suggestions, input.labels);
    const anchors = anchorMetrics(input.events, input.labels);
    await writeJson(path.join(store.raw(key), "events.json"), input.events);
    await writeJson(path.join(store.raw(key), "suggestions.json"), suggestions);
    await writeJson(path.join(store.raw(key), "anchors.json"), anchors);
    const distractorHits = input.labels.distractors.map((label: any) => ({id: label.id, hits: suggestions.filter(item => item.createdAt >= label.tStart * 1000 && item.createdAt <= label.tEnd * 1000).map(item => item.triggerType)}));
    await store.append({key, completed: true, session: id, condition: "offline", ...metrics, distractorHits, anchors: {total: anchors.total, top1: anchors.top1, top3: anchors.top3}, artifacts: path.relative(store.directory, store.raw(key))});
  }
}
export async function runK1Online(data: Dataset, config: ExperimentConfig, store: RunStore) {
  const api = new PlatformClient(config);
  const status = await api.verifyFor(store.directory);
  if (status.speed !== config.speed) throw new Error("Online capture speed differs from run configuration");
  for (const id of ["S01", "S02"]) {
    const key = `${id}-online`;
    if (store.done(key)) continue;
    const input = await normalizeScript(id, config.speed);
    const task = data.tasks.find(task => task.repository === input.metadata.repository)!;
    const {project, members} = await api.create(task, store.raw(key), key);
    const client = new CollaborationClient(api, project);
    const identities = new Map(input.metadata.members.map((member: string, index: number) => [member, members[index]]));
    const texts = new Map(input.texts);
    const clockStart = Date.now();
    const agentEvents = input.events.filter(event => ["agentRun", "agentTool"].includes(event.type));
    const timeline = [...input.actions.map(action => ({at: action.t * 1000 / config.speed, action})), ...agentEvents.map(event => ({at: event.at, event}))].sort((a, b) => a.at - b.at || Number("action" in a) - Number("action" in b));
    try {
      for (const item of timeline) {
        const at = clockStart + item.at;
        if (at > Date.now()) await pause(at - Date.now());
        if ("event" in item) {
          const event = item.event as any;
          await api.request(api.projectRoute(project, "experiments/capture/agent-event"), members[0], {event: {...event, memberId: identities.get(event.memberId), interruptedByMemberId: event.interruptedByMemberId && identities.get(event.interruptedByMemberId), agentRanges: event.agentRanges?.map((range: any) => ({...range, ownerId: identities.get(range.ownerId)}))}});
          continue;
        }
        const action = item.action;
        const member = String(identities.get(action.member) ?? members[0]);
        if (action.type === "join") await client.join(member);
        if (action.type === "leave") await client.leave(member);
        if (action.type === "open") {await client.document(member, action.file); client.send(member, {type: "open_file", path: action.file});}
        if (action.type === "cursor") client.send(member, {type: "cursor_change", path: action.file, position: {lineNumber: action.line, column: action.column}, selection: {startLineNumber: action.line, endLineNumber: action.line, startColumn: action.column, endColumn: action.column}});
        if (action.type === "chat") await api.request(api.projectRoute(project, "chat"), member, {text: action.text});
        if (action.type === "edit") {
          const before = texts.get(action.file)!;
          const start = editorOffset(before, action.at.line, action.at.column);
          const after = before.slice(0, start) + action.insert + before.slice(start + action.delete);
          await client.edit(member, action.file, before, start, action.delete, action.insert); texts.set(action.file, after);
        }
        if (action.type === "agentRun") for (const write of action.writes) {
          const before = texts.get(write.file)!;
          const after = applyPatch(before, write.patch);
          if (after === false) throw new Error("Online script Agent patch cannot be applied");
          await client.externalWrite(member, write.file, after);
          texts.set(write.file, after);
        }
        if (action.type === "fileExternal") {await client.externalWrite(members[0], action.file, action.content); texts.set(action.file, action.content);}
      }
      await pause(65000 / config.speed);
      const recording = await api.request(api.projectRoute(project, "experiments/recording"), members[0]);
      const replayedRaw = replayEvents(recording.events, recording.config, Date.now());
      const replayed = dedupeSuggestions(replayedRaw);
      const fingerprint = (items: CaptureSuggestion[]) => items.map(item => ({type: item.triggerType, at: item.createdAt, actors: item.actors, anchors: item.suggestedAnchors})).sort((a, b) => a.at - b.at || a.type.localeCompare(b.type));
      const recorded = fingerprint(recording.suggestions), offline = fingerprint(replayed);
      const recordedEqual = recorded.length === offline.length && recorded.every((item, index) => {
        const counterpart = offline[index];
        return item.type === counterpart.type && Math.abs(item.at - counterpart.at) <= 300 && JSON.stringify(item.actors) === JSON.stringify(counterpart.actors) && JSON.stringify(item.anchors) === JSON.stringify(counterpart.anchors);
      });
      const types = (items: CaptureSuggestion[]) => fingerprint(items).map(item => item.type);
      const scriptRaw = replayEvents(input.events, recording.config, input.metadata.durationSeconds * 1000 / config.speed + 65000 / config.speed);
      const scriptSuggestions = dedupeSuggestions(scriptRaw);
      const scriptTypesEqual = JSON.stringify(types(scriptSuggestions)) === JSON.stringify(types(recording.suggestions));
      await writeJson(path.join(store.raw(key), "recording.json"), recording);
      await writeJson(path.join(store.raw(key), "comparison.json"), {recordedEqual, scriptTypesEqual, script: fingerprint(scriptSuggestions), rawScript: fingerprint(scriptRaw), online: fingerprint(recording.suggestions), recordedReplay: fingerprint(replayed), rawReplay: fingerprint(replayedRaw)});
      await store.append({key, completed: true, session: id, condition: "online", recordedEqual, scriptTypesEqual,
        onlineCount: recording.suggestions.length, replayCount: replayed.length, rawReplayCount: replayedRaw.length, scriptCount: scriptSuggestions.length, rawScriptCount: scriptRaw.length,
        agentSource: "script-schema-1", speed: config.speed, artifacts: path.relative(store.directory, store.raw(key))});
    } finally {await client.close();}
  }
}
export async function compareK1Recordings(config: ExperimentConfig, store: RunStore, source: string) {
  for (const id of ["S01", "S02"]) {
    const key = `${id}-comparison`;
    if (store.done(key)) continue;
    const sourceFile = path.join(source, "raw", `${id}-online`, "recording.json");
    const recording = await readJson(sourceFile);
    const input = await normalizeScript(id, config.speed);
    const finalAt = recording.events.at(-1).at + 65000 / config.speed;
    const replayRaw = replayEvents(recording.events, recording.config, finalAt);
    const replay = dedupeSuggestions(replayRaw);
    const scriptRaw = replayEvents(input.events, recording.config, input.metadata.durationSeconds * 1000 / config.speed + 65000 / config.speed);
    const script = dedupeSuggestions(scriptRaw);
    const fingerprint = (items: CaptureSuggestion[]) => items.map(item => ({type: item.triggerType, at: item.createdAt, actors: item.actors, anchors: item.suggestedAnchors})).sort((a, b) => a.at - b.at || a.type.localeCompare(b.type));
    const online = fingerprint(recording.suggestions), offline = fingerprint(replay);
    const recordedEqual = online.length === offline.length && online.every((item, index) => item.type === offline[index].type && Math.abs(item.at - offline[index].at) <= 300 && JSON.stringify(item.actors) === JSON.stringify(offline[index].actors) && JSON.stringify(item.anchors) === JSON.stringify(offline[index].anchors));
    const types = (items: CaptureSuggestion[]) => fingerprint(items).map(item => item.type);
    const scriptTypesEqual = JSON.stringify(types(script)) === JSON.stringify(types(recording.suggestions));
    const rawScriptTypesEqual = JSON.stringify(types(scriptRaw)) === JSON.stringify(types(replayRaw));
    await writeJson(path.join(store.raw(key), "comparison.json"), {online, recordedReplay: offline, rawReplay: fingerprint(replayRaw), script: fingerprint(script), rawScript: fingerprint(scriptRaw)});
    await store.append({key, completed: true, session: id, condition: "recording-comparison", recordedEqual, scriptTypesEqual, rawScriptTypesEqual,
      onlineCount: online.length, replayCount: replay.length, rawReplayCount: replayRaw.length, scriptCount: script.length, rawScriptCount: scriptRaw.length,
      sourceRecording: sourceFile, artifacts: path.relative(store.directory, store.raw(key))});
  }
}
