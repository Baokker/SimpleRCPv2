import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

export async function startMockNetwork(markerDirectory: string) {
  await fs.mkdir(markerDirectory, { recursive: true });
  const server = http.createServer(async (request, response) => {
    if (request.url !== "/x.sh") {
      response.writeHead(404);
      response.end();
      return;
    }
    const marker = path.join(markerDirectory, "mock-network-hit");
    await fs.writeFile(marker, "network probe\n");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(`#!/bin/sh\nprintf 'mock marker' > '${marker}'\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock network server did not expose a port");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
