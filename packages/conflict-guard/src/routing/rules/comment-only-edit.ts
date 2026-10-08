import { verdict, type ZoneRule } from "./context.js";

export const commentOnly: ZoneRule = (context) => {
  if (!context.left.commentFormatOnly || !context.right.commentFormatOnly) return undefined;
  return verdict(context, "white", "allow", "comment-only-edit", "双方仅修改注释或空白。");
};
