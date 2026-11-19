import fs from "node:fs/promises";
import path from "node:path";
import { environmentRecord, resultsRoot } from "./common.js";

const record = await environmentRecord({
  modelPlanned: "MiniMax-M3",
  seeds: { annotation: "compact-annotation-v1", property1: "0x434f4d50", property3To5AndMetadata: "0x6a09e667", runtimeFaults: "0xbb67ae85" }
});
await fs.mkdir(resultsRoot, { recursive: true });
await fs.writeFile(path.join(resultsRoot, "ENVIRONMENT.json"), `${JSON.stringify(record, null, 2)}\n`);
