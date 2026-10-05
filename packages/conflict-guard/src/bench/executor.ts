import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BenchVariant, ProbeRun } from "./types.js";
import type { StateName } from "./labeler.js";

export async function executeProbe(variant: BenchVariant, state: StateName): Promise<ProbeRun> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-probe-"));
  try {
    await fs.writeFile(path.join(root, "state.json"), JSON.stringify(variant[state]));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    const probes = variant.probes;
    if (!probes?.length) throw new Error(`关系组缺少归属探针：${variant.id}`);
    const selected = probes.filter((probe) => probe.owner === "shared-regression" || probe.owner === "observation" || state === "merged" || state === "leftOnly" && probe.owner === "origin-intent" || state === "rightOnly" && probe.owner === "candidate-intent");
    const source = `import assert from "node:assert/strict";\nimport * as p from "./src/producer.js";\nimport * as c from "./src/consumer.js";\nexport const result = { passed: true, observations: {}, probes: {} };\n${selected.map((probe) => `try { if (typeof p.reset === "function") p.reset(); const value = await (${probe.expression}); ${probe.owner === "observation" ? `result.observations[${JSON.stringify(probe.id)}] = JSON.stringify(value) ?? "undefined";` : `assert.deepEqual(value, ${JSON.stringify(probe.expected)});`} result.probes[${JSON.stringify(probe.id)}] = { owner: ${JSON.stringify(probe.owner)}, passed: true, value }; } catch (error) { result.probes[${JSON.stringify(probe.id)}] = { owner: ${JSON.stringify(probe.owner)}, passed: false, error: String(error.message) }; ${probe.owner === "observation" ? `result.observations[${JSON.stringify(probe.id)}] = "error:" + String(error.message);` : "result.passed = false;"} }`).join("\n")}\n`;
    const file = path.join(root, "probe.mjs");
    await fs.writeFile(file, source);
    const processResult = await new Promise<{ code: number; stdout: string; stderr: string; timeout: boolean }>((resolve) => {
      const worker = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./probeWorker.ts" : "./probeWorker.js", import.meta.url));
      execFile(process.execPath, ["--experimental-strip-types", worker], { cwd: root, timeout: 20_000, maxBuffer: 1_048_576 }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, timeout: Boolean(error && error.killed), stdout, stderr }));
    });
    if (processResult.code !== 0) return { passed: false, observations: {}, timeout: processResult.timeout, stdout: processResult.stdout, stderr: processResult.stderr };
    const parsed = JSON.parse(processResult.stdout.trim().split("\n").at(-1)!) as ProbeRun;
    return { ...parsed, stdout: processResult.stdout, stderr: processResult.stderr };
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
