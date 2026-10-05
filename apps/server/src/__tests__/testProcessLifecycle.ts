import { spawn, type ChildProcess } from "node:child_process";

export function createLocalProcessLifecycle(terminationDelayMs = 0) {
  const records: Array<{ model: string; disposeCount: number; dispose(): Promise<void> }> = [];
  return {
    records,
    create({ model }: { model: string }) {
      let child: ChildProcess | undefined;
      let disposal: Promise<void> | undefined;
      const record = {
        model,
        disposeCount: 0,
        async start() {
          if (!child) {
            const script = `process.on("SIGTERM", () => setTimeout(() => process.exit(0), ${terminationDelayMs})); process.send("ready"); setInterval(() => {}, 1000)`;
            child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "ignore", "ignore", "ipc"], env: {} });
            await new Promise<void>((resolve, reject) => { child!.once("message", () => resolve()); child!.once("error", reject); });
          }
          return { url: "http://127.0.0.1:1", version: "local-process" };
        },
        dispose() {
          if (disposal) return disposal;
          record.disposeCount += 1;
          disposal = !child || child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((resolve) => { child!.once("exit", () => resolve()); child!.kill("SIGTERM"); });
          return disposal;
        }
      };
      records.push(record);
      return record;
    },
    async disposeAll() { await Promise.all(records.map((record) => record.dispose())); }
  };
}
