import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { seeds: { type: "string", default: "bench/seeds" }, out: { type: "string", default: "bench/datasets/d1-v1" }, groups: { type: "string", default: "10" }, seed: { type: "string", default: "7" }, concurrency: { type: "string", default: "4" } } });
await run("bench-generate.ts", ["--seeds", values.seeds!, "--out", values.out!, "--groups", values.groups!, "--seed", values.seed!]);
await run("bench-label.ts", ["--dataset", values.out!, "--concurrency", values.concurrency!]);

async function run(script: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL(script, import.meta.url)), ...args], { maxBuffer: 1_048_576 }, (error) => error ? reject(error) : resolve());
    child.stdout?.pipe(process.stdout); child.stderr?.pipe(process.stderr);
  });
}
