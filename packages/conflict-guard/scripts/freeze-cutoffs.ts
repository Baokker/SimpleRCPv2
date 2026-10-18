// 输出每个开发集样本的冻结统计截止时间：有输入过程的轨迹截止于最后一次编辑，其余截止于回放结束（null）。
import path from "node:path";
import { repositoryRoot } from "./model-runtime.ts";
import { developmentSamples } from "./model-dataset.ts";

const { samples } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v4"));
const cutoffs = Object.fromEntries(samples.map((sample) => {
  const typing = sample.trace.find((event) => event.type === "session_start")?.typing;
  return [sample.label.id, typing ? Math.max(0, ...sample.trace.filter((event) => event.type === "edit").map((event) => event.at)) : null];
}));
console.log(JSON.stringify(cutoffs));
