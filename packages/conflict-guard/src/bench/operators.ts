import type { OperatorSpec } from "./types.js";

export const OPERATOR_SPECS: OperatorSpec[] = [
  { id: "IC-1", family: "IC", conflictPattern: "execution-perturbation", expectedTruth: "lock", expectedDetectability: "typecheck", description: "增加必填参数并保留旧调用点。" },
  { id: "IC-2", family: "IC", conflictPattern: "overlap-contamination", expectedTruth: "lock", expectedDetectability: "typecheck", description: "删除返回对象字段并保留旧字段读取。" },
  { id: "IC-3", family: "IC", conflictPattern: "confluent-interference", expectedTruth: "lock", expectedDetectability: "runtime-only", description: "改变返回值单位并让消费者按旧单位计算。" },
  { id: "CP-1", family: "CP", conflictPattern: "execution-perturbation", expectedTruth: "warn", expectedDetectability: "runtime-only", description: "改变规则优先级并保留旧回退路径。" },
  { id: "CP-2", family: "CP", conflictPattern: "confluent-interference", expectedTruth: "lock", expectedDetectability: "runtime-only", description: "移动默认值并删除调用方默认值。" },
  { id: "CP-3", family: "CP", conflictPattern: "confluent-interference", expectedTruth: "lock", expectedDetectability: "runtime-only", description: "收紧输入校验并产生旧格式输入。" },
  { id: "CP-4", family: "CP", conflictPattern: "execution-perturbation", expectedTruth: "warn", expectedDetectability: "runtime-only", description: "增加提前返回并依赖完整执行的副作用。" },
  { id: "SS-1", family: "SS", conflictPattern: "overlap-contamination", expectedTruth: "lock", expectedDetectability: "runtime-only", description: "改变共享对象写入方式并跨调用复用。" },
  { id: "SS-2", family: "SS", conflictPattern: "assignment-override", expectedTruth: "warn", expectedDetectability: "runtime-only", description: "改变初始化时机并重复写入共享字段。" },
  { id: "SS-3", family: "SS", conflictPattern: "confluent-interference", expectedTruth: "lock", expectedDetectability: "runtime-only", description: "改变写入幂等性并增加重试。" },
  { id: "EB-1", family: "EB", conflictPattern: "execution-perturbation", expectedTruth: "lock", expectedDetectability: "runtime-only", description: "把抛出异常改为返回 undefined 并保留旧回退。" },
  { id: "EB-2", family: "EB", conflictPattern: "execution-perturbation", expectedTruth: "warn", expectedDetectability: "typecheck", description: "把同步函数改为异步并保留同步消费者。" },
  { id: "SF-1", family: "SF", expectedTruth: "allow", expectedDetectability: "none", description: "只增加日志。" },
  { id: "SF-2", family: "SF", expectedTruth: "allow", expectedDetectability: "none", description: "进行保持语义的局部重构。" },
  { id: "SF-3", family: "SF", expectedTruth: "allow", expectedDetectability: "none", description: "修改无数据流关联的函数。" },
  { id: "SF-4", family: "SF", expectedTruth: "allow", expectedDetectability: "none", description: "增加可选字段并读取原有字段。" },
  { id: "SF-5", family: "SF", expectedTruth: "allow", expectedDetectability: "none", description: "修改同一函数中互斥分支。" }
];

export function operatorById(id: string) {
  return OPERATOR_SPECS.find((operator) => operator.id === id);
}

