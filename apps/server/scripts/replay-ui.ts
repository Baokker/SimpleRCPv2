import fs from "node:fs/promises";
import path from "node:path";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import WebSocket from "ws";
import { readTrace, type TraceEvent } from "@simplercp/conflict-guard";

const args = parseArgs(process.argv.slice(2));
const server = args.server ?? "http://127.0.0.1:3000";
const projectId = args.project;
const tracePath = args.trace;
const speed = Math.max(0.01, Number(args.speed ?? 1));
if (!projectId || !tracePath) throw new Error("必须提供 --project 与 --trace");
const events = readTrace(await fs.readFile(path.resolve(tracePath), "utf8"));
const projectResponse = await fetch(`${server}/api/projects/${encodeURIComponent(projectId)}`);
if (!projectResponse.ok) throw new Error(`无法读取项目：${projectResponse.status}`);
const project = await projectResponse.json() as { roomId: string };
const participants = [...new Map(events.filter((event) => event.type === "edit" && isHuman(event.origin)).map((event) => {
  const actor = event.origin as { memberId?: string };
  return [actor.memberId ?? "ghost", actor.memberId ?? "ghost"] as const;
}))].map(([, name]) => name);
if (participants.length === 0) throw new Error("轨迹没有 human 编辑者");
const members = new Map<string, string>();
for (const name of participants) {
  const response = await fetch(`${server}/api/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Replay ${name}` }) });
  if (!response.ok) throw new Error(`无法注册回放成员：${response.status}`);
  const body = await response.json() as { member: { id: string } };
  members.set(name, body.member.id);
}
const resetMember = members.values().next().value as string;
for (const event of events.filter((item) => item.type === "doc_open" && typeof item.text === "string")) {
  await fetch(`${server}/api/projects/${encodeURIComponent(projectId)}/workspace/file`, { method: "PUT", headers: { "content-type": "application/json", "X-SimpleRCP-Member": resetMember }, body: JSON.stringify({ path: event.file, content: event.text }) });
}
const providers = new Map<string, { provider: WebsocketProvider; document: Y.Doc }>();
for (const event of events.filter((item) => item.type === "doc_open" && typeof item.text === "string")) {
  const file = String(event.file);
  for (const [name, memberId] of members) {
    const document = new Y.Doc();
    const provider = new WebsocketProvider(`${server.replace(/^http/, "ws")}/yjs/${encodeURIComponent(projectId)}`, encodeURIComponent(`${project.roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    providers.set(`${name}:${file}`, { provider, document });
  }
}
await Promise.all([...providers.values()].map(({ provider }) => waitForSync(provider)));
const startAt = events[0]?.at ?? 0;
let previousAt = startAt;
for (const event of events.sort((left, right) => left.seq - right.seq)) {
  const delay = Math.max(0, event.at - previousAt) / speed;
  if (delay > 0) await wait(delay);
  previousAt = event.at;
  if (event.type === "edit" && isHuman(event.origin)) {
    const actor = event.origin as { memberId: string };
    const entry = providers.get(`${actor.memberId}:${event.file}`);
    if (!entry) continue;
    const text = entry.document.getText("content");
    entry.document.transact(() => {
      let offset = 0;
      for (const op of event.ops as Array<{ from: number; deleted: string; inserted: string }>) {
        const from = op.from + offset;
        if (op.deleted.length > 0) text.delete(from, op.deleted.length);
        if (op.inserted.length > 0) text.insert(from, op.inserted);
        offset += op.inserted.length - op.deleted.length;
      }
    });
  }
}
console.log(JSON.stringify({ project: projectId, participants, edits: events.filter((event) => event.type === "edit").length, speed }));
for (const { provider, document } of providers.values()) { provider.disconnect(); provider.destroy(); document.destroy(); }

function isHuman(value: unknown): value is { kind: "human"; memberId: string } { return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "human" && typeof (value as { memberId?: unknown }).memberId === "string"); }
function waitForSync(provider: WebsocketProvider) { return new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("回放成员同步超时")), 10_000); provider.once("sync", (synced) => { if (synced) { clearTimeout(timeout); resolve(); } }); provider.once("connection-error", reject); }); }
function wait(delay: number) { return new Promise<void>((resolve) => setTimeout(resolve, delay)); }
function parseArgs(argv: string[]) { const result: Record<string, string> = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index]?.startsWith("--")) result[argv[index]!.slice(2)] = argv[index + 1] ?? ""; return result; }
