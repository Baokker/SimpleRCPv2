import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

async function sourceFixture() {
  const source = JSON.parse(gunzipSync(await fs.readFile(new URL("./fixtures/greylock-source.json.gz", import.meta.url))).toString()) as Record<string, string>;
  const hashes = JSON.parse(await fs.readFile(new URL("../../bench/datasets/d2-greylock/source-hashes.json", import.meta.url), "utf8")) as Record<string, string>;
  expect(Object.keys(source).sort()).toEqual(Object.keys(hashes).sort());
  for (const [file, contents] of Object.entries(source)) expect(createHash("sha256").update(contents).digest("hex")).toBe(hashes[file]);
  return source;
}

describe("检查点 A D2 来源完整性", () => {
  it("来源 selection 内容发生变化时，导入在读取其他来源之前报告 SHA-256 错误", async () => {
    const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
    const source = await sourceFixture();
    const directory = path.resolve(packageRoot, "../../.test-workspaces/d2-corrupt-source");
    const output = path.resolve(packageRoot, "../../.test-workspaces/d2-corrupt-output");
    await fs.mkdir(path.join(directory, "experiments/greylock-counterfactual-pair-v1.5"), { recursive: true });
    await fs.writeFile(path.join(directory, "experiments/greylock-counterfactual-pair-v1.5/selection.json"), JSON.stringify(JSON.parse(source["experiments/greylock-counterfactual-pair-v1.5/selection.json"]!)));
    try {
      await expect(promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/bench-import-greylock.ts", "--source", directory, "--out", output], { cwd: packageRoot, timeout: 20_000 })).rejects.toMatchObject({ stderr: expect.stringContaining("来源哈希不一致") });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await fs.rm(output, { recursive: true, force: true });
    }
  }, 25_000);

  it("holdout-v2 内容发生变化时拒绝导入", async () => {
    const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
    const source = await sourceFixture();
    const directory = path.resolve(packageRoot, "../../.test-workspaces/d2-corrupt-holdout-source");
    const output = path.resolve(packageRoot, "../../.test-workspaces/d2-corrupt-holdout-output");
    const entries = JSON.parse(await fs.readFile(path.join(packageRoot, "bench/datasets/d2-greylock/source-hashes.json"), "utf8")) as Record<string, string>;
    for (const entry of Object.keys(entries).filter((entry) => !entry.startsWith("experiments/greylock-replay-v1/cases/"))) {
      await fs.mkdir(path.dirname(path.join(directory, entry)), { recursive: true });
      await fs.writeFile(path.join(directory, entry), source[entry]!);
    }
    await fs.appendFile(path.join(directory, "experiments/greylock-independent-pair-holdout-v2/dataset.json"), "\n");
    try {
      await expect(promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/bench-import-greylock.ts", "--source", directory, "--out", output], { cwd: packageRoot, timeout: 30_000 })).rejects.toMatchObject({ stderr: expect.stringContaining("来源哈希不一致：experiments/greylock-independent-pair-holdout-v2/dataset.json") });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await fs.rm(output, { recursive: true, force: true });
    }
  }, 35_000);
});
