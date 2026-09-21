# 协作 Activity 与 Agent 会话保存调研

调研日期：2026-09-21

## 官方产品行为

### GitHub Copilot coding agent

GitHub 将 Agent session 作为可长期访问的工作记录。Session 页面保留进度、token 使用量、持续时间、内部推理和工具调用。提交记录还会链接到对应 session log，便于在代码审查和审计时查询修改原因。停止 session 以后，已经推送的提交仍然保留；Cloud Agent session 可以归档，不能删除。项目成员能够查看共享 session 的提示词、回复与文件变化。[GitHub Docs：Managing agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)

GitHub Copilot CLI 会在本机记录每个 session 的提示词、Agent 回复、工具调用和修改文件信息。完整 session 文件保存在 `~/.copilot/session-state/`，结构化索引保存在本机 SQLite 数据库。默认配置还会把 session 同步到 GitHub 账号。用户可以搜索历史 session，也可以通过 `--continue` 或 `--resume` 接续原有工作。文档还说明了异常终止后的重新索引与恢复方式。[GitHub Docs：About Copilot CLI session data](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle)

这套设计把 Agent 会话当成开发记录。服务进程结束不会成为删除会话的条件。

### GitHub Codespaces

Codespaces 允许用户停止并重新启动开发环境，已保存的项目修改仍然可用。终端命令历史也会保留，终端窗口当时显示的内容不会保留。Codespace 被删除以后，其中尚未推送的工作也会删除。[GitHub Docs：Understanding the codespace lifecycle](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle)

这里存在清楚的数据边界：代码、文件和有后续用途的命令历史需要保存；终端屏幕内容属于即时界面状态。

### Replit Agent

Replit 的 checkpoint 会保存项目文件、完整 AI 对话上下文、Agent memory、环境配置和可选的数据库内容。Agent 页面提供完整 checkpoint 时间线，用户可以在不同开发 session 之间访问历史记录，并从指定 checkpoint 继续工作。项目协作者也能查看 checkpoint 与共享的 AI 对话上下文。[Replit Docs：Checkpoints and Rollbacks](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks)

