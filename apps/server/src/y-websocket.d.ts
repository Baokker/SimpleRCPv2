declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "node:http";
  import type { WebSocket } from "ws";
  import type * as Y from "yjs";

  export function getYDoc(docName: string, gc?: boolean): Y.Doc;
  export function setupWSConnection(
    connection: WebSocket,
    request: IncomingMessage,
    options?: { docName?: string; gc?: boolean }
  ): void;
  export function setPersistence(persistence: {
    bindState(docName: string, document: Y.Doc): void;
    writeState(docName: string, document: Y.Doc): Promise<unknown>;
    provider: unknown;
  } | null): void;
}
