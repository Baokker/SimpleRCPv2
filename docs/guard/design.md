# 共享终端与 Agent Guard 设计

## 请求与刻画

`GuardRequest` 记录项目、发起成员、来源、工具种类、命令或路径、工作目录。来源可以是 `terminal` 或 `agent`。Agent 每次工具调用都使用发起成员当前的角色，运行开始时不保存权限结果。

命令刻画为若干 `GuardSegment`。每段包含能力、路径分区和可逆性。能力包括 `read`、`write`、`delete`、`exec`、`network`、`history`、`process`、`privilege`、`install`。路径分区包括 `workspace`、`outside`、`protected`、`metadata`。可逆性包括 `reversible`、`snapshot`、`irreversible`。

工作区外、项目元数据目录、其他项目工作区、默认受保护文件和项目追加的受保护路径分别按分区处理。Shell 的变量展开、命令替换、管道、重定向、解释器内联代码和无法解析的路径会提高风险等级。

## 档位与矩阵

场景角色存储在成员的 `role` 字段。引擎将角色映射到 `observer`、`student`、`collaborator`、`trusted`、`owner` 五个档位。空值、大小写差异和未知值经过规范化后使用 `collaborator`。

| 能力 | observer | student | collaborator | trusted | owner |
|---|---|---|---|---|---|
| read | allow | allow | allow | allow | allow |
| write | deny | allow_snapshot | allow_snapshot | allow | allow |
| delete | deny | ask | allow_snapshot | allow_snapshot | allow |
| exec | deny | allow | allow | allow | allow |
| network | deny | ask | allow | allow | allow |
| install | deny | ask | ask | ask | allow |
| history | deny | ask | ask | ask | allow |
| process | deny | ask | ask | ask | allow |
| privilege | deny | deny | deny | ask | allow |

动作严格程度为 `deny`、`ask`、`allow_snapshot`、`allow`。一个命令包含多段时使用最严格动作。`metadata` 永远 `deny`，`outside` 与 `protected` 永远至少 `ask`。非 owner 的不可逆操作至少 `ask`，owner 的网络写入、提权、网络加执行仍需本人确认。

Agent 继承发起成员的档位。Agent 的不可逆操作和网络加执行至少 `ask`，发起成员离线时非读取请求 `deny`。Agent 永远不能审批自己的请求。

## 审批与交互控制

`ask` 请求进入项目审批队列。普通请求发送给在线 owner；Agent 仅因 Agent 上限提高到 `ask` 的请求发送给发起成员本人。点击审批卡片时重新检查在线状态和当前档位，批准只对当前请求有效。默认审批等待时间为 120 秒，Agent 请求取该值与运行时间一半中的较小值。

共享终端默认使用命令模式。命令整行提交后执行策略判定。owner 可以授予任意在线成员十分钟交互控制；同时只有一名持有者。交互控制期间按键直接写入 pty，持有者下线、到期或被收回后失效。终端检测到前台程序时拒绝命令模式提交。

## 快照与恢复

`allow_snapshot` 按命令涉及的工作区路径复制被跟踪和未被忽略的文件，记录文件哈希与命令。没有明确路径的工作区级快照只允许 owner 恢复。快照保留最近 20 项，存放在项目元数据目录的 `snapshots`。对于命令执行前不存在的目标路径，快照清单记录空哈希；恢复时会删除该目标路径以及它后来创建的内容。对于快照中没有记录的文件，恢复过程不会删除快照创建之后的新文件。

## LLM 研判

项目策略文件 `guard-policy.json` 保存受保护路径与 `llmMode`。模式有 `off`、`suggest`、`auto`。LLM 只接收 `ask` 请求，命令文本在提示中作为不可信数据处理。模型返回风险、置信度和理由。

`suggest` 只把结果显示在审批卡片，并持续等待人工处理。`auto` 只处理 `autoEligible` 请求：未知命令或仅由档位矩阵产生的可逆请求，终端置信度阈值为 0.85，Agent 阈值为 0.95。不可逆、工作区外、受保护路径、动态 Shell、硬性规则和 Agent 上限产生的请求不能被自动放行。模型结果只能提高动作等级，不能降低 `deny` 或硬性 `ask`。`suggest` 的人工审批不受常规审批时限限制，审批会持续到 owner 处理请求。

## OpenCode 接入

Guard 模式为 `full` 或 `human-only` 时，OpenCode 的 `bash`、`edit`、`webfetch`、`websearch` 使用 `ask`，子 Agent `task` 使用 `deny`。`full` 使用按路径对象规则：通配规则先写入，`*.env`、`*.env.*`、`.env*`、`*.pem`、`*.key`、`*.git/config`、`*.git/hooks/*` 后写入。`off` 和 `human-only` 不覆盖 `read` 键，让 OpenCode 保留默认保护。OpenCode 1.18.31 的 SDK 类型确认支持 `read` 对象配置。

运行时同时处理 `permission.asked` 与 `permission.v2.asked`，并将请求交给同一个策略服务。允许时只回复 `once`，拒绝时回复 `reject`。系统永远不回复 `always`，防止一次批准变成会话级永久放行。取消或超时会清理该运行的待审批请求并回复 `reject`。

`SIMPLERCP_GUARD_MODE` 有三个评价条件：`full` 同时管控人和 Agent，`human-only` 只管控人的终端，`off` 保持旧终端与 Agent 行为。正式启动由 `loadConfig()` 默认使用 `full`；直接构造旧测试配置时没有该字段，会保留旧入口行为。

## 团队 Agent

团队 Agent 的每次 run 都把本次聊天消息作者作为发起成员，Guard 请求使用 `run.initiatorMemberId ?? run.memberId` 获取成员身份。团队 session 的 `memberId` 为空字符串，只用于标识共享 session，不能用于读取角色或审批人。每次工具请求都会按发起成员当前档位重新判定，因此成员角色变化会立即影响后续请求。

团队 Agent 请求会记录 `sessionScope: "team"` 和 Agent handle。审批卡片显示 Agent handle 与触发成员，在线 owner 或本次触发成员按照 Guard 决策处理审批。网络加执行、不可逆操作和发起成员离线时的非读取请求继续受 Agent 额外上限约束。额外上限根据不可逆分段和管道中的网络命令判断，不依赖同一分段同时出现网络与执行两个能力。

团队 Agent 被新消息打断时，旧 run 标记为 `cancelled`，对应待审批请求立即拒绝并向 OpenCode 回复 `reject`，审批卡片从在线审批人的列表中移除。共享聊天上下文会作为讨论材料注入提示词，Guard 仍按每次工具调用的请求数据判定，不把讨论内容当作授权依据。

## 审计

每次决策和审批结果追加到项目元数据目录的 `guard-audit.jsonl`，记录时间、成员、来源、运行标识、团队会话范围、Agent handle、命令或路径、动作、命中规则、审批人、模型结论和判定耗时。写入前调用现有脱敏函数。`allow_snapshot`、`ask`、`deny` 和审批结果同步写入活动日志，`allow` 只写审计文件。