Replit Chat 也将对话视为持续对象。用户把 Chat 转成 Project 时，已有上下文和文件会继续用于后续工作。[Replit Docs：Turn a chat into a project](https://docs.replit.com/chat/continue-or-create-a-project)

### Ona 环境

Ona 的环境磁盘在停止和重新启动期间保持不变，项目目录、用户目录、命令历史和已安装工具都可以继续访问。环境归档以后也能恢复，只有删除环境才会清除存储。Ona 同时建议 Agent 每项任务使用独立环境，以便隔离任务。[Ona Docs：Persistent storage](https://ona.com/docs/ona/environments/persistent-storage)

这说明运行环境可以按任务创建和停止，任务结果与需要继续使用的数据仍然需要明确的保存周期。

### OpenCode

OpenCode Server 提供 session、message、todo、diff 和 child session 查询接口。调用方可以列出 session，读取某个 session 的全部消息，查看文件 diff，也可以按照 session ID 继续发送消息。[OpenCode Docs：Server](https://opencode.ai/docs/server)

OpenCode CLI 支持 `--continue`、`--session`、session list、session export 和 session import。它已经具备跨进程继续 session 以及导出完整 session 数据的能力。[OpenCode Docs：CLI](https://opencode.ai/docs/cli)

OpenCode 官方源码把数据库文件放在 XDG data directory 下的 `opencode.db`。数据库表包含 session、message、message part、todo 和 session context 等记录。[OpenCode Source：Global data directory](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/global.ts)、[OpenCode Source：Database](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/database/database.ts)、[OpenCode Source：Session tables](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts)

SimpleRCP 保存 OpenCode `runtimeSessionId` 后，可以在服务重新启动时重新连接原有 OpenCode session。OpenCode data directory 也需要位于能够长期保存的服务端存储中。

## 调研发现与实现结果

### Activity 保存

调研时，`apps/server/src/eventLog.ts` 使用进程内数组保存 `EventRecord`，Server 结束后会丢失 Activity。当前实现把文件操作、文件编辑和 Agent 状态写入项目目录的 `activity.json`，Server 重新启动后继续读取。

成员进入、离开、光标与当前文件仍属于即时状态，只在当前 Server 运行期间显示。

### Agent 数据已经写入服务端目录

当前代码已经保存以下数据：

- `agent-sessions/<sessionId>/session.json`：SimpleRCP Agent session。
- `agent-runs/<runId>/run.json`：每轮 Agent run 的状态、请求与结果。
- `agent-runs/<runId>/trace.jsonl`：按顺序记录的 Agent trace。
- `chat.json`：项目 Chat 消息。

这些文件位于项目工作目录的上一级项目数据目录。服务重新启动不会主动删除它们。

### Agent session 所有权

调研时，Agent session 使用临时 `memberId` 记录所有权。Server 重新启动以后，新生成的 `memberId` 无法查询原 session。

当前实现增加项目级 Participant。Agent session 与 run 使用 `participantId` 记录所有权，`memberId` 只用于当前 Room 的接口校验。用户重新选择原 Participant 后，可以查询原 session、run 和 trace，并继续使用已保存的 `runtimeSessionId`。

## 适合 SimpleRCP 的保存边界

### 需要保存的数据

- 项目 Chat 消息。
- Agent session 标题、创建者、创建时间与最近更新时间。
- 每轮 Agent run 的用户请求、Agent 最终回复、状态、模型、耗时和 token 信息。
- Agent trace 中的工具调用、命令结果、文件读取、文件写入与错误信息。
- 每轮文件变化与增加、删除行数。
- 有协作意义的 Activity，例如文件创建、重命名、删除，Agent run 创建、开始、完成、失败、取消。
- Activity 和 Agent 数据中的稳定用户标识、当时显示名称与角色文本。

### 只在运行期间保留的数据

- 在线状态与最后一次心跳。
- WebSocket connection ID。
- 光标位置与当前正在查看的文件。
- 终端窗口当前显示内容。
- 短时间内用于合并文件事件的计时状态。

成员进入、退出可以继续用于在线成员界面。若 Activity 的目标是说明代码和 Agent 对项目产生了什么影响，这类连接事件无需进入长期历史。

## 数据归属与重新进入流程

Agent session 使用 Server 保存的 `participantId` 记录所有者。`memberId` 表示一次 Server 运行期间的 Room 成员，适合 Presence、光标与 WebSocket 消息；`connectionId` 表示单个页面连接。

浏览器 `sessionStorage` 保存当前标签页选择的 Participant，`localStorage` 保存最近选择。Server 中的 `participants.json` 是身份记录来源，清除浏览器存储以后仍可重新选择。公网部署需要由登录账号关联并校验 Participant。

用户重新进入项目时，页面应当执行以下读取：

1. 使用项目 ID 读取保存的 Activity。
2. 使用项目 ID 和稳定用户 ID 读取该用户的 Agent session。
3. 打开 session 时读取全部 run；展开执行过程时读取对应 trace。
4. 如果服务停止时 run 仍处于 `queued` 或 `running`，重新启动后将它标记为 `interrupted`，保留已有 trace，并允许用户在原 session 中继续输入。
5. 若原有 OpenCode session 仍可访问，继续使用保存的 `runtimeSessionId`。若 OpenCode 已经无法提供该 session，页面应当明确显示运行环境不可用，历史记录仍然保持可读。

## Activity 的保存形式

Activity 采用项目级 `activity.json`。每条记录包含：

- `id`、`projectId`、`timestamp`、`type`；
- `participantId`、当时的成员名称与角色；
- `sessionId`、`runId`、文件路径等关联标识；
- 用于列表显示的简短信息与行数变化。

完整 Agent trace 已经保存在 `trace.jsonl`。Activity 只保存摘要和关联标识，页面需要详细信息时读取对应 run 与 trace，可以减少重复数据。

当前接口读取项目完整 Activity。数据量增加以后需要支持按时间或记录 ID 分页，并设置保留数量或保留天数。项目删除时，Activity、Participant、Agent session、run 和 trace 会与项目目录一起删除。

## 开发判断

SimpleRCP 采用 Server Only 数据来源时，Chat、Activity、Agent session、Agent run 和 trace 都属于服务端项目数据。服务重新启动只影响在线成员、连接、光标和终端屏幕等即时状态。

当前代码已经保存 Participant 与 Activity，并使用 `participantId` 查询 Agent session。用户能够重新进入项目、查看历史协作记录，并在原 Agent session 中继续工作，无需重新说明已有上下文。
