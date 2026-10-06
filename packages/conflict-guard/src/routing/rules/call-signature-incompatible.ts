import * as ts from "typescript";
import { callableSignature, callsTo, parseChangeSource } from "../contracts.js";
import { verdict, type ZoneRule } from "./context.js";

export const callSignatureIncompatible: ZoneRule = (context) => {
  for (const producer of [context.input.left.symbol, context.input.right.symbol]) {
    const consumer = producer === context.input.left.symbol ? context.input.right.symbol : context.input.left.symbol;
    const before = callableSignature(parseChangeSource(producer, producer.before), producer.name);
    const after = callableSignature(parseChangeSource(producer, producer.after), producer.name);
    if (!before || !after || (after.required <= before.required && after.maximum >= before.maximum)) continue;
    const calls = callsTo(parseChangeSource(consumer, consumer.after), producer.name);
    if (calls.some((call) => !call.arguments.some(ts.isSpreadElement) && (call.arguments.length < after.required || call.arguments.length > after.maximum))) return verdict(context, "black", "lock", "call-signature-incompatible", "一侧调用无法满足另一侧修改后的函数签名。", [{ file: producer.file, detail: `${producer.name} 的调用参数数量与签名不兼容` }]);
  }
  return undefined;
};
