import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { dataset: { type: "string" }, cache: { type: "string" }, report: { type: "string" }, restore: { type: "boolean", default: false } } });
if (!values.dataset && !values.cache && !values.report) throw new Error("必须指定数据集、缓存或报告目录");
const checksum = (text: string) => createHash("sha256").update(text).digest("hex");
if (values.dataset) {
  const directory = path.resolve(values.dataset);
  const archive = path.join(directory, "dataset.json.gz");
  if (values.restore) {
    const data = JSON.parse(gunzipSync(await fs.readFile(archive)).toString());
    for (const name of ["manifest", "labels", "excluded"]) await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(data[name], null, 2) + "\n");
    await fs.mkdir(path.join(directory, "traces"), { recursive: true });
    for (const [name, text] of Object.entries(data.traces) as Array<[string, string]>) {
      if (!/^[a-z0-9.-]+\.jsonl$/.test(name)) throw new Error("轨迹文件名无效");
      const variant = data.manifest.groups.flatMap((group: any) => Object.values(group.variants)).find((variant: any) => variant.traceFile === `traces/${name}`);
      if (!variant || variant.traceHash !== checksum(text)) throw new Error("轨迹哈希不符");
      await fs.writeFile(path.join(directory, "traces", name), text);
    }
  } else {
    const data: Record<string, unknown> = {};
    for (const name of ["manifest", "labels", "excluded"]) data[name] = JSON.parse(await fs.readFile(path.join(directory, `${name}.json`), "utf8"));
    const traces: Record<string, string> = {};
    for (const name of (await fs.readdir(path.join(directory, "traces"))).sort()) traces[name] = await fs.readFile(path.join(directory, "traces", name), "utf8");
    const bytes = gzipSync(JSON.stringify({ ...data, traces }) + "\n", { mtime: 0 });
    await fs.writeFile(archive, bytes);
    await fs.writeFile(path.join(directory, "archive-sha256.json"), JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, traces: Object.keys(traces).length }, null, 2) + "\n");
  }
}
if (values.cache) {
  const directory = path.resolve(values.cache);
  const archive = path.join(directory, "model-cache.json.gz");
  if (values.restore) {
    const records = JSON.parse(gunzipSync(await fs.readFile(archive)).toString());
    for (const [name, text] of Object.entries(records) as Array<[string, string]>) {
      if (!/^(?:G[0-4]\/)?[a-f0-9]{64}\.json$/.test(name)) throw new Error("缓存文件名无效");
      await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await fs.writeFile(path.join(directory, name), text);
    }
  } else {
    const records: Record<string, string> = {};
    for (const name of (await fs.readdir(directory, { recursive: true })).filter((name) => /^(?:G[0-4]\/)?[a-f0-9]{64}\.json$/.test(name)).sort()) records[name] = await fs.readFile(path.join(directory, name), "utf8");
    await fs.writeFile(archive, gzipSync(JSON.stringify(records) + "\n", { mtime: 0 }));
  }
}
if (values.report) {
  const directory = path.resolve(values.report);
  const source = path.join(directory, "results.json");
  const archive = path.join(directory, "results.json.gz");
  if (values.restore) await fs.writeFile(source, gunzipSync(await fs.readFile(archive)));
  else await fs.writeFile(archive, gzipSync(await fs.readFile(source), { mtime: 0 }));
}
console.log(JSON.stringify({ restored: values.restore, dataset: values.dataset, cache: values.cache, report: values.report }));
