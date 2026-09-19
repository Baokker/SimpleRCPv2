import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createOpencodeClient, type Config } from "@opencode-ai/sdk/v2";

export const OPEN_CODE_PROVIDER_ID = "simplercp-deepseek";
const OPEN_CODE_VERSION = "1.18.31";

interface OpenCodeProcessOptions {
  port: number;
  apiKey?: string;
  baseUrl: string;
  model: string;
}

interface RunningOpenCodeProcess {
  url: string;
  version: string;
}

export function createOpenCodeProcess(options: OpenCodeProcessOptions) {
  let child: ReturnType<typeof spawn> | undefined;
  let running: RunningOpenCodeProcess | undefined;
  let startup: Promise<RunningOpenCodeProcess> | undefined;

  async function start() {
    if (running) return running;
    startup ??= launch();
    return startup;
  }

  async function launch(): Promise<RunningOpenCodeProcess> {
    const executable = resolveOpenCodeExecutable();
    const nextChild = spawn(
      executable,
      ["serve", "--hostname=127.0.0.1", `--port=${options.port}`],
      {
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: options.apiKey ?? "",
          OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(options))
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child = nextChild;

    try {
      const url = await waitForServerUrl(nextChild, 15_000);
      const client = createOpencodeClient({ baseUrl: url });
      const health = await client.global.health({ throwOnError: true });
      if (!health.data.healthy) {
        throw new Error("OpenCode health check failed");
      }
      if (health.data.version !== OPEN_CODE_VERSION) {
        throw new Error(
          `OpenCode version ${OPEN_CODE_VERSION} is required, received ${health.data.version}`
        );
      }

      running = { url, version: health.data.version };
      nextChild.once("exit", () => {
        if (child !== nextChild) return;
        child = undefined;
        running = undefined;
        startup = undefined;
      });
      return running;
    } catch (error) {
      await stopChild(nextChild);
      if (child === nextChild) child = undefined;
      running = undefined;
      startup = undefined;
      throw error;
    }
  }

  return {
    start,
    async dispose() {
      const current = child;
      child = undefined;
      running = undefined;
      startup = undefined;
      if (current) await stopChild(current);
    }
  };
}

function resolveOpenCodeExecutable() {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("opencode-ai/package.json");
  return path.join(path.dirname(packagePath), "bin", "opencode.exe");
}

function openCodeConfig(options: OpenCodeProcessOptions): Config {
  return {
    autoupdate: false,
    share: "disabled",
    enabled_providers: [OPEN_CODE_PROVIDER_ID],
    model: `${OPEN_CODE_PROVIDER_ID}/${options.model}`,
    small_model: `${OPEN_CODE_PROVIDER_ID}/${options.model}`,
    provider: {
      [OPEN_CODE_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "DeepSeek",
        options: {
          apiKey: "{env:DEEPSEEK_API_KEY}",
          baseURL: options.baseUrl
        },
        models: {
          [options.model]: {
            name: options.model,
            tool_call: true
          }
        }
      }
    },
    permission: {
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
      doom_loop: "allow",
      external_directory: "deny"
    }
  };
}

function waitForServerUrl(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stopChild(child);
      reject(new Error("OpenCode did not start within 15 seconds"));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      output += chunk.toString();
      for (const line of output.split("\n")) {
        if (!line.startsWith("opencode server listening")) continue;
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
        if (!match?.[1]) continue;
        settled = true;
        clearTimeout(timer);
        resolve(match[1]);
        return;
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`OpenCode could not start: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`OpenCode exited during startup with code ${code}`));
    });
  });
}

async function stopChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await waitForExit(child, 3_000);
  if (exited) return;
  child.kill("SIGKILL");
  await waitForExit(child, 3_000);
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    child.once("exit", onExit);
  });
}
