import type { Level } from "./types.js";

export const LEVELS: Level[] = [
  "viewer",
  "contributor",
  "maintainer",
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
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "ta", label: "助教", displayName: "Teaching assistant", level: "maintainer" },
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "teaching-student", label: "学生", displayName: "Student", level: "contributor" },
  { scenario: "教学与实验课", scenarioDisplayName: "Teaching", role: "auditor", label: "旁听者", displayName: "Auditor", level: "viewer" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "lead", label: "负责人", displayName: "Lead", level: "owner" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "maintainer", label: "维护者", displayName: "Maintainer", level: "maintainer" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "developer", label: "开发者", displayName: "Developer", level: "maintainer" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "newcomer", label: "新成员", displayName: "Newcomer", level: "contributor" },
  { scenario: "团队协作开发", scenarioDisplayName: "Team development", role: "viewer", label: "查看者", displayName: "Viewer", level: "viewer" },
  { scenario: "技术面试与考核", scenarioDisplayName: "Technical interview", role: "interviewer", label: "面试官", displayName: "Interviewer", level: "owner" },
  { scenario: "技术面试与考核", scenarioDisplayName: "Technical interview", role: "candidate", label: "候选人", displayName: "Candidate", level: "contributor" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "host", label: "项目负责人", displayName: "Project lead", level: "owner" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "mentor", label: "核心成员", displayName: "Core member", level: "maintainer" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "contributor", label: "外部贡献者", displayName: "External contributor", level: "contributor" },
  { scenario: "外部贡献与黑客松", scenarioDisplayName: "Open contribution", role: "visitor", label: "访客", displayName: "Visitor", level: "viewer" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "commander", label: "指挥员", displayName: "Commander", level: "owner" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "oncall", label: "值班员", displayName: "On-call", level: "maintainer" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "responder", label: "响应员", displayName: "Responder", level: "maintainer" },
  { scenario: "运维故障排查", scenarioDisplayName: "Incident response", role: "stakeholder", label: "相关人员", displayName: "Stakeholder", level: "viewer" }
];

const legacyLevels = new Map<string, Level>([["observer", "viewer"], ["student", "contributor"], ["collaborator", "maintainer"], ["trusted", "maintainer"]]);

const roleMap = new Map<string, Level>([
  ...SCENARIOS.map((entry) => [entry.role, entry.level] as const),
  ...LEVELS.map((level) => [level, level] as const)
]);

export function roleLevel(raw: string | undefined | null): Level {
  return roleMap.get(normalizeStoredRole(raw)) ?? "contributor";
}

// A newer trigger may stop a running task only when its level is not below that of the task's trigger.
export function canInterruptRun(newRole: string | undefined | null, activeRole: string | undefined | null): boolean {
  return LEVELS.indexOf(roleLevel(newRole)) >= LEVELS.indexOf(roleLevel(activeRole));
}

export function normalizeStoredRole(raw: string | undefined | null): string {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return legacyLevels.get(normalized) ?? (roleMap.has(normalized) ? normalized : "");
}

export function getOnlineOwners(
  members: Array<{ id: string; online: boolean; role?: string; profileRole?: string }>
) {
  return members.filter(
    (member) => member.online && roleLevel(member.role ?? member.profileRole) === "owner"
  );
}
