import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("真实开发录制缺少有效快判时终止校准并保留受阻状态", async () => {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const packageRoot = path.join(repository, "packages/conflict-guard");
  const temporary = path.join(repository, ".test-workspaces");
  await fs.mkdir(temporary, { recursive: true });
  const output = await fs.mkdtemp(path.join(temporary, "calibration-region-"));
  try {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/adjudication-calibrate.ts", "--dataset", "../../docs/conflict-guard/evidence/preexperiment/record/results.json.gz", "--out", output], { cwd: packageRoot, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("没有有效快判结果，无法校准置信度阈值");
    const record = JSON.parse(await fs.readFile(path.join(output, "calibration.json"), "utf8"));
    expect(record).toMatchObject({ dataset: "d1-v3", split: "dev", samples: 53, lockCount: 7, allowCount: 46, status: "blocked", recommended: null, fastSuccessful: 0 });
    expect((await fs.readdir(output)).sort()).toEqual(["calibration.json"]);
  } finally {
    await fs.rm(output, { recursive: true });
  }
});
