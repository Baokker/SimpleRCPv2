export const guardRuleLabels: Record<string, string> = {
  "same-symbol-concurrent-write": "同时修改同一处代码",
  "comment-only-edit": "只改了注释",
  "comment-format-only": "只改了注释或空白",
  "declaration-body-unrelated": "改的是同一个函数的不同位置",
  "observability-only": "只改了日志",
  "equivalent-refactor": "整理代码，行为保持一致",
  "referenced-symbol-removed": "删除了别人还在使用的符号",
  "runtime-export-removed": "删了别人还在用的导出",
  "call-signature-incompatible": "改了函数签名",
  "consumed-return-property-removed": "删除了别人使用的返回属性",
  "interface-required-member-incompatible": "改了接口的必需成员",
  "merge-only-type-error": "合并后出现类型错误",
  "type-only-unchanged": "仅类型关联，未改该类型本身",
  "unparsable-side": "修改中的代码暂时无法解析",
  "semantic-interaction-uncertain": "需要研判修改之间的影响",
  "model-fast": "由快判模型研判",
  "model-deep": "由深判模型研判",
  "model-unavailable": "模型研判未完成",
  "policy-error": "检查未完成",
  "agent-analysis-unavailable": "Agent 研判未完成",
  "no-relation": "修改之间没有关联",
  "p0-no-coordination": "直接放行修改",
  "p1-same-file": "同时修改同一文件",
  "p1-file-lock": "文件之间没有冲突",
  "p2-static-dal": "修改之间存在依赖关系"
};

export const guardCheckLabels = {
  T1: "人的修改检查",
  T2: "Agent 写入前检查",
  T3: "Agent 任务完成后复检"
};

export function ruleName(ruleId?: string) {
  return ruleId ? guardRuleLabels[ruleId] ?? `${ruleId}（未翻译）` : "等待检查";
}

export function readableGuardText(text: string) {
  let result = text;
  for (const [identifier, label] of Object.entries(guardRuleLabels)) result = result.replaceAll(identifier, label);
  return result.replace(/\bT[123]\b/g, (identifier) => guardCheckLabels[identifier as keyof typeof guardCheckLabels]);
}

export function zoneName(zone: "white" | "black" | "grey") {
  return { white: "白区", black: "黑区", grey: "灰区" }[zone];
}

export function decisionName(decision: "allow" | "warn" | "lock") {
  return { allow: "放行", warn: "提醒", lock: "拦住" }[decision];
}
