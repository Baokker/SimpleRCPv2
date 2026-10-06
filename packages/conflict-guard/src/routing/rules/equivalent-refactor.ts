import { verdict, type ZoneRule } from "./context.js";

export const equivalentRefactor: ZoneRule = (context) => {
  if (context.incompatibilities.some(Boolean) || !(context.left.equivalentRefactor || context.right.equivalentRefactor)) return undefined;
  return verdict(context, "white", "allow", "equivalent-refactor", "一侧是保持语义的局部重构。");
};
