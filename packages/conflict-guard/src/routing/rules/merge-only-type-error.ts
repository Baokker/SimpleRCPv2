import { verdict, type ZoneRule } from "./context.js";

export const mergeOnlyTypeError: ZoneRule = (context) => {
  const { input } = context;
  context.typecheck ??= input.project.checkFourStates?.({ left: input.left, right: input.right, path: input.path });
  if (!context.typecheck?.ran || (context.typecheck.mergeOnlyDiagnostics?.length ?? 0) === 0) return undefined;
  return verdict(context, "black", "lock", "merge-only-type-error", "合并双方修改后才出现类型错误。");
};
