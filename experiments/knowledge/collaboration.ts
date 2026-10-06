import {createRequire} from "node:module";
import {once} from "node:events";
import WebSocket from "ws";
import type {ProjectRecord} from "@simplercp/shared";
import type * as Y from "yjs";
import type {WebsocketProvider as Provider} from "y-websocket";
import {PlatformClient} from "./client.js";
import {pause} from "./common.js";

const require = createRequire(import.meta.url);
export const YRuntime = require("yjs") as typeof Y;
const {WebsocketProvider} = require("y-websocket") as {WebsocketProvider: typeof Provider};
export class CollaborationClient {
  private sockets = new Map<string, WebSocket>();
  private documents = new Map<string, {doc: Y.Doc; provider: Provider}>();
  roomId = "";
  constructor(readonly api: PlatformClient, readonly project: ProjectRecord) {}
  async join(member: string) {
    const {room} = await this.api.request(this.api.projectRoute(this.project, "room"), member);
    this.roomId = room.id;
    const socket = new WebSocket(`${this.api.config.origin.replace(/^http/u, "ws")}/ws?projectId=${this.project.id}&memberId=${member}`);
    this.sockets.set(member, socket);
    await once(socket, "open");
    socket.on("message", data => {
      const message = JSON.parse(String(data));
      if (message.event?.type === "realtime_error") throw new Error(message.event.payload?.message);
    });
    this.send(member, {type: "ready"});
  }
  send(member: string, message: Record<string, unknown>) {
    const socket = this.sockets.get(member);
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Member socket is unavailable");
    socket.send(JSON.stringify({...message, roomId: this.roomId, memberId: member}));
  }
  async document(member: string, file: string) {
    const key = `${member}:${file}`;
    let active = this.documents.get(key);
    if (!active) {
      const doc = new YRuntime.Doc();
      const provider = new WebsocketProvider(`${this.api.config.origin.replace(/^http/u, "ws")}/yjs/${this.project.id}`, encodeURIComponent(`${this.roomId}:${file}`), doc, {WebSocketPolyfill: WebSocket as any, params: {memberId: member}, disableBc: true});
      active = {doc, provider}; this.documents.set(key, active);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Yjs synchronization timed out: ${file}`)), 15000);
        provider.on("sync", (synced: boolean) => {if (synced) {clearTimeout(timer); resolve();}});
        provider.on("connection-error", (error: unknown) => {clearTimeout(timer); reject(error);});
      });
    }
    return active.doc;
  }
  async replace(member: string, file: string, before: string, after: string) {
    let prefix = 0;
    while (before[prefix] === after[prefix] && prefix < Math.min(before.length, after.length)) prefix++;
    let endBefore = before.length, endAfter = after.length;
    while (endBefore > prefix && endAfter > prefix && before[endBefore - 1] === after[endAfter - 1]) {endBefore--; endAfter--;}
    await this.edit(member, file, before, prefix, endBefore - prefix, after.slice(prefix, endAfter));
  }
  async edit(member: string, file: string, before: string, start: number, deleteCount: number, insertText: string) {
    const doc = await this.document(member, file);
    const text = doc.getText("content");
    const deadline = Date.now() + 10000;
    while (text.toString() !== before && Date.now() < deadline) await pause(20);
    if (text.toString() !== before) throw new Error(`Yjs source differs: ${file}`);
    doc.transact(() => {if (deleteCount) text.delete(start, deleteCount); if (insertText) text.insert(start, insertText);});
    await this.api.request(this.api.projectRoute(this.project, "experiments/documents/flush"), member, {file, expectedText: text.toString()});
  }
  async externalWrite(member: string, file: string, content: string) {
    await this.api.request(this.api.projectRoute(this.project, "experiments/documents/flush"), member, {});
    await this.api.request(this.api.projectRoute(this.project, "workspace/file"), member, {path: file, content}, "PUT");
    const deadline = Date.now() + 10000;
    const active = [...this.documents.entries()].filter(([key]) => key.endsWith(`:${file}`)).map(([, entry]) => entry);
    while (active.some(entry => entry.doc.getText("content").toString() !== content) && Date.now() < deadline) await pause(20);
    if (active.some(entry => entry.doc.getText("content").toString() !== content)) throw new Error(`External edit was not synchronized: ${file}`);
  }
  async leave(member: string) {
    const socket = this.sockets.get(member); socket?.close(); this.sockets.delete(member);
  }
  async close() {
    for (const {doc, provider} of this.documents.values()) {provider.destroy(); doc.destroy();}
    for (const socket of this.sockets.values()) socket.close();
    this.documents.clear(); this.sockets.clear();
  }
}
export function editorOffset(text: string, line: number, column: number) {
  const lines = text.split("\n");
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || line > lines.length || column < 1 || column > lines[line - 1].length + 1) throw new Error("Script position is invalid");
  return lines.slice(0, line - 1).reduce((total, item) => total + item.length + 1, 0) + column - 1;
}
