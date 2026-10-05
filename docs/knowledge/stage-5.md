# 阶段五报告

## 已完成内容

- `packages/knowledge/src/capture/events.ts` 增加 `agentRun`、`agentTool` 和 `KnowledgeEventSink`。
- `packages/knowledge/src/capture/engine.ts` 增加五类 Agent 触发、提示词相似度、纠正词判定和工具恢复判定。
- `packages/knowledge/src/capture/authorship.ts` 支持 Agent 区间的 `ownerId`。
- `apps/server/src/agent/agentRunManager.ts` 在 run 生命周期、工作区快照和运行时 trace 处接入事件记录，并在结束后登记 Agent 新增区间。
- `apps/server/src/agent/fakeAgentRuntime.ts` 增加 `fake-edit` 与 `fake-tool` 标记。
- `packages/knowledge/src/extract/recapPrompt.ts` 提供复盘提示词、JSON 引用校验、三次尝试和确定性兜底。
- `apps/server/src/knowledge/knowledgeService.ts` 增加作用域升级、关系和锚点过期处理；Inbox 增加异议接口。

## 验证

已运行：

- `pnpm --filter @simplercp/knowledge build`
- `pnpm --filter @simplercp/server build`
- `pnpm --filter @simplercp/knowledge test`
- `pnpm --filter @simplercp/server test`
- `pnpm test:e2e`
- `pnpm test:e2e:knowledge`

新增的 Agent 捕获测试覆盖打断、纠正、工具失败恢复和成员改写 Agent 区间。服务端现有 107 项测试全部通过，知识包现有 141 项测试全部通过。

真实 OpenCode trace 的工具事件使用 `message.part.updated`，工具状态放在 `part.state`，完成事件提供 `input`、`output` 和 `metadata`，失败事件提供 `error`。当前 OpenCode runtime 没有把统一的 token 用量字段映射到 AgentRun，阶段四的模型用量记录仍以 provider 返回值为准。

## 后续接口建议

阶段六可以在 `KnowledgeEventSink` 上接入终端审批和冲突事件，并把 `KnowledgeProvider` 的检索结果作为 MCP 工具返回。阶段七可以复用 `refreshExpired`、关系记录和复盘证据，构建跨项目治理与统计。

## 遗留问题

`recapMode: "agent-self"` 已保留配置字段，OpenCode 一次 `session.prompt` 运行中无法插入新的上下文，完整的自我复盘需要在后续任务中追加。本地真实 DeepSeek 复盘调用已完成两次脱敏冒烟。两次输出都未通过证据引用校验，系统使用确定性兜底；兜底规则保持了文件范围和未知项，适合等待人工补充，规则内容需要人工复核。报告没有保存密钥、完整提示词或原始命令输出。

## 2026-10-06 审阅修复

- 工具恢复只在文件修改发生后再次成功执行相同命令或参数相近的命令时生成建议，修改前已经成功的执行不会产生误报。
- 复盘引用支持 `evidence.*` 路径，任务后核对跳过无法解析的普通锚点，同时仍会执行带 `check` 且文件匹配的检查。
- 锚点范围的修改比例按多行修改行数和单行文本差异计算，保留小范围字符修改的 Yjs 定位结果，超过一半范围的修改进入 `needsReview`。
- 知识面板增加异议、待确认卡片、个人卡片申请团队确认、团队确认和卡片关系操作；同源事件与已有卡片重复时复用去重提示。

## 2026-10-05 审阅修复

- Agent run 在完成、失败和取消路径都会把工作区快照差异转换为 `agentRanges`，事件流与离线回放会重新登记这些区间及 `ownerId`。
- 复盘草稿的 `appliesTo` 会转换为卡片的文件或 glob 适用范围，`checkSuggestion` 会写入 `constraint` 或 `negative` 卡片的 `check` 字段。`agent-self` 与服务端复盘使用同一转换路径。
- `agent.retried` 只接受同一成员的失败任务重试。运行中的 OpenCode 工具事件会等待 `completed`、`success`、`error` 或 `failed` 终态，`running` 与 `pending` 事件不会进入捕获引擎。
- 增加作用域升级、待确认列表、矛盾关系与 `superseded` 状态的接口测试，并保留个人卡片的成员可见性测试。阶段五端到端场景截图位于 `docs/knowledge/screenshots/`。
- 本地真实 DeepSeek 冒烟只保留脱敏字段，报告中没有密钥、完整提示词和命令输出。完整的服务端复盘与 Agent 自我复盘四份草稿仍需要在真实 OpenCode session 中执行并人工判断。
