import { isExported, parseChangeSource, referencesName } from "../contracts.js";
import { verdict, type ZoneRule } from "./context.js";

export const referencedSymbolRemoved: ZoneRule = (context) => {
  for (const producer of [context.input.left, context.input.right]) {
    const consumer = producer === context.input.left ? context.input.right : context.input.left;
    const before = parseChangeSource(producer.symbol, producer.symbol.before);
    const after = parseChangeSource(producer.symbol, producer.symbol.after);
    const exportRemoved = producer.symbol.file !== consumer.symbol.file && isExported(before) && !isExported(after);
    if (exportRemoved || producer.symbol.exported || (producer.symbol.status !== "deleted" && producer.symbol.after.length > 0)) continue;
    if (referencesName(parseChangeSource(consumer.symbol, consumer.symbol.after), producer.symbol.name)) return verdict(context, "black", "lock", "referenced-symbol-removed", "一侧删除了另一侧仍然引用的符号。", [{ file: producer.symbol.file, detail: `删除 ${producer.symbol.name}` }]);
  }
  return undefined;
};
