import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const experimentBudgetCategories = ["fast", "deep", "agentBaseRuns", "agentExecutionsIncludingFollowups", "agentHttpRequests", "usd"] as const;
export type ExperimentBudgetCategory = typeof experimentBudgetCategories[number];

export async function createExperimentBudget(experiment: string) {
  if (!/^X[1-7]b?$/.test(experiment)) throw new Error("实验编号无效");
  const directory = path.join(repository, "docs/conflict-guard/experiment");
  const protocolContents = await fs.readFile(path.join(directory, "protocol.json"));
  const protocol = JSON.parse(protocolContents.toString());
  if (protocol.status !== "frozen") throw new Error("冻结材料尚未获得人工确认，实验已经停止");
  if (protocol.preparation?.status !== "ready") throw new Error("实验准备尚未完成，实验已经停止");
  const snapshot = JSON.parse(await fs.readFile(path.join(directory, "freeze.json"), "utf8"));
  if (snapshot.status !== "frozen" || snapshot.codeCommit !== protocol.codeCommit || snapshot.artifacts["docs/conflict-guard/experiment/protocol.json"]?.sha256 !== createHash("sha256").update(protocolContents).digest("hex")) throw new Error("协议与冻结材料不一致");
  const sourcePaths = ["apps/*/src", "apps/*/scripts", "packages/*/src", "packages/*/scripts", "scripts", "package.json", "apps/*/package.json", "packages/*/package.json", "pnpm-lock.yaml"];
  execFileSync("git", ["diff", "--exit-code", protocol.codeCommit, "--", ...sourcePaths], { cwd: repository });
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...sourcePaths], { cwd: repository, encoding: "utf8" }).trim()) throw new Error("实验源码与冻结提交不一致");
  const contents = await fs.readFile(path.join(directory, "budget.json"));
  const definition = JSON.parse(contents.toString());
  const definitionHash = createHash("sha256").update(contents).digest("hex");
  if (definitionHash !== snapshot.generated["budget.json"]?.sha256) throw new Error("调用预算与冻结材料不一致");
  const file = path.join(repository, ".test-workspaces/stage8-budget.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  let pending = Promise.resolve();
  return {
    consume(category: ExperimentBudgetCategory, amount = 1) {
      if (!Number.isFinite(amount) || amount < 0 || category !== "usd" && !Number.isInteger(amount)) throw new Error("预算增量无效");
      pending = pending.then(async () => {
        let lock;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try { lock = await fs.open(`${file}.lock`, "wx"); break; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await new Promise((resolve) => setTimeout(resolve, 20)); }
        }
        if (!lock) throw new Error("阶段八预算文件正在使用，请检查其他实验进程");
        try {
          let state;
          try { state = JSON.parse(await fs.readFile(file, "utf8")); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            state = { codeCommit: protocol.codeCommit, definitionHash, totals: Object.fromEntries(experimentBudgetCategories.map((key) => [key, 0])), experiments: {}, events: [] };
          }
          if (state.codeCommit !== protocol.codeCommit || state.definitionHash !== definitionHash) throw new Error("阶段八预算与冻结材料不一致");
          const limit = definition.stopBeforeExceeding[category];
          if (!Number.isFinite(limit) || limit < 0) throw new Error(`冻结预算缺少 ${category}`);
          if (state.totals[category] + amount > limit) {
            await fs.writeFile(path.join(directory, "budget-stop.json"), JSON.stringify({ experiment, category, amount, used: state.totals[category], limit, time: new Date().toISOString() }, null, 2) + "\n");
            throw new Error(`阶段八 ${category} 预算即将超过上限，实验已经停止`);
          }
          state.totals[category] += amount;
          state.experiments[experiment] ??= Object.fromEntries(experimentBudgetCategories.map((key) => [key, 0]));
          state.experiments[experiment][category] += amount;
          state.events.push({ experiment, category, amount, time: new Date().toISOString() });
          await fs.writeFile(file, JSON.stringify(state, null, 2) + "\n");
        } finally { await lock.close(); await fs.unlink(`${file}.lock`); }
      });
      return pending;
    },
    async snapshot() { await pending; return JSON.parse(await fs.readFile(file, "utf8")); }
  };
}
