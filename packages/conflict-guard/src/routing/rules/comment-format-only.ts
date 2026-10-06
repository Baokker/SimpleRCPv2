import { verdict, type ZoneRule } from "./context.js";

export const commentFormatOnly: ZoneRule = (context) => {
  if (context.incompatibilities.some(Boolean) || !(context.left.commentFormatOnly || context.right.commentFormatOnly)) return undefined;
  return verdict(context, "white", "allow", "comment-format-only", "一侧只修改了注释或空白。");
};
