// Chinese wording for the terminal guard. Rule ids stay in tooltips for debugging; people see plain text.

const RULE_TEXT: Record<string, string> = {
  "hard.control-character": "命令里含有控制字符",
  "hard.cwd": "不能在共享终端里切换目录",
  "hard.metadata": "平台的项目数据受保护",
  "hard.outside": "涉及项目目录以外的路径",
  "hard.protected": "涉及受保护的文件，例如 .env 或密钥",
  "hard.dynamic": "命令里有变量、循环或通配符，需要人确认实际会做什么",
  "hard.git-context": "会改变版本库状态的 Git 命令",
  "hard.interactive-control": "需要先取得终端的交互控制权",
  "hard.nonowner.irreversible": "不可撤销的操作，需要负责人批准",
  "hard.owner.irreversible-external": "会影响项目以外系统的不可撤销操作",
  "hard.owner.git-clean": "会删除未跟踪文件的 git clean",
  "hard.legacy-dangerous": "这条命令属于危险命令",
  "classify.unknown": "平台不认识这条命令，需要人确认",
  "agent.default": "Agent 发起的这类操作需要发起人确认",
  "agent.unknown-tool": "Agent 使用了平台不认识的工具",
  "agent.initiator-offline": "发起这个 Agent 的成员已离线",
  "agent.run-cancelled": "这次 Agent 任务已被停止",
  "guard.run-cancelled": "这次 Agent 任务已被停止",
  "native.platform-ask": "Agent 请你确认这项操作",
  "approval.remembered": "同一类命令此前已经批准过",
  "owner.self-command": "负责人自己执行的命令"
};

const LEVEL_TEXT: Record<string, string> = {
  viewer: "查看者",
  contributor: "贡献者",
  maintainer: "维护者",
  owner: "负责人"
};

const CAPABILITY_TEXT: Record<string, string> = {
  privilege: "使用管理员权限（sudo）",
  network: "访问网络",
  delete: "删除文件",
  process: "控制进程",
  install: "安装依赖",
  history: "改写项目历史",
  write: "写文件",
  exec: "运行命令",
  exec_uninspectable: "运行无法检查的代码",
  read: "读文件"
};

const EN_RULE_TEXT: Record<string, string> = {
  "hard.control-character": "Command contains control characters",
  "hard.cwd": "Directory changes are blocked in the shared terminal",
  "hard.metadata": "Platform project data is protected",
  "hard.outside": "Request targets a path outside the project",
  "hard.protected": "Request targets a protected file or secret",
  "hard.dynamic": "Dynamic command syntax requires human review",
  "hard.git-context": "Git state changes require human review",
  "hard.interactive-control": "Interactive terminal control is required",
  "hard.nonowner.irreversible": "Irreversible operations require owner approval",
  "hard.owner.irreversible-external": "Irreversible operations affecting external systems require approval",
  "hard.owner.git-clean": "git clean would remove untracked files",
  "hard.legacy-dangerous": "Command is classified as dangerous",
  "classify.unknown": "Command is not recognized and requires review",
  "agent.default": "This Agent operation requires approval",
  "agent.unknown-tool": "Agent used an unrecognized tool",
  "agent.initiator-offline": "The Agent run initiator is offline",
  "agent.run-cancelled": "Agent run was cancelled",
  "guard.run-cancelled": "Agent run was cancelled",
  "native.platform-ask": "Agent requests approval for this operation",
  "approval.remembered": "A matching request was approved recently",
  "owner.self-command": "Owner's own terminal command"
};

const EN_LEVEL_TEXT: Record<string, string> = { viewer: "Viewer", contributor: "Contributor", maintainer: "Maintainer", owner: "Owner" };
const EN_CAPABILITY_TEXT: Record<string, string> = {
  privilege: "privilege escalation", network: "network access", delete: "file deletion", process: "process control",
  install: "dependency installation", history: "project history changes", write: "file writes", exec: "command execution",
  exec_uninspectable: "execution of uninspectable code", read: "file reads"
};

export const englishLocale = typeof import.meta.env !== "undefined" && import.meta.env.VITE_SIMPLERCP_LOCALE === "en";

export function guardLevelText(level: string) {
  if (englishLocale) return EN_LEVEL_TEXT[level] ?? level;
  return LEVEL_TEXT[level] ?? level;
}

