import { defaultRoutingConfig } from "../config.js";
import { verdict, type ZoneRule } from "./context.js";
import { mergeOnlyTypeError } from "./merge-only-type-error.js";

export const declarationBodyUnrelated: ZoneRule = (context) => {
  const { input, left, right } = context;
  if (context.incompatibilities.some(Boolean)) return undefined;
  if (input.left.symbol.key !== input.right.symbol.key || left.parseError || right.parseError || left.contractChanged || right.contractChanged) return undefined;
  if (input.left.symbol.status !== "modified" || input.right.symbol.status !== "modified") return undefined;
  const leftRanges = input.left.symbol.editedLineRanges;
  const rightRanges = input.right.symbol.editedLineRanges;
  if (!leftRanges?.length || !rightRanges?.length) return undefined;
  const threshold = input.bodyUnrelatedMaxAdjacentLines ?? defaultRoutingConfig.bodyUnrelatedMaxAdjacentLines;
  if (leftRanges.some((a) => rightRanges.some((b) => Math.max(a.start - b.end, b.start - a.end, 0) <= threshold))) return undefined;
  const incompatible = mergeOnlyTypeError(context);
  if (context.typecheck?.inferredReturnTypeChanged) {
    context.contractChanged.left ||= context.typecheck.inferredReturnTypeChanged.left;
    context.contractChanged.right ||= context.typecheck.inferredReturnTypeChanged.right;
  }
  if (context.contractChanged.left || context.contractChanged.right) return undefined;
  if (incompatible) return incompatible;
  if (!context.typecheck?.ran) return undefined;
  return { ...verdict(context, "grey", "warn", "declaration-body-unrelated", "双方正在修改同一声明的不同部分，请留意修改之间的影响。"), localOnly: true };
};
