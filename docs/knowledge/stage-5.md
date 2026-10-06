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

新增的 Agent 捕获测试覆盖打断、纠正、工具失败恢复和成员改写 Agent 区间。服务端现有 109 项测试全部通过，知识包现有 150 项测试全部通过。

真实 OpenCode trace 的工具事件使用 `message.part.updated`，工具状态放在 `part.state`，完成事件提供 `input`、`output` 和 `metadata`，失败事件提供 `error`。OpenCode SDK 1.18.31 的 `message.updated` 信息包含 assistant 消息的 `tokens` 与 `cost`，服务端按消息编号去重后写入 `AgentRun.usage` 与 `usage_summary` trace。

## 后续接口建议

阶段六可以在 `KnowledgeEventSink` 上接入终端审批和冲突事件，并把 `KnowledgeProvider` 的检索结果作为 MCP 工具返回。阶段七可以复用 `refreshExpired`、关系记录和复盘证据，构建跨项目治理与统计。

## 遗留问题

`recapMode: "agent-self"` 在已结束 run 的同一 OpenCode session 中追加 `session.prompt`，输出使用同一复盘解析与引用校验，失败时记录 `knowledge_recap_self` 并返回错误，不调用服务端兜底。报告没有保存密钥、完整提示词或原始命令输出。

`correctionClassifier` 与 `contradictionJudge` 当前没有配置项，`rules+llm` 和 `llm` 尚未实现。纠正识别继续使用规则，关系选择继续由人完成。

## 2026-10-05 审阅修复

- Agent run 在完成、失败和取消路径都会把工作区快照差异转换为 `agentRanges`，事件流与离线回放会重新登记这些区间及 `ownerId`。
- 复盘草稿的 `appliesTo` 会转换为卡片的文件或 glob 适用范围，`checkSuggestion` 会写入 `constraint` 或 `negative` 卡片的 `check` 字段。`agent-self` 与服务端复盘使用同一转换路径。
- `agent.retried` 只接受同一成员的失败任务重试。运行中的 OpenCode 工具事件会等待 `completed`、`success`、`error` 或 `failed` 终态，`running` 与 `pending` 事件不会进入捕获引擎。
- 增加作用域升级、待确认列表、矛盾关系与 `superseded` 状态的接口测试，并保留个人卡片的成员可见性测试。阶段五端到端场景截图位于 `docs/knowledge/screenshots/`。
- 本地真实模型冒烟只保留脱敏字段，报告中没有密钥、完整提示词和命令输出；服务端复盘与 Agent 自我复盘的完整验收记录见 2026-10-06 第二次审阅修复。

## 2026-10-06 审阅修复

- 工具恢复只在文件修改发生后再次成功执行相同命令或参数相近的命令时生成建议，成功命令会清除对应的待恢复记录。
- 复盘引用支持 `evidence.*` 路径，任务后核对按照每个 patch hunk 或快照差异行段计算，跳过无法解析的普通锚点，同时仍会执行带 `check` 且文件匹配的检查。
- 锚点范围的修改比例按原始写入区间的去重行数累计，成员完整恢复运行前文件时也会生成 `agent.revised`。
- Agent 复写证据补充原任务、Agent 文件差异、成员改写差异、聊天消息和光标；成员完整恢复运行前文件时也会触发 `agent.revised`。
- 团队任务打断证据包含下一条指令，取消中的任务在工作区差异完成后执行任务后核对。
- `agent.retried` 仅在替代 run 以 `completed` 状态结束时生成，失败替代 run 不再产生重试建议。
- `appliesTo` 的在途提醒匹配加入 Agent run 的文件上下文和运行中工具 trace，事件与 Inbox 证据使用平台敏感信息清理函数。
- `AgentFileChange` 暴露快照前后文本，服务端确认接口拒绝 Agent 身份确认草稿或团队作用域。
- 锚点复核覆盖所有作用域的卡片，首次进入 `needsReview` 后才开始计算孤立期限，并通知属主与确认人。
- 同源去重覆盖已处理建议和草稿卡片，矛盾标记只出现在实际注入的卡片，配置枚举值错误时直接报告。
- `knowledge_anchor_needs_review` 的接口说明、治理说明和捕获证据说明已更新。
- 文件删除事件会先移除对应的 Y.Doc，再按空文本解析锚点并执行过期处理；任务后核对会保留运行开始后进入 `needsReview` 且带显式检查的卡片，以完成检查结果记录。
- 跨属主建议的同源去重按每名参与者的可见卡片分别查询，参与者之间不会因为个人卡片作用域而漏掉重复来源。

