import { verdict, type ZoneRule } from "./context.js";

export const mergeOnlyTypeError: ZoneRule = (context) => {
  if (!context.typecheck?.ran || (context.typecheck.mergeOnlyDiagnostics?.length ?? 0) === 0) return undefined;
  return verdict(context, "black", "lock", "merge-only-type-error", "合并双方修改后才出现类型错误。");
};
