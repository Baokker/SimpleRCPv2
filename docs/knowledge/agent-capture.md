# 阶段五 Agent 协作捕获

阶段五把 Agent 生命周期和工具调用转换为 capture schema 1 事件。新增事件包括：

- `agentRun`：`runId`、成员、会话、提示词、来源、状态、打断关系、文件修改和 `agentRanges`。`agentRanges` 记录运行结束时从工作区快照差异得到的新增文本区间，事件回放时由引擎重新登记归属。
- `agentTool`：`runId`、工具名称、命令、成功状态、退出码和截断后的错误摘要。

服务端在 Agent run 开始、完成、失败、取消或打断时写入事件。运行时 trace 的工具部分由 `message.part.updated` 的 `part.state` 读取：成功状态为 `completed`，失败状态为 `error`，命令来自 `state.input.command`，退出码优先读取 `state.metadata.exitCode`。所有 trace 和证据经过已有的敏感信息清理。

捕获引擎新增五类触发：

| 触发 | 判定 | 冷却或时间范围 |
| --- | --- | --- |
| `agent.interrupted` | 团队 Agent 被打断，或个人 run 被取消后收到成员新任务 | 3 分钟打断窗口 |
| `agent.revised` | 成员在 Agent 区间登记后改写达到区间 30% | 15 分钟，按文件和 run 冷却 |
| `agent.corrected` | 同一会话的后续提示词命中中英文纠正词，并引用上一 run | 10 分钟 |
| `agent.retried` | 失败或取消后，相似提示词再次成功运行 | 30 分钟，相似度默认 0.35 |
| `agent.toolRecovered` | bash 工具失败，文件发生修改，随后同一可执行文件成功 | 网络错误关键词排除 |

Agent 文件归属在 run 结束后完成。服务端比较 run 前后的工作区快照，用文本 diff 提取新增区间，并以 `agent:<runId>` 和 `ownerId` 登记到 `AuthorshipIndex`。运行期间的文件系统回灌继续使用 `filesystem`，这样不会提前触发成员之间的覆写判断。成员改写 Agent 区间时，引擎通过 `onAgentRevised` 回调生成 `human-agent` 建议。

`agent.interrupted`、`agent.revised`、`agent.corrected` 的 AI 草稿默认使用服务端 `extractAgentRecapDraft`。项目设置为 `recapMode: "agent-self"` 时，服务端向已结束 run 的同一 OpenCode session 追加一次复盘请求，只接受符合 schema 且引用证据的 JSON；输出无效时记录失败并返回错误，不调用服务端复盘。服务端复盘失败时最多尝试三次，随后生成带未知项的个人草稿。`agent.retried` 与 `agent.toolRecovered` 使用普通 `extractKnowledgeCardDraft`。

Agent 建议默认创建为 `personal` 草稿，确认人必须是成员。个人卡片可以请求 `proposedTeam`，第二名成员确认后变为 `team`。团队卡片可以通过关系接口建立 `contradicts`、`supersedes`、`duplicates` 或 `refines` 关系；`supersedes` 会把目标卡片标记为 `superseded`。相同 run、聊天消息或建议来源的建议会合并，注入时同一来源只保留分数最高的卡片。

捕获事件文件仍位于 `<metadata>/knowledge/events.jsonl`，可以直接交给 `replayEvents` 回放。回放使用相同的引擎、配置和虚拟时钟，因此 Agent 触发与线上处理共享判定代码。
