import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const dataDir = path.join(repositoryRoot, ".test-workspaces", "demo-startup-data");
const serverOrigin = "http://127.0.0.1:4200";
const clientOrigin = "http://127.0.0.1:5175";

test("demo command starts SimpleRCPv2 with the bundled workspace", async (t) => {
  await fs.rm(dataDir, { recursive: true, force: true });
  const child = spawn("pnpm", ["dev:demo"], {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PORT: "4200",
      SIMPLERCP_DATA_DIR: dataDir,
      SIMPLERCP_PUBLIC_URL: clientOrigin,
      VITE_SIMPLERCP_API_ORIGIN: serverOrigin,
      VITE_SIMPLERCP_CLIENT_PORT: "5175"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => stopProcess(child));

  const output = await waitForApplication(child);
  const response = await fetch(`${serverOrigin}/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.dataDir, dataDir);
  const projects = await fetch(`${serverOrigin}/api/projects`).then((result) =>
    result.json()
  );
  assert.equal(projects.projects[0].name, "Demo");
  const clientResponse = await fetch(clientOrigin);
  assert.equal(clientResponse.status, 200);
  assert.equal(output.includes("Host URL"), false);
  assert.equal(output.includes("Guest URL"), false);
});

function waitForApplication(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Demo server did not start.\n${output}`));
    }, 15_000);

    function readOutput(chunk) {
      output += chunk.toString();
      const serverReady = output.includes("SimpleRCPv2 server listening");
      const clientReady = output.includes(clientOrigin);
      if (!serverReady || !clientReady) return;
      clearTimeout(timeout);
      resolve(output);
    }

    child.stdout.on("data", readOutput);
    child.stderr.on("data", readOutput);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Demo process exited with code ${code}.\n${output}`));
    });
  });
}

function stopProcess(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  process.kill(-child.pid, "SIGTERM");
}
