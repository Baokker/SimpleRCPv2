import fs from "node:fs/promises";
import path from "node:path";
import {exists, readJson, writeJson} from "./common.js";
import {isLlmQuotaFailure as isQuotaFailure} from "@simplercp/knowledge";
export {isQuotaFailure};

export async function attemptDirectory(raw: string, runFile: string) {
  const interruption = path.join(raw, "interruption.json");
  const savedRun = path.join(raw, runFile);
  let restart = await exists(interruption);
  if (!restart && await exists(savedRun)) {
    const final = path.join(raw, "run.json");
    const collected = path.join(raw, "ta/run.json");
    for (const file of [final, collected]) if (await exists(file)) {
      const run = await readJson(file);
      if (run.status === "cancelled" || isQuotaFailure(run.error ?? "")) restart = true;
    }
  }
  if (restart) {
    const archive = `${raw}.interrupted-${Date.now()}`;
    await fs.rename(raw, archive);
  }
}

export async function recordInterruption(raw: string, error: unknown) {
  await writeJson(path.join(raw, "interruption.json"), {at: new Date().toISOString(), reason: error instanceof Error ? error.message : String(error)});
}
