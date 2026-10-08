import { verdict, type ZoneRule } from "./context.js";

export const observabilityOnly: ZoneRule = (context) => {
  if ((context.input.path === null || context.input.nested) && (context.left.contractChanged || context.right.contractChanged)) return undefined;
  if (context.incompatibilities.some(Boolean) || !(context.left.observabilityOnly || context.right.observabilityOnly)) return undefined;
  return verdict(context, "white", "allow", "observability-only", "一侧仅修改无副作用的日志语句。");
};
