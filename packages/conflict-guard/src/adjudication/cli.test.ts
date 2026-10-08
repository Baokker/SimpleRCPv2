import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const packageDirectory = path.join(repository, "packages/conflict-guard");

it("verifies a G3-only recording with its original configuration and model version offline", async () => {
  const workspace = path.join(repository, ".test-workspaces");
  await fs.mkdir(workspace, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspace, "adjudication-verify-"));
  try {
    for (const args of [["--dataset", "bench/datasets/d1-v2"], ["--cache", "bench/model-cache/checkpoint-b-calibrated"]]) await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/data-artifacts.ts", ...args, "--restore"], { cwd: packageDirectory });
    const source = JSON.parse(gunzipSync(await fs.readFile(path.join(repository, "docs/conflict-guard/evidence/checkpoint-b-dev-report/calibrated/results.json.gz"))).toString());
    const config = { ...source.config, version: "adjudication-review-test", prices: { ...source.config.prices, deepOutputPerMillion: 1.5 } };
    const configuration = path.join(directory, "config.json");
    const models = path.join(directory, "models.json");
    await fs.writeFile(configuration, JSON.stringify(config));
    await fs.writeFile(models, JSON.stringify(Object.fromEntries(source.policies.G3.model.calls.map((call: { adapter: string; model: string }) => [call.adapter, call.model]))));
    await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--dataset", "bench/datasets/d1-v2", "--policy", "G3", "--provider-mode", "replay", "--config", configuration, "--models", models, "--cache", "bench/model-cache/checkpoint-b-calibrated", "--out", directory], { cwd: packageDirectory, timeout: 600000, maxBuffer: 1024 * 1024 });
    const report = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, "results.json.gz"))).toString());
    expect(report.policies.G3.model.httpCalls).toBe(0);
    expect(report.policies.G3.groups).toHaveLength(source.policies.G3.groups.length);
    await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/adjudication-verify.ts", "--record", directory, "--cache", "bench/model-cache/checkpoint-b-calibrated", "--dataset", "bench/datasets/d1-v2"], { cwd: packageDirectory, env: { ...process.env, DEEPSEEK_MODEL: "review-different-model" }, timeout: 1800000, maxBuffer: 1024 * 1024 });
    const verification = JSON.parse(await fs.readFile(path.join(directory, "repeatability.json"), "utf8"));
    expect(verification.valid).toBe(true);
    expect(verification.byteIdentical).toBe(true);
    expect(verification.rounds).toHaveLength(3);
    expect(verification.rounds.every((round: { networkCalls: number }) => round.networkCalls === 0)).toBe(true);
    const replayed = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, "replay-1/results.json.gz"))).toString());
    expect(Object.keys(replayed.policies)).toEqual(["G3"]);
    expect(replayed.config).toEqual(report.config);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 2410000);

it("verifies subscription records through the offline CLI without network calls", async () => {
  const workspace = path.join(repository, ".test-workspaces");
  await fs.mkdir(workspace, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspace, "adjudication-subscriptions-"));
  try {
    const source = JSON.parse(gunzipSync(await fs.readFile(path.join(repository, "docs/conflict-guard/evidence/checkpoint-b-dev-report/calibrated/results.json.gz"))).toString());
    const sample = source.policies.G3.groups.find((row: { result: { judgements: Array<{ verdict: { adjudication?: unknown } }> } }) => row.result.judgements.some((entry) => entry.verdict.adjudication));
    expect(sample).toBeDefined();
    const original = path.join(packageDirectory, "bench/datasets/d1-v2");
    const manifest = JSON.parse(await fs.readFile(path.join(original, "manifest.json"), "utf8"));
    const labels = JSON.parse(await fs.readFile(path.join(original, "labels.json"), "utf8"));
    const group = manifest.groups.find((entry: { id: string }) => entry.id === sample.relationGroupId);
    const selected = labels.find((entry: { id: string }) => entry.id === sample.id);
    const dataset = path.join(directory, "dataset");
    await fs.mkdir(dataset);
    await fs.writeFile(path.join(dataset, "manifest.json"), JSON.stringify({ ...manifest, groups: [group], split: { ...manifest.split, development: [group.id], holdout: [] } }));
    await fs.writeFile(path.join(dataset, "labels.json"), JSON.stringify([selected]));
    const traceFile = group.variants[selected.variant].traceFile;
    if (traceFile) {
      await fs.mkdir(path.dirname(path.join(dataset, traceFile)), { recursive: true });
      await fs.copyFile(path.join(original, traceFile), path.join(dataset, traceFile));
    }
    const config = path.join(directory, "config.json");
    const models = path.join(directory, "models.json");
    await fs.writeFile(config, JSON.stringify(source.config));
    await fs.writeFile(models, JSON.stringify(Object.fromEntries(source.policies.G3.model.calls.map((call: { adapter: string; model: string }) => [call.adapter, call.model]))));
    const output = path.join(directory, "recorded");
    const run = promisify(execFile);
    await run(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--dataset", dataset, "--policy", "G3", "--provider-mode", "replay", "--config", config, "--models", models, "--cache", "bench/model-cache/checkpoint-b-calibrated", "--out", output], { cwd: packageDirectory, timeout: 120000, maxBuffer: 1024 * 1024 });
    const recorded = JSON.parse(gunzipSync(await fs.readFile(path.join(output, "results.json.gz"))).toString());
    expect(recorded.policies.G3.model.subscriptions.length).toBeGreaterThan(0);
    expect(recorded.policies.G3.model.subscriptions.every((entry: { status: string }) => entry.status === "cache-hit")).toBe(true);
    await run(process.execPath, ["--experimental-strip-types", "scripts/adjudication-verify.ts", "--record", output, "--cache", "bench/model-cache/checkpoint-b-calibrated", "--dataset", dataset], { cwd: packageDirectory, timeout: 120000, maxBuffer: 1024 * 1024 });
    const verification = JSON.parse(await fs.readFile(path.join(output, "repeatability.json"), "utf8"));
    expect(verification).toMatchObject({ valid: true, byteIdentical: true });
    const subscriptions = JSON.parse(await fs.readFile(path.join(output, "adjudication-subscriptions.json"), "utf8"));
    expect(subscriptions.G3).toEqual(recorded.policies.G3.model.subscriptions);
    expect(verification.rounds.every((round: { networkCalls: number }) => round.networkCalls === 0)).toBe(true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 260000);
