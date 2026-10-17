import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { createModelRuntime } from "../../scripts/model-runtime.ts";
import { recordedProviderConfiguration } from "../../scripts/model-providers.ts";

it("真实国内站录制按保存的端点与参数读取缓存并保持判定和等待时间", async () => {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const report = JSON.parse(gunzipSync(await fs.readFile(path.join(repository, "docs/conflict-guard/evidence/preexperiment/record/results.json.gz"))).toString());
  const archive = JSON.parse(gunzipSync(await fs.readFile(path.join(repository, "packages/conflict-guard/bench/model-cache/preexperiment/model-cache.json.gz"))).toString());
  const workspace = path.join(repository, ".test-workspaces");
  await fs.mkdir(workspace, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspace, "provider-record-"));
  try {
    for (const [name, text] of Object.entries(archive) as Array<[string, string]>) {
      await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await fs.writeFile(path.join(directory, name), text);
    }
    const providers = await recordedProviderConfiguration({ G1: report.policies.G1 }, directory);
    expect(providers).toEqual({ minimax: { baseUrl: "https://api.minimaxi.com/v1", jsonMode: true, temperature: 0 } });
    expect(await recordedProviderConfiguration({ G1: { ...report.policies.G1, model: { ...report.policies.G1.model, providers } } }, path.join(directory, "configuration-only"))).toEqual(providers);
    const original = report.policies.G1.groups.flatMap((row: any) => row.result.judgements).find((row: any) => row.verdict.adjudication?.status === "success");
    const subscription = report.policies.G1.model.subscriptions.find((entry: any) => entry.inputHash === original.verdict.adjudication.inputHash);
    const entry = JSON.parse(archive[`G1/${subscription.cacheKey}.json`]);
    const runtime = createModelRuntime({ ...report.config, strategy: "G1" }, "replay", path.join(directory, "G1"), undefined, { minimax: "MiniMax-M3" }, [subscription], undefined, providers);
    try {
      const result = await runtime.judge(entry.input, original.verdict, new AbortController().signal);
      expect(result).toEqual(original.verdict);
      expect(runtime.subscriptions()).toEqual([{ ...subscription, status: "cache-hit" }]);
      expect(runtime.stats().calls).toBe(0);
      expect(runtime.cacheMisses()).toBe(0);
    } finally { runtime.dispose(); }
    const overdue = createModelRuntime({ ...report.config, strategy: "G1" }, "replay", path.join(directory, "G1"), undefined, { minimax: "MiniMax-M3" }, [{ ...subscription, latencyMs: report.config.hardDeadlineMs + 1 }], undefined, providers);
    try {
      const verdict = await overdue.judge(entry.input, original.verdict, new AbortController().signal);
      expect(verdict).toMatchObject({ decision: "warn", ruleId: "model-unavailable", adjudication: { status: "degraded", latencyMs: report.config.hardDeadlineMs } });
      expect(overdue.stats().calls).toBe(0);
      expect(overdue.cacheMisses()).toBe(0);
    } finally { overdue.dispose(); }
  } finally { await fs.rm(directory, { recursive: true }); }
});
