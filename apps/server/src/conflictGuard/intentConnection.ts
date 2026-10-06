import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as sync from "y-protocols/sync";
import type { WebSocket } from "ws";
import type * as Y from "yjs";

export function connectIntentBoard(socket: WebSocket, document: Y.Doc) {
  const send = (encoder: encoding.Encoder) => { if (socket.readyState === 1) socket.send(encoding.toUint8Array(encoder)); };
  const update = (change: Uint8Array) => { const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); sync.writeUpdate(encoder, change); send(encoder); };
  const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); sync.writeSyncStep1(encoder, document); send(encoder);
  document.on("update", update);
  socket.on("message", (data: Buffer) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(decoder) !== 0 || decoding.readVarUint(decoder) !== sync.messageYjsSyncStep1) return;
      const response = encoding.createEncoder(); encoding.writeVarUint(response, 0); sync.readSyncStep1(decoder, response, document); send(response);
    } catch { socket.close(1003, "Invalid Yjs synchronization message"); }
  });
  socket.on("close", () => document.off("update", update));
}
