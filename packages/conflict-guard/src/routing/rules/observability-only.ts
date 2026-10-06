import { verdict, type ZoneRule } from "./context.js";

export const observabilityOnly: ZoneRule = (context) => {
  if (context.incompatibilities.some(Boolean) || !(context.left.observabilityOnly || context.right.observabilityOnly)) return undefined;
  return verdict(context, "white", "allow", "observability-only", "一侧只增加了日志或可观测性语句。");
};
