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
  scenarioDisplayName: string;
  role: string;
  label: string;
  displayName: string;
  level: Level;
}

export const SCENARIOS: ScenarioRole[] = [
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "teacher", label: "教师", displayName: "Teacher", level: "owner" },
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "ta", label: "助教", displayName: "Teaching assistant", level: "trusted" },
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "student", label: "学生", displayName: "Student", level: "student" },
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "auditor", label: "审计员", displayName: "Auditor", level: "observer" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "lead", label: "负责人", displayName: "Lead", level: "owner" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "maintainer", label: "维护者", displayName: "Maintainer", level: "trusted" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "developer", label: "开发者", displayName: "Developer", level: "collaborator" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "newcomer", label: "新成员", displayName: "Newcomer", level: "student" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "viewer", label: "查看者", displayName: "Viewer", level: "observer" },
  { scenario: "技术面试与考核", scenarioDisplayName: "Technical interview", role: "interviewer", label: "面试官", displayName: "Interviewer", level: "owner" },
  { scenario: "技术面试与考核", scenarioDisplayName: "Technical interview", role: "candidate", label: "候选人", displayName: "Candidate", level: "student" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "host", label: "主办者", displayName: "Host", level: "owner" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "mentor", label: "导师", displayName: "Mentor", level: "trusted" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "contributor", label: "贡献者", displayName: "Contributor", level: "student" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "commander", label: "指挥员", displayName: "Commander", level: "owner" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "oncall", label: "值班员", displayName: "On-call", level: "trusted" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "responder", label: "响应员", displayName: "Responder", level: "collaborator" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "stakeholder", label: "相关人员", displayName: "Stakeholder", level: "observer" }
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
