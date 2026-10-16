import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { cacheKey, inputHash } from "./prompts.js";
import type { CachedCall } from "./types.js";

const archive = JSON.parse(gunzipSync(fs.readFileSync(new URL("../../bench/model-cache/preexperiment/model-cache.json.gz", import.meta.url))).toString());
const entry: CachedCall = JSON.parse(archive[Object.keys(archive).sort().find((name) => name.startsWith("G1/"))!]);

it("历史录制保持完整输入身份，新增证据和声明末尾均改变缓存身份", () => {
  expect(inputHash(entry.input)).toBe(entry.call.inputHash);
  expect(cacheKey(entry.input, entry.call.adapter, entry.call.model, entry.parameters!)).toBe(entry.key);
  const extended = { ...entry.input, inputVersion: "declaration-evidence-v1" as const, structuredEvidence: { left: { signature: { before: "a", after: "b" }, status: { beforeExported: true, afterExported: true, deleted: false, becameNonExported: false }, uses: [] }, right: { signature: { before: "c", after: "d" }, status: { beforeExported: true, afterExported: true, deleted: false, becameNonExported: false }, uses: [] } } };
  const key = (input: typeof entry.input) => cacheKey(input, entry.call.adapter, entry.call.model, entry.parameters!);
  expect(inputHash(extended)).not.toBe(entry.call.inputHash);
  expect(key(extended)).not.toBe(entry.key);
  expect(key({ ...extended, left: { ...extended.left, after: `${extended.left.after}\n// 新的声明内容` } })).not.toBe(key(extended));
  expect(key({ ...extended, structuredEvidence: { ...extended.structuredEvidence, left: { ...extended.structuredEvidence.left, status: { ...extended.structuredEvidence.left.status, deleted: true } } } })).not.toBe(key(extended));
});
