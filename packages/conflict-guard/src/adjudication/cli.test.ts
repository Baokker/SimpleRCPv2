import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const packageDirectory = path.join(repository, "packages/conflict-guard");

it("verifies a G3-only recording with its original configuration and model version offline", async () => {
  const workspace = path.join(repository, ".test-workspaces");
  await fs.mkdir(workspace, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspace, "adjudication-verify-"));
  try {
    const source = JSON.parse(gunzipSync(await fs.readFile(path.join(repository, "docs/conflict-guard/evidence/stage-5-dev-report/results.json.gz"))).toString());
    const report = { ...source, config: { ...source.config, version: "adjudication-review-test", prices: { ...source.config.prices, deepOutputPerMillion: 1.5 } }, policies: { G3: source.policies.G3 } };
    await fs.writeFile(path.join(directory, "results.json.gz"), gzipSync(JSON.stringify(report)));
    await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/adjudication-verify.ts", "--record", directory, "--cache", "bench/model-cache/stage5-dev-final", "--dataset", "bench/datasets/d1-v1"], { cwd: packageDirectory, env: { ...process.env, DEEPSEEK_MODEL: "review-different-model" }, timeout: 90000, maxBuffer: 1024 * 1024 });
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
}, 95000);
