import { verdict, type ZoneRule } from "./context.js";

export const unparsableSide: ZoneRule = (context) => {
  if (!context.left.parseError && !context.right.parseError) return undefined;
  return verdict(context, "grey", "warn", "unparsable-side", "至少一侧修改暂时无法解析，语义关系需要进一步确认。");
};
