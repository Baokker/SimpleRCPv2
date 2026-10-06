import { hasTypeAnnotation, parseChangeSource, referencesName, requiredMembers } from "../contracts.js";
import { verdict, type ZoneRule } from "./context.js";

export const interfaceRequiredMemberIncompatible: ZoneRule = (context) => {
  for (const producer of [context.input.left.symbol, context.input.right.symbol]) {
    if (producer.kind !== "interface") continue;
    const consumer = producer === context.input.left.symbol ? context.input.right.symbol : context.input.left.symbol;
    const before = requiredMembers(parseChangeSource(producer, producer.before));
    const after = requiredMembers(parseChangeSource(producer, producer.after));
    const added = [...after].filter((member) => !before.has(member));
    const consumerSource = parseChangeSource(consumer, consumer.after);
    if (added.some((member) => !referencesName(consumerSource, member)) && hasTypeAnnotation(consumerSource)) return verdict(context, "black", "lock", "interface-required-member-incompatible", "一侧增加了接口必需成员，另一侧仍使用旧对象结构。", [{ file: producer.file, detail: `接口新增必需成员 ${added.join(", ")}` }]);
  }
  return undefined;
};