export function guardRuleText(rule: string, denied = false): string {
  if (englishLocale) {
    const inner = rule.replace(/^script\./, "");
    if (EN_RULE_TEXT[inner]) return EN_RULE_TEXT[inner];
    const roleRule = inner.match(/^role\.(viewer|contributor|maintainer)\.(.+)$/);
    if (roleRule) {
      const capability = EN_CAPABILITY_TEXT[roleRule[2]!] ?? roleRule[2]!;
      return `${EN_LEVEL_TEXT[roleRule[1]!]} ${denied ? "cannot perform" : "requires approval for"} ${capability}`;
    }
    const writer = inner.match(/^writer\.(.+)$/);
    if (writer) return `File was last edited by a ${EN_LEVEL_TEXT[writer[1]!] ?? writer[1]}`;
    if (inner === "dynamic-code") return "Script contains dynamically generated code";
    return "Additional guard rule";
  }
  const inner = rule.replace(/^script\./, "");
  const prefix = inner === rule ? "" : "package.json 里的脚本";
  if (RULE_TEXT[inner]) return prefix ? `${prefix}${RULE_TEXT[inner]}` : RULE_TEXT[inner];
  const roleRule = inner.match(/^role\.(viewer|contributor|maintainer)\.(.+)$/);
  if (roleRule) {
    const level = guardLevelText(roleRule[1]!);
    const capability = CAPABILITY_TEXT[roleRule[2]!] ?? roleRule[2]!;
    return denied ? `${level}不能${capability}` : `${level}${capability}需要负责人批准`;
  }
  const writer = inner.match(/^writer\.(.+)$/);
  if (writer) return `${prefix}最近由${guardLevelText(writer[1]!)}修改过`;
  if (inner === "dynamic-code") return `${prefix}里有动态生成的代码`;
  return "其他规则";
}

export function guardReasonText(rules: string[], denied = false) {
  const texts = [...new Set(rules.map((rule) => guardRuleText(rule, denied)))];
  return texts.join("；");
}

export function guardRiskText(risk: string) {
  if (englishLocale) return risk === "high" ? "high" : risk === "low" ? "low" : risk === "medium" ? "medium" : risk;
  return risk === "high" ? "高" : risk === "low" ? "低" : risk === "medium" ? "中" : risk;
}

export function guardRecommendationText(risk: string) {
  if (englishLocale) return risk === "high" ? "Recommend rejection" : risk === "low" ? "Recommend approval" : "Recommend human review";
  if (risk === "high") return "建议拒绝";
  if (risk === "low") return "建议批准";
  return "建议人工判断";
}

export function guardActionWord(action: string | undefined) {
  if (englishLocale) {
    if (action === "deny") return "Blocked";
    if (action === "allow_snapshot") return "Snapshotted and executed";
    if (action === "ask") return "Submitted for approval";
    if (action === "allow") return "Allowed";
    return "Checked";
  }
  if (action === "deny") return "已拦下";
  if (action === "allow_snapshot") return "已先保存快照再执行";
  if (action === "ask") return "已提交审批";
  if (action === "allow") return "已放行";
  return "已检查";
}

// Server reasons are either rule ids joined by ", " or fixed sentences; both become Chinese here.
export function guardServerReasonText(reason: string, denied = false) {
  if (englishLocale) {
    const fixed: Record<string, string> = {
      "Approval timed out": "Approval timed out", "Request was rejected": "Request was rejected",
      "Request was allowed": "Request was allowed", "Another command from this member is waiting": "Another command from this member is waiting",
      "Interactive control is required": "Interactive terminal control is required", "No approver is online": "No eligible approver is online"
    };
    if (fixed[reason]) return fixed[reason]!;
    const parts = reason.split(", ");
    if (parts.every((part) => /^[a-z][a-z-]*(?:\.[a-z0-9-]+)+$/.test(part))) return guardReasonText(parts, denied);
    return reason;
  }
  const fixed: Record<string, string> = {
    "Approval timed out": "审批超时",
    "Request was rejected": "请求被拒绝",
    "Request was allowed": "已放行",
    "Another command from this member is waiting": "你的上一条命令还在等待审批",
    "Terminal is busy; wait for the running program to finish": "终端正在运行其他程序",
    "Terminal became busy while the request was waiting": "等待审批期间终端开始运行其他程序"
  };
  if (fixed[reason]) return fixed[reason];
  if (reason.startsWith("Interactive control is required")) return "需要先取得终端的交互控制权";
  const parts = reason.split(/,\s*|；/).filter(Boolean);
  if (parts.every((part) => /^[a-z][a-z-]*(?:\.[a-z0-9-]+)+$/.test(part))) return guardReasonText(parts, denied);
  return reason;
}
