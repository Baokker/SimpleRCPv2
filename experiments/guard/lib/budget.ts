import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./common.js";

export async function pilotBudget(directory: string) {
  const summary = JSON.parse(await fs.readFile(path.join(directory,"summary.json"),"utf8"));
  if(summary.completedRuns!==54)throw new Error("X2 pilot must contain 54 runs");
  const t=summary.tokenStats;
  const pilotUpperCny=((t.input+t.cacheRead+t.cacheWrite)*2+(t.output+t.reasoning)*8)/1_000_000;
  const budget={pilotDirectory:directory,pilotRuns:54,plannedRuns:540,tokenStats:t,pilotUpperCny,fullUpperCny:pilotUpperCny*10,limitCny:200,withinBudget:pilotUpperCny*10<=200,
    method:"采用官方高峰时段单价上界，全部缓存输入按未命中 2 CNY/百万 token，输出与 reasoning 按 8 CNY/百万 token，试运行使用量乘以 10",source:"https://api-docs.deepseek.com/zh-cn/quick_start/pricing",sourceSnapshot:path.join(projectRoot,"experiments/guard/results/deepseek-pricing-20261005.html"),verifiedAt:new Date().toISOString()};
  await fs.writeFile(path.join(directory,"budget.json"),JSON.stringify(budget,null,2)+"\n");
  return budget;
}
