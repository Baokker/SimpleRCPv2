import { parseChangeSource, readsProperty, returnedPropertyShape } from "../contracts.js";
import { verdict, type ZoneRule } from "./context.js";

export const consumedReturnPropertyRemoved: ZoneRule = (context) => {
  for (const producer of [context.input.left, context.input.right]) {
    const consumer = producer === context.input.left ? context.input.right : context.input.left;
    const before = returnedPropertyShape(parseChangeSource(producer.symbol, producer.symbol.before));
    const after = returnedPropertyShape(parseChangeSource(producer.symbol, producer.symbol.after));
    if (!before.known || !after.known) continue;
    const removed = [...before.properties].find((property) => !after.properties.has(property) && readsProperty(parseChangeSource(consumer.symbol, consumer.symbol.after), property));
    if (removed) return verdict(context, "black", "lock", "consumed-return-property-removed", `返回对象属性 ${removed} 被删除，但另一侧仍在读取它。`, [{ file: producer.symbol.file, detail: `删除属性 ${removed}` }]);
  }
  return undefined;
};
