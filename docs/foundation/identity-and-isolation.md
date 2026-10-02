# 轻量身份与运行隔离

## 成员模型

服务端为每个项目保存 `members.json`，记录 `memberId`、`projectId`、`displayName`、`role` 和时间。成员 ID 由服务端生成 UUID。Role 由加入页面填写，留空时不显示，所有成员能力相同。

`POST /api/projects/:projectId/members` 接收 `name`、可选 `role`、`memberId` 与连接标识 `connectionId`。已有成员 ID 恢复原成员并更新显示名；提供 Role 时更新 Role，省略时保留。未知 ID 会得到新的服务端 ID。

客户端以 `sessionStorage` 保存当前标签页的 `simplercp.memberId.<projectId>`，并以同名 `localStorage` 项保存最近一次选择。刷新当前标签页会恢复自己的成员；新标签页可以从最近选择开始，也可以在加入页选择已有成员或创建新成员。连接仍分别使用自己的 `connectionId`。旧 `participants.json` 可以在首次读取时转换为成员记录；兼容接口中的 `participantId` 与 `memberId` 使用同一个值。

## 身份传递

`auth/identity.ts` 从 HTTP 请求头 `X-SimpleRCP-Member` 查询成员记录，得到 `{ projectId, memberId, displayName, role }` 并设置 `req.identity`。需要成员身份的接口查不到成员时返回 401。项目首页、项目管理与全局设置可以直接使用。

`/ws`、`/yjs`、`/terminal` 从 query 读取 `memberId`，查询所属项目记录。连接建立后绑定身份，后续消息中的身份字段被忽略。聊天作者、文件操作成员、Agent run 发起人和 session 所有者由服务端填写。run 同时保存 `initiatorMemberId` 与 `initiatorRole`。

`sharedTerminal.write(data, memberId)` 必须接收成员 ID，内部 `onInput` 为后续命令检查提供输入事件。活动按成员聚合一秒内的输入次数，保存成员名字与次数，不保存输入内容。

## 权限入口

`auth/permissions.ts` 保留 `can(identity, action, resource?)`，本轮返回允许。终端输入使用 `terminal:input`，文件写入使用 `workspace:write`，Agent 发起与取消使用 `agent:create`、`agent:cancel`，项目管理使用 `project:write`，全局设置使用 `agent:settings`。后续研究可以在同一个函数中增加 Role 规则。

## 数据目录与迁移

- `.simplercp-data/projects/<id>/`：项目记录、成员、聊天、活动、run、trace 与 session。
- `.simplercp-data/workspaces/<id>/`：项目代码，可通过 `SIMPLERCP_WORKSPACES_DIR` 指定其他绝对路径。
- `.simplercp-data/instance/`：迁移开始与完成标记。

运行模块从项目的 `metadataPath` 获取元数据目录。启动时移动旧 `projects/<id>/workspace/`，更新 `project.json` 与 `registry.json`；工作区已移动且登记表尚未更新时可以继续迁移。不同文件系统使用中间目录复制后移动。失败时保留原数据，修正原因后重新启动。

旧 session 无法对应当前成员记录时标为历史记录，保留数据，不按显示名认领。旧 OpenCode `runtimeSessionId` 可能仍对应迁移前目录，继续工作时创建新的 session。

## 子进程与脱敏

`processEnv.ts` 为终端提供 PATH、HOME、USER、LOGNAME、SHELL、LANG、LC_*、TERM、COLORTERM、TMPDIR、TZ。可以增加普通变量，名称匹配 KEY、TOKEN、SECRET、PASSWORD、COOKIE 的变量始终过滤。OpenCode 额外接收 DeepSeek 配置。`SIMPLERCP_TERMINAL_HOME` 可以指定专用 HOME。

OpenCode `external_directory=deny` 限制文件工具越界。OpenCode 进程需要通过 `DEEPSEEK_API_KEY` 调用 Provider，因此其 bash 工具可以读取模型 Key；终端进程不会继承该变量。trace 收集环境中疑似密钥变量值，替换为 `[REDACTED:<变量名>]`，同时处理 `sk-`、Bearer 与 Authorization。活动和聊天使用同一脱敏函数。

## 使用范围

平台不做鉴权，知道 `memberId` 即可冒充成员，只适合受信内部环境。CORS 开放，目录导入限制可选。终端或 Agent 也能调用本机 API。

终端与 Agent 以服务端系统用户运行，绝对路径可以读取该用户有权限访问的其他项目、元数据与 `.env`。当前没有 CPU、内存或进程数限制。OpenCode bash 可能看到模型 Key，B3 应增加 `ask` 与审批处理。

验证记录见 [本轮报告](./lightweight-identity-report.md)，B0 结果见 [基线](./baseline-20261002.md)。
