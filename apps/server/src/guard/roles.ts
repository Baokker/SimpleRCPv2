import type { Level } from "./types.js";

export const LEVELS: Level[] = [
  "observer",
  "student",
  "collaborator",
  "trusted",
  "owner"
];

export interface ScenarioRole {
  scenario: string;
  role: string;
  label: string;
  level: Level;
}

export const SCENARIOS: ScenarioRole[] = [
  { scenario: "教学与实验课", role: "teacher", label: "教师", level: "owner" },
  { scenario: "教学与实验课", role: "ta", label: "助教", level: "trusted" },
  { scenario: "教学与实验课", role: "student", label: "学生", level: "student" },
  { scenario: "教学与实验课", role: "auditor", label: "审计员", level: "observer" },
  { scenario: "团队协作开发", role: "lead", label: "负责人", level: "owner" },
  { scenario: "团队协作开发", role: "maintainer", label: "维护者", level: "trusted" },
  { scenario: "团队协作开发", role: "developer", label: "开发者", level: "collaborator" },
  { scenario: "团队协作开发", role: "newcomer", label: "新成员", level: "student" },
  { scenario: "团队协作开发", role: "viewer", label: "查看者", level: "observer" },
  { scenario: "技术面试与考核", role: "interviewer", label: "面试官", level: "owner" },
  { scenario: "技术面试与考核", role: "candidate", label: "候选人", level: "student" },
  { scenario: "外部贡献与黑客松", role: "host", label: "主办者", level: "owner" },
  { scenario: "外部贡献与黑客松", role: "mentor", label: "导师", level: "trusted" },
  { scenario: "外部贡献与黑客松", role: "contributor", label: "贡献者", level: "student" },
  { scenario: "运维故障排查", role: "commander", label: "指挥员", level: "owner" },
  { scenario: "运维故障排查", role: "oncall", label: "值班员", level: "trusted" },
  { scenario: "运维故障排查", role: "responder", label: "响应员", level: "collaborator" },
  { scenario: "运维故障排查", role: "stakeholder", label: "相关人员", level: "observer" }
];

const roleMap = new Map<string, Level>([
  ...SCENARIOS.map((entry) => [entry.role, entry.level] as const),
  ...LEVELS.map((level) => [level, level] as const)
]);

export function roleLevel(raw: string | undefined | null): Level {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return roleMap.get(normalized) ?? "collaborator";
}

export function normalizeStoredRole(raw: string | undefined | null): string {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return roleMap.has(normalized) ? normalized : "";
}

export function getOnlineOwners(
  members: Array<{ id: string; online: boolean; role?: string; profileRole?: string }>
) {
  return members.filter(
    (member) => member.online && roleLevel(member.role ?? member.profileRole) === "owner"
  );
}
