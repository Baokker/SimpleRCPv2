import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CachedCall } from "../src/adjudication/types.ts";

export function createModelCacheWriter(directory: string) {
  let pending = Promise.resolve();
  return {
    put(value: CachedCall) {
      // 同一请求的成功与超时记录可能连续写入，按调用顺序保存完整记录。
      pending = pending.then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const target = path.join(directory, `${value.key}.json`);
        const temporary = `${target}.${process.pid}.${randomUUID()}.part`;
        await fs.writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, target);
      });
      return pending;
    }
  };
}