## 2026-10-06 第二次审阅修复

复盘引用解析改为支持 `evidence.a[0].b`、`evidence.a.0.b`、省略 `evidence.` 的写法，并在解析前清理 MiniMax 的 `<think>` 段。引用列表只保留能够解析的项目；全部项目都无法解析时才判定复盘失败。兜底复盘的 `rule` 为空并带 `fallback: true`，卡片确认接口要求人工填写“规则”段。服务端知识模型配置独立于 OpenCode Agent，`MINIMAX_BASE_URL=https://api.minimaxi.com/v1`、`MINIMAX_MODEL=MiniMax-M2` 的最小请求返回 HTTP 200。

服务端复盘与 Agent self recap 的 12 次验收均返回合法结构，引用列表均至少包含一条可解析引用，均未使用兜底。服务端调用使用 `minimax/MiniMax-M2`，self recap 使用同一 OpenCode session 的 `deepseek/deepseek-flash`。

服务端复盘三次跨属主改回的结果依次为：引用可解析数 6、6、5，均未使用兜底。规则原文分别为：Agents must not directly write or modify shared helper files without first consulting team members through the chat. Direct writes to shared utilities override team consensus and can lose important shared logic.；Agents must not perform direct file writes to shared or team-managed codebase files without member review; should use collaborative editing workflows or seek member approval first.；Do not perform direct writes that remove, modify, or replace shared helper functions in shared modules. Preserve the existing implementation and consult member before changes。

服务端复盘三次追加纠正的结果依次为：引用可解析数 4、4、3，均未使用兜底。规则原文分别为：Do not write directly to state in session files. Use shared helper functions for state mutations.；Do not write session state directly. Use shared helper functions for all state mutations.；Do not write state directly in `src/session.ts`; identify and use the shared helper for state operations。

Agent self recap 三次跨属主改回的结果依次为：引用可解析数 8、8、7，均未使用兜底。规则原文分别为：In `src/session.ts`, do not modify or overwrite the shared helper via a direct write; preserve it unless an explicit coordinated change is approved.；Edits to `src/session.ts` must not introduce direct writes that bypass the shared helper; preserve the helper in the resulting diff.；Edits to `src/session.ts` must not overwrite or remove the shared helper。

Agent self recap 三次追加纠正的结果依次为：引用可解析数 7、4、7，均未使用兜底。规则原文分别为：In `src/session.ts` and related session modules, session state must not be assigned directly; use the shared helper.；In `src/session.ts`, session state must be mutated through the shared helper; do not write state directly.；在 `src/session.ts` 中修改 session 状态时，必须调用共享 helper，不得直接对状态赋值。

服务端六次均通过解析，Agent self recap 六次均通过解析，合计 12 次均未使用兜底。Agent self recap 的一次真实用量记录为 `inputTokens=18043`、`outputTokens=427`、`reasoningTokens=428`、`cacheReadTokens=1664`、`totalTokens=18898`、`cost=0`；该调用只写入自我复盘 trace 与 `llm-calls.jsonl`，没有计入用户 run。注入字符数按 `Math.ceil(totalChars / 4)` 估算 token 数。模型调用日志新增 `provider`、`model` 和完整用量字段，提示词仍只保存哈希。

OpenCode runtime 在 `message.updated` 事件中读取 `AssistantMessage.tokens` 与 `cost`，按消息编号去重后写入 `AgentRun.usage` 和 `usage_summary`。假 Agent 返回固定用量，便于集成验证。self recap 调用会写入 `knowledge_recap_self` 与 `llm-calls.jsonl`，提示词只记录 SHA-256，调用不创建 AgentRun，不出现在 Agent 面板的任务列表。
