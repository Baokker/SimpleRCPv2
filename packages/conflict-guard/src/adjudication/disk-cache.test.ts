import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { createModelCacheWriter } from "../../scripts/model-cache-writer.ts";

it("并发保存真实请求记录时保留完整 JSON", async () => {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const archive = JSON.parse(gunzipSync(await fs.readFile(path.join(repository, "packages/conflict-guard/bench/model-cache/preexperiment/model-cache.json.gz"))).toString());
  const name = Object.keys(archive).sort().find((name) => name.startsWith("G1/"))!;
  const entry = JSON.parse(archive[name]);
  const parent = path.join(repository, ".test-workspaces");
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "model-cache-write-"));
  try {
    const writers = [createModelCacheWriter(directory), createModelCacheWriter(directory)];
    await Promise.all(Array.from({ length: 32 }, (_, index) => writers[index % writers.length]!.put(entry)));
    expect(JSON.parse(await fs.readFile(path.join(directory, `${entry.key}.json`), "utf8"))).toEqual(entry);
    expect(await fs.readdir(directory)).toEqual([`${entry.key}.json`]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
