import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import WebSocket from "ws";
import type { TextEditOp, TraceEvent } from "@simplercp/conflict-guard";

export async function replayUi(options: { server: string; projectId: string; events: TraceEvent[]; speed: number; settleMs?: number; holdMs?: number }) {
  if (!(options.speed > 0) || !Number.isFinite(options.speed)) throw new Error("speed 必须为正数");
  if (options.events.some((event) => event.redacted || event.skipped)) throw new Error("脱敏轨迹不能进行界面回放");
  const base = `${options.server}/api/projects/${encodeURIComponent(options.projectId)}`;
  const project = await request<{ roomId: string }>(base);
  const actors = [...new Set(options.events.flatMap((event) => event.type === "edit" && isHuman(event.origin) ? [event.origin.memberId] : []))];
  if (!actors.length) throw new Error("轨迹没有 human 编辑者");
  const members = new Map<string, string>();
  const sockets = new Map<string, WebSocket>();
  const providers = new Map<string, { provider: WebsocketProvider; document: Y.Doc }>();
  try {
    for (const actor of actors) {
      const body = await request<{ member: { id: string } }>(`${base}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Replay ${actor}` }) });
      members.set(actor, body.member.id);
      const socket = new WebSocket(`${options.server.replace(/^http/, "ws")}/ws?projectId=${encodeURIComponent(options.projectId)}&memberId=${encodeURIComponent(body.member.id)}`);
      sockets.set(actor, socket);
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      socket.send(JSON.stringify({ type: "ready", roomId: project.roomId }));
    }
    const current = new Map<string, string>();
    for (const event of options.events) if (event.type === "doc_open" && typeof event.text === "string" && !current.has(String(event.file))) current.set(String(event.file), event.text);
    const resetMember = members.values().next().value!;
    for (const [file, text] of current) {
      await request(`${base}/workspace/file`, { method: "PUT", headers: { "content-type": "application/json", "X-SimpleRCP-Member": resetMember }, body: JSON.stringify({ path: file, content: text }) });
      for (const [actor, memberId] of members) {
        const document = new Y.Doc();
        const provider = new WebsocketProvider(`${options.server.replace(/^http/, "ws")}/yjs/${encodeURIComponent(options.projectId)}`, encodeURIComponent(`${project.roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
        providers.set(`${actor}:${file}`, { provider, document });
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("回放文档同步超时")), 10_000);
          provider.on("sync", (synced) => { if (synced) { clearTimeout(timeout); resolve(); } });
          provider.once("connection-error", (error) => { clearTimeout(timeout); reject(error); });
        });
      }
    }
    let previous = options.events[0]?.at ?? 0;
    for (const event of [...options.events].sort((a, b) => a.seq - b.seq)) {
      if (event.type !== "edit" && event.type !== "cursor") continue;
      await wait(Math.max(0, event.at - previous) / options.speed);
      previous = Math.max(previous, event.at);
      if (event.type === "cursor") {
        const position = event.position as { lineNumber: number; column: number };
        const selection = event.selection ?? { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column };
        sockets.get(String(event.memberId))?.send(JSON.stringify({ type: "cursor_change", roomId: project.roomId, path: event.file, position, selection }));
      } else if (isHuman(event.origin)) {
        const file = String(event.file);
        const entry = providers.get(`${event.origin.memberId}:${file}`);
        if (!entry) throw new Error(`缺少回放文档：${file}`);
        const expected = current.get(file)!;
        const text = entry.document.getText("content");
        for (let retry = 0; text.toString() !== expected && retry < 200; retry += 1) await wait(5);
        if (text.toString() !== expected) throw new Error(`回放文档尚未同步：${file}`);
        entry.document.transact(() => {
          let offset = 0;
          for (const op of event.ops as TextEditOp[]) {
            const from = op.from + offset;
            if (text.toString().slice(from, from + op.deleted.length) !== op.deleted) throw new Error(`回放删除文本不一致：${file}`);
            if (op.deleted) text.delete(from, op.deleted.length);
            if (op.inserted) text.insert(from, op.inserted);
            offset += op.inserted.length - op.deleted.length;
          }
        });
        current.set(file, text.toString());
      }
    }
    const config = options.events.find((event) => event.type === "session_start")?.config as { idleMs?: number } | undefined;
    await wait(options.settleMs ?? (config?.idleMs ?? 1500) + 100);
    await wait(options.holdMs ?? 15_000);
    return { project: options.projectId, participants: actors, memberIds: Object.fromEntries(members), edits: options.events.filter((event) => event.type === "edit").length, speed: options.speed };
  } finally {
    for (const { provider, document } of providers.values()) { provider.disconnect(); provider.destroy(); document.destroy(); }
    for (const socket of sockets.values()) socket.close();
  }
}
async function request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`回放请求失败：${response.status} ${url}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}
function isHuman(value: unknown): value is { kind: "human"; memberId: string } { return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "human" && typeof (value as { memberId?: unknown }).memberId === "string"); }
function wait(duration: number) { return new Promise<void>((resolve) => setTimeout(resolve, duration)); }
