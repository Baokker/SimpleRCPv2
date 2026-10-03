# 团队 Agent

团队 Agent 使用项目范围的共享 `AgentSession`。旧的个人 session 继续使用 `scope` 缺省值 `personal`，团队 session 使用 `scope: "team"`、项目内唯一的 `handle`，并把 `memberId` 保存为空字符串。团队 session 还保存可选的 `description` 与 `createdByMemberId`。`AgentRun.memberId` 始终保存本次发令成员，用于 Activity 与审计；团队 run 通过 `source: "chat"` 和 `chatMessageId` 关联聊天消息。聊天消息使用 `kind` 区分成员、Agent、系统消息，并可保存 `agentSessionId`、`runId` 与按出现顺序去重后的 `mentions`。

## 接口

- `GET /api/projects/:projectId/team-agents`：按需创建默认 `agent` 后返回全部团队 Agent。
- `POST /api/projects/:projectId/team-agents`：使用 `{ name, description? }` 创建团队 Agent。名称会通过 `normalizeHandle` 处理，重复 handle 返回 `409`。
- `GET /api/projects/:projectId/team-agents/:sessionId/runs`：读取指定团队 Agent 的全部 run。
- `GET /api/projects/:projectId/chat`：读取包含成员、Agent、系统消息的持久聊天记录。
- `POST /api/projects/:projectId/chat`：保存成员消息、广播 `chat_message_created` 并立即返回；服务端随后解析提及并触发团队 run。

默认 Agent 只在第一次读取团队 Agent 列表或第一次创建团队 Agent 时创建。每个项目使用串行操作锁，避免并发请求写入两个 `agent` session。

## 聊天与运行

```mermaid
sequenceDiagram
  participant M as 成员
  participant C as Chat API
  participant B as chatAgentBridge
  participant Q as AgentRunManager
  participant O as OpenCode
  participant W as WebSocket

  M->>C: POST chat
  C->>C: 保存成员消息
  C->>W: chat_message_created
  C-->>M: 返回成员消息
  C--)B: 后台解析 @handle
  B->>B: 拼装发令人、Role、讨论消息与当前指令
  B->>Q: 在共享 session 创建 chat run
  Q->>W: agent_run_updated
  Q->>O: session.prompt
  O->>Q: 最终回复与文件变化
  Q->>C: 保存 agent 消息
  C->>W: chat_message_created
```

运行中的团队 Agent 再次被提及时，bridge 会查找同一 session 的 `queued` 或 `running` run。排队 run 直接取消；运行中 run 调用 `runtime.cancel`，OpenCode 会执行 `session.abort`。旧 run 写入 `cancelled`、`interruptedByRunId` 与 `interruptedByMemberId`，trace 写入 `run_interrupted`，随后在同一 session 创建新的 run，并保存一条 system 消息说明打断关系。新 run 使用可选字段 `interruptsRunId` 指向旧 run；它开始执行时读取旧 run 已保存的 `fileChanges`，把原发令人、打断者和已修改文件写入提示词。取消收尾会比较运行前后的工作区快照，并合并 `runtime.getDiff` 返回的文件变化；快照或 runtime diff 读取失败时会写入 Trace 记录。

Chat API 保存并广播成员消息后立即返回，提及解析与 run 创建在后台完成。后台错误会写入 Activity 与 system 消息。

同一项目的个人 run 与团队 run 共用原有队列，每次只执行一个 run。Agent 完成后，服务端把最终输出保存为 `kind: "agent"` 的聊天消息，失败时保存 `kind: "system"` 的错误消息。消息与 run 都经过原有敏感信息清理流程。

## OpenCode 忙碌 session 的结论

当前服务端调用的是 SDK 的传统 `session.prompt`，它发送 `POST /session/{sessionID}/message`，类型定义没有 `delivery` 字段，也没有说明忙碌 session 会接受第二条消息。SDK 1.18.31 的 v2 接口另有 `client.v2.session.prompt`，请求体包含 `delivery?: "steer" | "queue"`，返回类型列出 `409 ConflictError`。这说明 OpenCode 提供了忙碌 session 的排队与 steer 接口，但传统 `session.prompt` 的行为无法据此保证。

本轮继续使用取消后重新提交的流程，保留旧 session 的工具调用记录。以后可以在验证 v2 接口的实际服务端行为后，把团队 Agent 升级为 steer 或 queue 模式。

Team Agent 首次运行时，服务端会在项目工作区创建独立 `.git` 目录，让 OpenCode 把当前项目识别为工作区根目录。`.git` 已列入 `workspacePolicy.ts` 的忽略列表，不会出现在文件树或工作区快照中。首次隔离时，只清除团队 session 的旧 OpenCode 绑定，并写入 `agent_workspace_isolated` Activity；个人 Agent session 的绑定会保留。项目原本已有 `.git` 时不会重复初始化。

首次建立 `.git` 时，已有团队 session 的 OpenCode 上下文会重新建立；个人 Agent session 的上下文继续保留。`agent_workspace_isolated` Activity 会记录被清除绑定的团队 session。

Playwright 配置通过 `SIMPLERCP_FAKE_AGENT_RUNTIME=true` 开启测试运行时。提示词中的 `fake-delay=<毫秒>` 控制等待时间，`fake-write=<相对路径>` 在工作区写入文件，`fake-reply=<文字>` 指定最终回复。测试运行时按 run session 选择 fake 或真实 OpenCode；带这些标记的任务使用 fake，未带标记的真实模型用例仍走 OpenCode。该设置只写在 `tests/playwright.config.ts`，正常服务启动默认使用 OpenCode。

## 已知局限

- KI-001 仍然存在，团队 Agent 与成员同时修改同一路径时继续使用现有的并发修改提示。
- 每个项目同时执行一个 Agent run，后续任务会进入项目队列。
- 团队 Agent 只支持新建，当前没有改名、删除和归档接口。
- 提及解析只匹配项目内团队 Agent 的 ASCII handle，邮箱地址和中文 `@` 文本会被忽略。
