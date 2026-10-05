import type { ConflictGuardState } from "./conflictGuardTypes";

const relations: Record<string, string> = {
  call: "调用", "value-reference": "引用值", "type-reference": "引用类型",
  inheritance: "继承", implementation: "实现", "state-read": "读取状态",
  "state-write": "写入状态", contains: "包含", override: "覆写", "implements-member": "实现成员"
};

export function relationPathText(path: ConflictGuardState["candidatePairs"][number]["path"]) {
  return path?.hops.map((hop) => {
    const from = hop.direction === "forward" ? hop.from : hop.to;
    const to = hop.direction === "forward" ? hop.to : hop.from;
    return `${from.slice(from.indexOf("#") + 1)} ${relations[hop.kind] ?? hop.kind} ${to.slice(to.indexOf("#") + 1)}`;
  }).join("；") ?? "双方正在修改同一声明";
}
