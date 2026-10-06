import { verdict, type ZoneRule } from "./context.js";

export const typeOnlyUnchanged: ZoneRule = (context) => {
  const { input } = context;
  if (!input.typeOnly || [input.left.symbol.kind, input.right.symbol.kind].some((kind) => kind === "interface" || kind === "type" || kind === "enum")) return undefined;
  return verdict(context, "white", "allow", "type-only-unchanged", "双方只通过类型关联，当前修改没有改变该类型声明。");
};
