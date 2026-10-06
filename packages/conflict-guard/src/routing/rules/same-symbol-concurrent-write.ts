import { verdict, type ZoneRule } from "./context.js";

export const sameSymbolConcurrentWrite: ZoneRule = (context) => {
  const { input } = context;
  if (input.path !== null && !input.nested && input.left.symbol.key !== input.right.symbol.key) return undefined;
  return verdict(context, "black", "lock", "same-symbol-concurrent-write", input.nested ? "双方修改了同一声明的不同部分。" : "双方正在同时修改同一个声明。");
};
